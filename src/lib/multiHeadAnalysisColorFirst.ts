/**
 * Color-first multi-head analysis pipeline.
 *
 * Before running the sliding-window LUT simulation, swatches that map to the
 * same printer layer are merged into a single frequency-weighted entry.  This
 * trades a small amount of per-swatch fidelity for a proportional reduction in
 * the inner-loop work of analyzeWindowLUT.
 *
 * Use analyzeMultiHeadWindowsColorFirst as a drop-in alongside
 * analyzeMultiHeadWindows to compare errorFactor rankings side-by-side.
 */

import type { AutoPaintResult } from './autoPaint.ts';
import type { Filament } from '../types';
import {
    hexToRgb,
    blendColors,
    deltaE,
    getLuminance,
    luminanceToHeight,
    type RGB,
} from './autoPaint.ts';
import {
    expandZonesToPrinterLayers,
    findLayerIdxAtHeight,
    buildColorStack,
    type PrinterLayer,
    type WindowFilament,
    type WindowResult,
} from './multiHeadAnalysis.ts';

const FRONTLIT_TD_SCALE = 0.1;

/**
 * A swatch entry deduplicated by printer layer.
 * All swatches that share the same layerIdx are merged: targetRgb is their
 * frequency-weighted centroid and count is the sum of their pixel counts.
 */
export interface ColorFirstPixel {
    targetRgb: RGB;
    layerIdx: number;
    /** ΔE between the centroid color and the actual stack color at layerIdx. */
    actualErr: number;
    /** Total pixel count of all swatches merged into this entry. */
    count: number;
}

/**
 * Collapse imageSwatches into one ColorFirstPixel per unique printer layer.
 *
 * Swatches that land on the same layer are merged:
 *   - targetRgb  → frequency-weighted RGB centroid
 *   - actualErr  → ΔE between the centroid and colorAtLayer[layerIdx]
 *   - count      → sum of constituent swatch counts (or 1 each when absent)
 */
export function buildPixelDataColorFirst(
    imageSwatches: Array<{ hex: string; count?: number }>,
    layers: PrinterLayer[],
    colorAtLayer: RGB[],
    transitionZones: AutoPaintResult['transitionZones'],
    totalHeight: number,
    firstLayerHeight: number
): ColorFirstPixel[] {
    const byLayer = new Map<number, { r: number; g: number; b: number; count: number }>();

    for (const s of imageSwatches) {
        const rgb = hexToRgb(s.hex);
        const lum = getLuminance(rgb) / 255;
        const h = luminanceToHeight(lum, transitionZones, totalHeight, firstLayerHeight);
        const layerIdx = findLayerIdxAtHeight(layers, h);
        const cnt = s.count ?? 1;

        const existing = byLayer.get(layerIdx);
        if (existing) {
            const total = existing.count + cnt;
            existing.r = (existing.r * existing.count + rgb.r * cnt) / total;
            existing.g = (existing.g * existing.count + rgb.g * cnt) / total;
            existing.b = (existing.b * existing.count + rgb.b * cnt) / total;
            existing.count = total;
        } else {
            byLayer.set(layerIdx, { r: rgb.r, g: rgb.g, b: rgb.b, count: cnt });
        }
    }

    return Array.from(byLayer.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([layerIdx, { r, g, b, count }]) => {
            const targetRgb: RGB = { r, g, b };
            return {
                targetRgb,
                layerIdx,
                actualErr: deltaE(targetRgb, colorAtLayer[layerIdx]),
                count,
            };
        });
}

/**
 * A contiguous run of printer layers that all share the same filament.
 * Windows are defined in terms of runs, not individual layers.
 */
export interface ColorRun {
    filamentIdx: number;
    /** First printer-layer index in this run (inclusive). */
    startLayerIdx: number;
    /** Last printer-layer index in this run (inclusive). */
    endLayerIdx: number;
}

/**
 * Group consecutive same-filament printer layers into runs.
 * A run boundary occurs wherever the filamentIdx changes.
 */
