/**
 * Hook that runs the auto-paint algorithm in a Web Worker.
 *
 * Replaces the previous synchronous `useMemo` approach, ensuring the
 * optimizer (exhaustive / SA / GA) never blocks the main thread.
 *
 * Features:
 * - Automatic cancellation: new inputs terminate stale in-flight worker work.
 * - Loading and error state for UI feedback.
 * - Lazy worker instantiation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AutoPaintResult } from '../lib/autoPaint';
import type { Filament } from '../types';
import type { AutoPaintWorkerRequest, AutoPaintWorkerResponse } from '../workers/autoPaint.worker';

export interface UseAutoPaintWorkerOptions {
    paintMode: 'manual' | 'autopaint';
    filaments: Filament[];
    filtered: Array<{ hex: string; a: number } & Record<string, unknown>>;
    layerHeight: number;
    slicerFirstLayerHeight: number;
    autoPaintMaxHeight?: number;
    enhancedColorMatch: boolean;
    allowRepeatedSwaps: boolean;
    optimizerAlgorithm: 'exhaustive' | 'simulated-annealing' | 'genetic' | 'auto';
    optimizerSeed?: number;
    regionWeightingMode: 'uniform' | 'center' | 'edge';
    imageDimensions?: { width: number; height: number } | null;
}

export interface UseAutoPaintWorkerResult {
    autoPaintResult: AutoPaintResult | undefined;
    isComputing: boolean;
    error?: string;
}

let nextRequestId = 1;

function useStableValueByKey<T>(value: T, key: string): T {
    const stableRef = useRef<{ key: string; value: T } | null>(null);
    if (!stableRef.current || stableRef.current.key !== key) {
        stableRef.current = { key, value };
    }
    return stableRef.current.value;
}

export function useAutoPaintWorker(opts: UseAutoPaintWorkerOptions): UseAutoPaintWorkerResult {
    const {
        paintMode,
        filaments,
        filtered,
        layerHeight,
        slicerFirstLayerHeight,
        autoPaintMaxHeight,
        enhancedColorMatch,
        allowRepeatedSwaps,
        optimizerAlgorithm,
        optimizerSeed,
        regionWeightingMode,
        imageDimensions,
    } = opts;

    const [autoPaintResult, setAutoPaintResult] = useState<AutoPaintResult | undefined>(undefined);
    const [isComputing, setIsComputing] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const workerRef = useRef<Worker | null>(null);
    const activeRequestIdRef = useRef<number>(0);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimers = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
    }, []);

    const cancelWorker = useCallback(() => {
        workerRef.current?.terminate();
        workerRef.current = null;
    }, []);

    const finishRequest = useCallback(
        (id: number, nextError?: string, result?: AutoPaintResult) => {
            if (id !== activeRequestIdRef.current) return;

            activeRequestIdRef.current = 0;
            setIsComputing(false);
            setError(nextError);

            if (nextError) {
                console.error('[autoPaintWorker] error:', nextError);
                setAutoPaintResult(undefined);
            } else {
                setAutoPaintResult(result);
            }
        },
        []
    );

    // Stabilize filaments and filtered with content-based keys.
    const filamentsKey = useMemo(() => {
        return filaments
            .map((f) => `${f.id}:${f.color}:${f.td}:${JSON.stringify(f.calibration ?? null)}`)
            .join(';');
    }, [filaments]);

    const filteredKey = useMemo(() => {
        return filtered.map((s) => `${s.hex}:${(s.count as number | undefined) ?? 0}`).join(';');
    }, [filtered]);

    // Keep stable references when only array identity changes but content does not.
    const stableFilaments = useStableValueByKey(filaments, filamentsKey);
    const stableImageSwatches = useStableValueByKey(
        filtered.map((s) => ({
            hex: s.hex,
            count: s.count as number | undefined,
        })),
        filteredKey
    );

    const getWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new Worker(
                new URL('../workers/autoPaint.worker.ts', import.meta.url),
                { type: 'module' }
            );

            workerRef.current.onmessage = (e: MessageEvent<AutoPaintWorkerResponse>) => {
                const resp = e.data;
                if (resp.id !== activeRequestIdRef.current) return;

                if (resp.error) {
                    finishRequest(resp.id, resp.error);
                } else {
                    finishRequest(resp.id, undefined, resp.result);
                }
            };

            workerRef.current.onerror = (err) => {
                const id = activeRequestIdRef.current;
                cancelWorker();
                finishRequest(id, err.message || 'Auto-paint worker failed');
            };

            workerRef.current.onmessageerror = () => {
                const id = activeRequestIdRef.current;
                cancelWorker();
                finishRequest(id, 'Auto-paint worker returned an unreadable result');
            };
        }

        return workerRef.current;
    }, [cancelWorker, finishRequest]);

    useEffect(() => {
        return () => {
            clearTimers();
            cancelWorker();
        };
    }, [cancelWorker, clearTimers]);

    useEffect(() => {
        clearTimers();

        if (paintMode !== 'autopaint' || filaments.length === 0 || filtered.length === 0) {
            activeRequestIdRef.current = 0;
            cancelWorker();
            setAutoPaintResult(undefined);
            setIsComputing(false);
            setError(undefined);
            return;
        }

        // The worker algorithm is synchronous. Recreate the worker when inputs change so
        // stale optimizations cannot keep the only worker busy and block the latest request.
        cancelWorker();
        const id = nextRequestId++;
        activeRequestIdRef.current = id;
        setAutoPaintResult(undefined);
        setIsComputing(true);
        setError(undefined);

        debounceTimerRef.current = setTimeout(() => {
            try {
                const worker = getWorker();
                const algorithm =
                    optimizerAlgorithm === 'exhaustive' && stableFilaments.length > 8
                        ? 'auto'
                        : optimizerAlgorithm;

                const request: AutoPaintWorkerRequest = {
                    id,
                    filaments: stableFilaments,
                    imageSwatches: stableImageSwatches,
                    layerHeight,
                    firstLayerHeight: slicerFirstLayerHeight,
                    maxHeight: autoPaintMaxHeight,
                    enhancedColorMatch,
                    allowRepeatedSwaps,
                    optimizerOptions: {
                        algorithm,
                        ...(optimizerSeed !== undefined && { seed: optimizerSeed }),
                    },
                    regionWeightingMode,
                    imageDimensions: imageDimensions ?? undefined,
                };

                worker.postMessage(request);
            } catch (postError) {
                cancelWorker();
                finishRequest(
                    id,
                    postError instanceof Error ? postError.message : String(postError)
                );
            }
        }, 250);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [
        paintMode,
        filaments.length,
        filamentsKey,
        filtered.length,
        filteredKey,
        layerHeight,
        slicerFirstLayerHeight,
        autoPaintMaxHeight,
        enhancedColorMatch,
        allowRepeatedSwaps,
        optimizerAlgorithm,
        optimizerSeed,
        regionWeightingMode,
        imageDimensions,
        getWorker,
        stableFilaments,
        stableImageSwatches,
        clearTimers,
        cancelWorker,
        finishRequest,
    ]);

    return { autoPaintResult, isComputing, error };
}
