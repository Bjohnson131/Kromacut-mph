import { useMemo, useRef, useState } from 'react';
import type { Swatch, Filament, MultiHeadRangeAssignment } from '../types';
import type { AutoPaintResult, TransitionZone } from '../lib/autoPaint';
import type { WindowResult } from '../lib/multiHeadAnalysis';

export type SwapEntry =
    | { type: 'start'; swatch: Swatch }
    | { type: 'swap'; swatch: Swatch; layer: number; height: number };

/** One nozzle's assignment at a schedule event. */
export interface MultiHeadNozzleEntry {
    nozzle: number;       // 1-based
    filamentHex: string;
    filamentId: string;
    /** True when this nozzle's filament differs from the previous event (requires a physical swap). */
    changed: boolean;
}

/** A single event in the head-load schedule: either the initial load or a swap checkpoint. */
export interface MultiHeadScheduleEvent {
    /** 1-based printer layer number where this event occurs (0 = before print starts). */
    startLayer: number;
    /** State of every nozzle at this event. */
    nozzles: MultiHeadNozzleEntry[];
    /** Number of nozzles that change filament at this event. */
    swapCount: number;
    /** True for the synthetic "before print" event that shows the initial head setup. */
    isPrePrint?: boolean;
}

export interface UseSwapPlanOptions {
    colorOrder: number[];
    colorSliceHeights: number[];
    filtered: Swatch[];
    layerHeight: number;
    slicerFirstLayerHeight: number;
    paintMode: 'manual' | 'autopaint';
    autoPaintResult?: AutoPaintResult;
    multiHeadWindows?: WindowResult[];
    /** When set, used in place of autoPaintResult.layers for the swap plan. */
    patchedTransitionZones?: TransitionZone[];
    // Multi-head nozzle assignment data (from optimizeNozzleAssignments).
    nozzleAssignments?: number[][];
    windowRunFilaments?: string[][];
    preWindowFilaments?: string[];
    nonWindowedRanges?: MultiHeadRangeAssignment[];
    filaments?: Filament[];
    disabled?: boolean;
}