export function buildColorRuns(layers: PrinterLayer[]): ColorRun[] {
    if (layers.length === 0) return [];
    const runs: ColorRun[] = [];
    let runStart = 0;
    for (let i = 1; i <= layers.length; i++) {
        if (i === layers.length || layers[i].filamentIdx !== layers[runStart].filamentIdx) {
            runs.push({ filamentIdx: layers[runStart].filamentIdx, startLayerIdx: runStart, endLayerIdx: i - 1 });
            runStart = i;
        }
    }
    return runs;
}

/**
 * Simulate all K^N filament combinations for a run-based window, finding the
 * optimal slot assignment for every color in a single pass per combination.
 *
 * Loop order: K^N combinations (outer) × colors (inner, updated at their layer).
 * Each combination is simulated once, advancing layer-by-layer through the window
 * and above. Every color's running minimum is updated the moment the simulation
 * reaches its target layerIdx — no per-color restart from baseColor.
 *
 * Returns per-color optimal slot assignments (direct number[] arrays, no LUT
 * indirection) alongside the frequency-weighted errorFactor.
 */
export function computeColorOptimalAssignments(
    windowRuns: ColorRun[],
    wEnd: number,
    layers: PrinterLayer[],
    baseColor: RGB,
    windowFilaments: WindowFilament[],
    pixels: ColorFirstPixel[]
): { errorFactor: number; affectedCount: number; assignments: (number[] | null)[] } {
    const K = windowFilaments.length;
    const N = windowRuns.length;
    const wStart = windowRuns[0].startLayerIdx;

    // Index pixels by layerIdx for O(1) lookup during the simulation sweep.
    const pixelsAtLayer = new Map<number, number[]>();
    const minErr = new Float64Array(pixels.length).fill(Infinity);
    const assignments: (number[] | null)[] = new Array(pixels.length).fill(null);
    let totalActualError = 0;
    let affectedCount = 0;
    let maxAffectedLayer = wStart - 1;

    for (let pxIdx = 0; pxIdx < pixels.length; pxIdx++) {
        const px = pixels[pxIdx];
        if (px.layerIdx < wStart) continue;
        affectedCount += px.count;
        totalActualError += px.actualErr * px.count;
        if (px.layerIdx > maxAffectedLayer) maxAffectedLayer = px.layerIdx;
        const bucket = pixelsAtLayer.get(px.layerIdx);
        if (bucket) bucket.push(pxIdx);
        else pixelsAtLayer.set(px.layerIdx, [pxIdx]);
    }

    const total = K ** N;

    for (let combo = 0; combo < total; combo++) {
        // Decode combo to slot assignments (base-K digits).
        const entry: number[] = new Array(N);
        let v = combo;
        for (let j = 0; j < N; j++) { entry[j] = v % K; v = Math.floor(v / K); }

        // Single incremental simulation through the window runs.
        let c: RGB = { ...baseColor };
        for (let r = 0; r < N; r++) {
            const run = windowRuns[r];
            const filament = windowFilaments[entry[r]];
            for (let i = run.startLayerIdx; i <= run.endLayerIdx; i++) {
                c = blendColors(c, filament.rgb, filament.td, layers[i].thickness);
                const bucket = pixelsAtLayer.get(i);
                if (bucket) {
                    for (const pxIdx of bucket) {
                        const err = deltaE(pixels[pxIdx].targetRgb, c);
                        if (err < minErr[pxIdx]) { minErr[pxIdx] = err; assignments[pxIdx] = entry.slice(); }
                    }
                }
            }
        }

        // Continue above the window for colors whose layerIdx > wEnd.
        for (let i = wEnd + 1; i <= maxAffectedLayer; i++) {
            c = blendColors(c, layers[i].filamentRgb, layers[i].td, layers[i].thickness);
            const bucket = pixelsAtLayer.get(i);
            if (bucket) {
                for (const pxIdx of bucket) {
                    const err = deltaE(pixels[pxIdx].targetRgb, c);
                    if (err < minErr[pxIdx]) { minErr[pxIdx] = err; assignments[pxIdx] = entry.slice(); }
                }
            }
        }
    }

    let totalMinError = 0;
    for (let pxIdx = 0; pxIdx < pixels.length; pxIdx++) {
        if (minErr[pxIdx] < Infinity) totalMinError += minErr[pxIdx] * pixels[pxIdx].count;
    }

    return { errorFactor: totalActualError - totalMinError, affectedCount, assignments };
}

/**
 * Drop-in parallel to analyzeMultiHeadWindows that uses the color-first pixel
 * pipeline.  The returned WindowResult is structurally identical to the base
 * pipeline's output and carries errorFactor for comparison purposes.
 *
 * Note: affectedSwatches in the returned WindowResult is the total weighted
 * pixel count, not the number of unique color groups.
 */
export function analyzeMultiHeadWindowsColorFirst(
    filaments: Filament[],
    result: AutoPaintResult,
    imageSwatches: Array<{ hex: string; count?: number }>,
    layerHeight: number,
    firstLayerHeight: number,
    n: number
): WindowResult[] {
    const N = Math.min(n, filaments.length);
    if (N < 2 || result.transitionZones.length === 0 || imageSwatches.length === 0) return [];

    const layers = expandZonesToPrinterLayers(result, filaments, layerHeight, firstLayerHeight);
    if (layers.length < N + 1) return [];

    const colorAtLayer = buildColorStack(layers);
    const runs = buildColorRuns(layers);
    const pixels = buildPixelDataColorFirst(
        imageSwatches, layers, colorAtLayer,
        result.transitionZones, result.totalHeight, firstLayerHeight
    );

    const windows: WindowResult[] = [];

    // Slide a window of N consecutive color runs (not N individual layers).
    // Each run covers all printer layers that share the same filament, so the
    // window always spans exactly N color zones regardless of how many layers
    // each zone occupies.
    for (let rStart = 0; rStart + N <= runs.length; rStart++) {
        const windowRuns = runs.slice(rStart, rStart + N);
        const wStart = windowRuns[0].startLayerIdx;
        const wEnd = windowRuns[N - 1].endLayerIdx;

        // Skip the foundation run (layer 0 is the opaque base).
        if (wStart === 0) continue;

        const uniqueIndices = [...new Set(windowRuns.map((r) => r.filamentIdx))];
        const windowFilaments: WindowFilament[] = uniqueIndices.map((fi) => ({
            rgb: hexToRgb(filaments[fi]?.color ?? '#000000'),
            td: (filaments[fi]?.td ?? 0.5) * FRONTLIT_TD_SCALE,
        }));

        const { errorFactor, affectedCount } = computeColorOptimalAssignments(
            windowRuns, wEnd, layers, colorAtLayer[wStart - 1], windowFilaments, pixels
        );

        windows.push({
            windowStart: wStart,
            windowEnd: wEnd,
            windowBottomZ: layers[wStart].startZ,
            windowTopZ: layers[wEnd].startZ + layers[wEnd].thickness,
            currentFilaments: uniqueIndices.map((fi) =>
                filaments[fi]?.name ?? filaments[fi]?.color ?? `f${fi}`
            ),
            filamentIds: uniqueIndices.map((fi) => filaments[fi]?.id ?? `f${fi}`),
            affectedSwatches: affectedCount,
            errorFactor,
            lut: [],
            pixelOptimalLUTIdx: [],
        });
    }

    return windows;
}

// ---------------------------------------------------------------------------
// Consensus combo + layer patching (iterative pipeline helpers)
// ---------------------------------------------------------------------------

/**
 * Find the single K^N filament combo that minimises the aggregate weighted
 * ΔE across all affected color groups for this window.
 *
 * Unlike computeColorOptimalAssignments (which gives each color its own best
 * combo), this returns one consensus ordering that the printer can actually
 * use — every pixel at the same height sees the same head assignment.
 *
 * Returns the winning entry, the improvement over the current stack, and the
 * total affected pixel count.
 */