export function useSwapPlan({
    colorOrder,
    colorSliceHeights,
    filtered,
    layerHeight,
    slicerFirstLayerHeight,
    paintMode,
    autoPaintResult,
    multiHeadWindows = [],
    patchedTransitionZones,
    nozzleAssignments,
    windowRunFilaments,
    preWindowFilaments,
    nonWindowedRanges,
    filaments,
    disabled = false,
}: UseSwapPlanOptions) {
    const swapPlan = useMemo(() => {
        if (disabled) {
            return [] as SwapEntry[];
        }

        // When auto-paint is active, build the swap plan from the effective
        // layer sequence.  patchedTransitionZones (from the multi-head analysis)
        // takes priority over the original autoPaintResult.layers so that any
        // reordered windows appear as additional swaps in the instructions.
        const effectiveLayers = patchedTransitionZones ?? autoPaintResult?.layers;
        if (paintMode === 'autopaint' && effectiveLayers && effectiveLayers.length > 0) {
            const plan: SwapEntry[] = [];
            effectiveLayers.forEach(
                (
                    layer: { filamentColor: string; startHeight: number },
                    idx: number
                ) => {
                    const sw: Swatch = { hex: layer.filamentColor, a: 255 };
                    if (idx === 0) {
                        plan.push({ type: 'start', swatch: sw });
                    } else {
                        const heightAt = layer.startHeight;
                        const effFirst = Math.max(0, slicerFirstLayerHeight || 0);
                        let layerNum = 1;
                        if (layerHeight > 0) {
                            const delta = Math.max(0, heightAt - effFirst);
                            layerNum = 2 + Math.round(delta / layerHeight);
                        }
                        plan.push({
                            type: 'swap',
                            swatch: sw,
                            layer: layerNum,
                            height: heightAt,
                        });
                    }
                }
            );
            return plan;
        }

        // Standard mode: Build cumulative slice heights
        const cumulativeHeights: number[] = [];
        let run = 0;
        for (let pos = 0; pos < colorOrder.length; pos++) {
            const fi = colorOrder[pos];
            const h = Number(colorSliceHeights[fi] ?? 0) || 0;
            const eff = pos === 0 ? Math.max(h, slicerFirstLayerHeight || 0) : h;
            run += eff;
            cumulativeHeights[pos] = run;
        }

        const plan: SwapEntry[] = [];
        for (let pos = 0; pos < colorOrder.length; pos++) {
            const fi = colorOrder[pos];
            const sw = filtered[fi];
            if (!sw) continue;
            if (pos === 0) {
                plan.push({ type: 'start', swatch: sw });
                continue;
            }
            const prevCum = cumulativeHeights[pos - 1] ?? 0;
            const heightAt = Math.max(0, prevCum);
            const effFirst = Math.max(0, slicerFirstLayerHeight || 0);
            let layerNum = 1;
            let displayHeight = heightAt;
            if (layerHeight > 0) {
                const delta = Math.max(0, heightAt - effFirst);
                layerNum = 2 + Math.round(delta / layerHeight);
                displayHeight = effFirst + (layerNum - 1) * layerHeight;
            }
            plan.push({
                type: 'swap',
                swatch: sw,
                layer: layerNum,
                height: displayHeight,
            });
        }
        return plan;
    }, [
        colorOrder,
        colorSliceHeights,
        filtered,
        layerHeight,
        slicerFirstLayerHeight,
        paintMode,
        autoPaintResult,
        multiHeadWindows,
        patchedTransitionZones,
        disabled,
    ]);

    // Per-checkpoint head schedule for multi-head mode, ordered by layer number.
    const multiHeadPlan = useMemo<MultiHeadScheduleEvent[] | null>(() => {
        if (
            !multiHeadWindows.length ||
            !nozzleAssignments?.length ||
            !windowRunFilaments?.length ||
            !filaments?.length
        ) return null;

        const hexById = new Map<string, string>();
        for (const f of filaments) hexById.set(f.id, f.color);

        // Build a unified sorted list of all print-order events: real windows +
        // non-windowed ranges (pre-window, gaps, post-window).
        type RawEvent =
            | { kind: 'window'; startLayer0: number; w: number }
            | { kind: 'range';  startLayer0: number; range: MultiHeadRangeAssignment };

        const rawEvents: RawEvent[] = [];

        for (let w = 0; w < multiHeadWindows.length; w++) {
            rawEvents.push({ kind: 'window', startLayer0: multiHeadWindows[w].windowStart, w });
        }
        if (nonWindowedRanges) {
            for (const range of nonWindowedRanges) {
                rawEvents.push({ kind: 'range', startLayer0: range.rangeStart, range });
            }
        }

        rawEvents.sort((a, b) => a.startLayer0 - b.startLayer0);
        if (rawEvents.length === 0) return null;

        const events: MultiHeadScheduleEvent[] = [];
        let loadedIds: string[] = [];
        let isFirst = true;

        for (const raw of rawEvents) {
            let newLoadedIds: string[];

            if (raw.kind === 'window') {
                const assgn = nozzleAssignments[raw.w] ?? [];
                const runs = windowRunFilaments[raw.w] ?? [];
                if (loadedIds.length === 0) loadedIds = new Array(assgn.length).fill('');
                newLoadedIds = assgn.map((r, k) => r === -1 ? loadedIds[k] : (runs[r] ?? ''));
            } else {
                newLoadedIds = raw.range.nozzleFilaments.slice();
                if (loadedIds.length === 0) loadedIds = new Array(newLoadedIds.length).fill('');
            }

            const nozzles: MultiHeadNozzleEntry[] = [];
            let swapCount = 0;
            for (let k = 0; k < newLoadedIds.length; k++) {
                const fid = newLoadedIds[k];
                const hex = hexById.get(fid) ?? '#888888';
                const changed = !isFirst && fid !== loadedIds[k];
                if (changed) swapCount++;
                nozzles.push({ nozzle: k + 1, filamentHex: hex, filamentId: fid, changed });
            }

            events.push({
                startLayer: isFirst ? 0 : raw.startLayer0 + 1,
                nozzles,
                swapCount,
                isPrePrint: isFirst,
            });

            loadedIds = newLoadedIds;
            isFirst = false;
        }

        return events.length > 0 ? events : null;
    }, [multiHeadWindows, nozzleAssignments, windowRunFilaments, nonWindowedRanges, filaments]);

    // Build a plain-text representation of the instructions for copying
    const buildInstructionsText = () => {
        const lines: string[] = [];
        lines.push('3D Print Instructions');
        lines.push('---------------------');
        lines.push(`Layer height: ${layerHeight.toFixed(3)} mm`);
        lines.push(`First layer height: ${slicerFirstLayerHeight.toFixed(3)} mm`);
        lines.push('Recommended: Layer loops: 1; Infill: 100%');
        lines.push('');

        if (multiHeadPlan) {
            lines.push('Head load schedule:');
            for (const evt of multiHeadPlan.filter(e => e.isPrePrint || e.swapCount > 0)) {
                const label = evt.isPrePrint
                    ? 'Before print — load all heads:'
                    : evt.swapCount === 0
                        ? `Layer ${evt.startLayer} — no changes needed:`
                        : `Layer ${evt.startLayer} — swap ${evt.swapCount} head${evt.swapCount !== 1 ? 's' : ''}:`;
                lines.push(label);
                for (const n of evt.nozzles) {
                    if (evt.isPrePrint || n.changed) {
                        lines.push(`  Head ${n.nozzle}: ${n.filamentHex}${n.changed ? ' ← swap' : ''}`);
                    }
                }
                lines.push('');
            }
        } else {
            if (swapPlan.length) {
                const first = swapPlan[0];
                if (first.type === 'start') lines.push(`Start with color: ${first.swatch.hex}`);
            }
            lines.push('');
            lines.push('Color swap plan:');
            if (swapPlan.length <= 1) {
                lines.push('- No swaps — only one color configured.');
            } else {
                let idx = 1;
                for (const entry of swapPlan) {
                    if (entry.type === 'start') {
                        lines.push(`${idx}. Start with ${entry.swatch.hex}`);
                    } else {
                        lines.push(
                            `${idx}. Swap to ${entry.swatch.hex} at layer ${
                                entry.layer
                            } (~${entry.height.toFixed(3)} mm)`
                        );
                    }
                    idx++;
                }
            }
        }

        lines.push('');
        lines.push('Notes: Heights are approximate. Confirm in slicer before printing.');
        lines.push('');
        lines.push('---------------------');
        lines.push('Made with Kromacut by vycdev!');
        return lines.join('\n');
    };

    // Clipboard copy with fallback and brief copied feedback
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);
    const copyToClipboard = async () => {
        const text = buildInstructionsText();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            setCopied(true);
            if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
            copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Copy to clipboard failed', err);
        }
    };

    return {
        swapPlan,
        multiHeadPlan,
        copied,
        copyToClipboard,
    };
}