function findConsensusCombo(
    windowRuns: ColorRun[],
    wEnd: number,
    layers: PrinterLayer[],
    baseColor: RGB,
    windowFilaments: WindowFilament[],
    pixels: ColorFirstPixel[]
): { entry: number[]; errorFactor: number; affectedCount: number } {
    const K = windowFilaments.length;
    const N = windowRuns.length;
    const wStart = windowRuns[0].startLayerIdx;

    const pixelsAtLayer = new Map<number, number[]>();
    let totalActualError = 0;
    let affectedCount = 0;
    let maxAffectedLayer = wStart - 1;

    for (let pxIdx = 0; pxIdx < pixels.length; pxIdx++) {
        const px = pixels[pxIdx];
        if (px.layerIdx < wStart) continue;
        affectedCount += px.count;
        totalActualError += px.actualErr * px.count;
        if (px.layerIdx > maxAffectedLayer) maxAffectedLayer = px.layerIdx;
        const bucket = pixelsAtLayer.get(px.layerIdx);
        if (bucket) bucket.push(pxIdx);
        else pixelsAtLayer.set(px.layerIdx, [pxIdx]);
    }

    const total = K ** N;
    let bestEntry: number[] = Array.from({ length: N }, () => 0);
    let bestError = Infinity;

    for (let combo = 0; combo < total; combo++) {
        const entry: number[] = new Array(N);
        let v = combo;
        for (let j = 0; j < N; j++) { entry[j] = v % K; v = Math.floor(v / K); }

        let comboError = 0;
        let c: RGB = { ...baseColor };

        for (let r = 0; r < N; r++) {
            const run = windowRuns[r];
            const filament = windowFilaments[entry[r]];
            for (let i = run.startLayerIdx; i <= run.endLayerIdx; i++) {
                c = blendColors(c, filament.rgb, filament.td, layers[i].thickness);
                const bucket = pixelsAtLayer.get(i);
                if (bucket) for (const pxIdx of bucket)
                    comboError += deltaE(pixels[pxIdx].targetRgb, c) * pixels[pxIdx].count;
            }
        }
        for (let i = wEnd + 1; i <= maxAffectedLayer; i++) {
            c = blendColors(c, layers[i].filamentRgb, layers[i].td, layers[i].thickness);
            const bucket = pixelsAtLayer.get(i);
            if (bucket) for (const pxIdx of bucket)
                comboError += deltaE(pixels[pxIdx].targetRgb, c) * pixels[pxIdx].count;
        }

        if (comboError < bestError) { bestError = comboError; bestEntry = entry; }
    }

    return {
        entry: bestEntry,
        errorFactor: Math.max(0, totalActualError - bestError),
        affectedCount,
    };
}

/**
 * Patch the mutable layer stack so that every printer layer within each run
 * slot carries the filament chosen by `entry`.  Updates filamentIdx,
 * filamentRgb, and td so subsequent buildColorStack calls reflect the new
 * ordering.
 */
function applyComboToLayers(
    layers: PrinterLayer[],
    windowRuns: ColorRun[],
    entry: number[],
    uniqueIndices: number[],
    filaments: Filament[]
): void {
    for (let r = 0; r < windowRuns.length; r++) {
        const run = windowRuns[r];
        const fi = uniqueIndices[entry[r]];
        const f = filaments[fi];
        const rgb = hexToRgb(f.color);
        const td = f.td * FRONTLIT_TD_SCALE;
        for (let i = run.startLayerIdx; i <= run.endLayerIdx; i++) {
            layers[i] = { ...layers[i], filamentIdx: fi, filamentRgb: rgb, td };
        }
    }
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

/**
 * Result of the color-first full pipeline.
 *
 * `colorAssignments[i]` maps every input swatch hex directly to its optimal
 * N-slot filament assignment for `windows[i]`.  No LUT indirection needed.
 *
 * Renderer lookup:
 *   windows[i].filamentIds[ colorAssignments[i].get(hex)![slotIndex] ]
 *   → filament ID for a pixel of color `hex` at run slot `slotIndex` in window i.
 *
 * Colors absent from the map fall below that window's start layer.
 */
export interface ColorFirstResult {
    /** Windows selected by the iterative consensus loop, in application order. */
    windows: WindowResult[];
    /**
     * One map per selected window.  Key: swatch hex string.
     * Value: number[] of length N — the optimal filament index (into
     * windows[i].filamentIds) for each run slot.
     */
    colorAssignments: Map<string, number[]>[];
    /** Number of unique printer layers the input swatches collapsed to. */
    uniqueLayerCount: number;
    /**
     * The full printer-layer stack after all window reorderings have been
     * applied.  Each entry's filamentIdx, filamentRgb, and td reflect the
     * consensus-optimal assignment chosen by the iterative loop.
     *
     * Use this as the source of truth for downstream steps (transition plan,
     * mesh generation, 3MF export).  Empty when no windows were applied.
     */
    patchedLayers: PrinterLayer[];
}

/**
 * Full color-first analysis pipeline — analogue of runMultiHeadLayerAnalysis.
 *
 * Instead of a per-swatch pixelOptimalLUTIdx array, the result carries one
 * Map<hex, lutIdx> per selected window so any downstream renderer can resolve
 * a pixel color directly to the optimal filament sequence without needing to
 * maintain a swatch-index mapping.
 */
export function runMultiHeadLayerAnalysisColorFirst(
    filaments: Filament[],
    result: AutoPaintResult,
    imageSwatches: Array<{ hex: string; count?: number }>,
    layerHeight: number,
    firstLayerHeight: number,
    n: number
): ColorFirstResult {
    const N = Math.min(n, filaments.length);
    const empty: ColorFirstResult = { windows: [], colorAssignments: [], uniqueLayerCount: 0, patchedLayers: [] };

    if (N < 2 || result.transitionZones.length === 0 || imageSwatches.length === 0) {
        console.log('[MultiHead ColorFirst] Insufficient data (need ≥2 filaments and image swatches).');
        return empty;
    }

    // Mutable layer stack — patched in-place each iteration as windows are applied.
    const layers = expandZonesToPrinterLayers(result, filaments, layerHeight, firstLayerHeight);
    if (layers.length < N + 1) {
        console.log(`[MultiHead ColorFirst] Not enough printer layers for window size N=${N}.`);
        return empty;
    }

    // Run boundaries are fixed for the life of the analysis; only filament
    // assignments within runs change as windows are applied.
    const runs = buildColorRuns(layers);

    // Color groups are fixed (derived from image content, not the stack).
    const initialColorAtLayer = buildColorStack(layers);
    const pixels = buildPixelDataColorFirst(
        imageSwatches, layers, initialColorAtLayer,
        result.transitionZones, result.totalHeight, firstLayerHeight
    );

    const layerIdxToGroupIdx = new Map<number, number>(pixels.map((p, i) => [p.layerIdx, i]));
    const hexToGroupIdx = new Map<string, number>();
    for (const s of imageSwatches) {
        if (hexToGroupIdx.has(s.hex)) continue;
        const rgb = hexToRgb(s.hex);
        const lum = getLuminance(rgb) / 255;
        const h = luminanceToHeight(lum, result.transitionZones, result.totalHeight, firstLayerHeight);
        const layerIdx = findLayerIdxAtHeight(layers, h);
        const groupIdx = layerIdxToGroupIdx.get(layerIdx);
        if (groupIdx !== undefined) hexToGroupIdx.set(s.hex, groupIdx);
    }

    const selectedWindows: WindowResult[] = [];
    const selectedAssignments: Map<string, number[]>[] = [];
    const heads = filaments.slice(0, N).map((f, i) => `[${i}] ${f.name ?? f.color}`).join('  ');
    const MIN_IMPROVEMENT = 1e-4;
    // Upper bound: at most floor(runs/N) non-overlapping windows.
    const maxIter = Math.floor(runs.length / N);

    console.group(
        `[MultiHead ColorFirst] N=${N} heads | ${pixels.length} color groups` +
        ` (from ${imageSwatches.length} swatches) | iterative`
    );
    console.log(`  Heads: ${heads}`);

    for (let iter = 0; iter < maxIter; iter++) {
        // Rebuild the blended color stack from the (possibly patched) layers.
        const colorAtLayer = buildColorStack(layers);

        // Refresh each pixel's actual error against the current stack.
        for (let pxIdx = 0; pxIdx < pixels.length; pxIdx++) {
            pixels[pxIdx].actualErr = deltaE(pixels[pxIdx].targetRgb, colorAtLayer[pixels[pxIdx].layerIdx]);
        }

        // Scan every candidate N-run window and find the one whose consensus
        // optimal ordering yields the greatest aggregate improvement.
        let bestWindowRuns: ColorRun[] | null = null;
        let bestUniqueIndices: number[] | null = null;
        let bestEntry: number[] | null = null;
        let bestErrorFactor = MIN_IMPROVEMENT;
        let bestAffectedCount = 0;

        for (let rStart = 0; rStart + N <= runs.length; rStart++) {
            const windowRuns = runs.slice(rStart, rStart + N);
            const wStart = windowRuns[0].startLayerIdx;
            if (wStart === 0) continue; // skip foundation

            const wEnd = windowRuns[N - 1].endLayerIdx;

            // Read current filament assignment from the (possibly patched) layers.
            const uniqueIndices = [...new Set(
                windowRuns.map((r) => layers[r.startLayerIdx].filamentIdx)
            )];
            const windowFilaments: WindowFilament[] = uniqueIndices.map((fi) => ({
                rgb: hexToRgb(filaments[fi]?.color ?? '#000000'),
                td: (filaments[fi]?.td ?? 0.5) * FRONTLIT_TD_SCALE,
            }));

            const { entry, errorFactor, affectedCount } = findConsensusCombo(
                windowRuns, wEnd, layers, colorAtLayer[wStart - 1], windowFilaments, pixels
            );

            if (errorFactor > bestErrorFactor) {
                bestWindowRuns = windowRuns;
                bestUniqueIndices = uniqueIndices;
                bestEntry = entry;
                bestErrorFactor = errorFactor;
                bestAffectedCount = affectedCount;
            }
        }

        if (!bestWindowRuns || !bestEntry || !bestUniqueIndices) break;

        const wStart = bestWindowRuns[0].startLayerIdx;
        const wEnd = bestWindowRuns[N - 1].endLayerIdx;

        const w: WindowResult = {
            windowStart: wStart,
            windowEnd: wEnd,
            windowBottomZ: layers[wStart].startZ,
            windowTopZ: layers[wEnd].startZ + layers[wEnd].thickness,
            currentFilaments: bestUniqueIndices.map(
                (fi) => filaments[fi]?.name ?? filaments[fi]?.color ?? `f${fi}`
            ),
            filamentIds: bestUniqueIndices.map((fi) => filaments[fi]?.id ?? `f${fi}`),
            affectedSwatches: bestAffectedCount,
            errorFactor: bestErrorFactor,
            lut: [],
            pixelOptimalLUTIdx: [],
        };

        // Patch the layer stack so the next iteration sees the updated stack.
        applyComboToLayers(layers, bestWindowRuns, bestEntry, bestUniqueIndices, filaments);

        // All colors above wStart share the same consensus entry.
        const colorMap = new Map<string, number[]>();
        for (const [hex, groupIdx] of hexToGroupIdx) {
            if (pixels[groupIdx].layerIdx >= wStart) colorMap.set(hex, bestEntry.slice());
        }

        selectedWindows.push(w);
        selectedAssignments.push(colorMap);

        console.log(
            `  ★ iter ${iter + 1}  W[${String(wStart).padStart(3)}–${String(wEnd).padStart(3)}]` +
            `  Z: ${layers[wStart].startZ.toFixed(3)}–${(layers[wEnd].startZ + layers[wEnd].thickness).toFixed(3)} mm` +
            `  |  [${w.currentFilaments.join(' → ')}]` +
            `  |  errorFactor: ${bestErrorFactor.toFixed(4)}` +
            `  |  colors: ${colorMap.size}`
        );
    }

    console.log(`  Total: ${selectedWindows.length} window(s) applied.`);
    console.groupEnd();

    return { windows: selectedWindows, colorAssignments: selectedAssignments, uniqueLayerCount: pixels.length, patchedLayers: layers.slice() };
}
