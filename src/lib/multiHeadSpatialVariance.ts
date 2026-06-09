/**
 * Multi-head spatial-variance minimization optimizer.
 *
 * Groups K image colours into M = ⌈K/N⌉ phases (bands), each holding up to N
 * colours. All pixels whose colour is in phase j print at the same height,
 * collapsing the height map from K distinct levels to M. The reduction follows
 * the plan in spatial-variance-plan.txt §§3.1–3.3.
 *
 * Spectral-ordering proxy: colours are sorted by luminance. For natural images
 * luminance is strongly correlated with spatial adjacency (the adjacency graph
 * Laplacian's Fiedler vector), so luminance rank is a fast, accurate stand-in
 * for the full spectral sort.
 *
 * Output shape: identical to ColorFirstResult so it drops straight into the
 * patchedLayersToPlan / buildPerColorLayerColors render path unchanged.
 */

import type { AutoPaintResult } from './autoPaint.ts';
import type { Filament } from '../types/index.ts';
import { hexToRgb, getLuminance, deltaE, type RGB } from './autoPaint.ts';
import type { PrinterLayer, WindowResult } from './multiHeadAnalysis.ts';
import type { ColorFirstResult } from './multiHeadAnalysisColorFirst.ts';

const FRONTLIT_TD_SCALE = 0.1;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpatialVarianceResult extends ColorFirstResult {
    /**
     * Total height of the spatial-variance model in mm.
     * = max(layerHeight, firstLayerHeight) + (M−1) × layerHeight
     * Pass this as autoPaintTotalHeight to ThreeDView so the standard
     * luminance → height mapping naturally quantises to exactly M levels.
     */
    spatialVarianceTotalHeight: number;
    /** Phase index [0, M) for each image-palette hex. */
    phaseOf: Map<string, number>;
    /** Number of phases M = ⌈K/N⌉. */
    phaseCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lab ΔE to the nearest filament; returns that filament's index. */
function nearestFilamentIndex(target: RGB, filaments: Filament[]): number {
    let best = 0;
    let bestDE = Infinity;
    for (let i = 0; i < filaments.length; i++) {
        const d = deltaE(target, hexToRgb(filaments[i].color));
        if (d < bestDE) { bestDE = d; best = i; }
    }
    return best;
}

/** RGB centroid of a non-empty colour list. */
function centroidRgb(rgbs: RGB[]): RGB {
    const n = rgbs.length;
    return {
        r: rgbs.reduce((s, c) => s + c.r, 0) / n,
        g: rgbs.reduce((s, c) => s + c.g, 0) / n,
        b: rgbs.reduce((s, c) => s + c.b, 0) / n,
    };
}

// ---------------------------------------------------------------------------
// Variance proxy (plan §3.2) — used by local-search refinement
// ---------------------------------------------------------------------------

/**
 * Compute Σ_{A<B} W(A,B)·(band[A]−band[B])² where W(A,B) is the inverse-
 * squared luminance distance (proxy for spatial adjacency when no pixel map
 * is available).
 */
function varianceProxy(
    colors: Array<{ lum: number }>,
    bands: number[]
): number {
    const K = colors.length;
    let s = 0;
    for (let a = 0; a < K; a++) {
        for (let b = a + 1; b < K; b++) {
            const lumDist = Math.abs(colors[a].lum - colors[b].lum);
            const w = 1 / (lumDist * lumDist + 1e-4);
            const d = bands[a] - bands[b];
            s += w * d * d;
        }
    }
    return s;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Spatial-variance multi-head optimizer — drop-in analogue of
 * runMultiHeadLayerAnalysisColorFirst for the spatial-variance objective.
 *
 * @param filaments  Available filament set (N heads loaded simultaneously).
 * @param _result    AutoPaintResult (signature parity; not used by this path).
 * @param imageSwatches  Unique image-palette entries from the quantised image.
 * @param layerHeight    Printer layer height in mm.
 * @param firstLayerHeight  Slicer first-layer height in mm.
 * @param n          Number of print heads (≥ 1).
 */
export function runMultiHeadSpatialVarianceOptimization(
    filaments: Filament[],
    _result: AutoPaintResult,
    imageSwatches: Array<{ hex: string; count?: number }>,
    layerHeight: number,
    firstLayerHeight: number,
    n: number
): SpatialVarianceResult {
    const empty: SpatialVarianceResult = {
        windows: [],
        colorAssignments: [],
        uniqueLayerCount: 0,
        patchedLayers: [],
        colorLayerFilaments: new Map(),
        spatialVarianceTotalHeight: 0,
        phaseOf: new Map(),
        phaseCount: 0,
    };

    const N = Math.min(n, filaments.length);
    if (N < 1 || imageSwatches.length === 0) return empty;

    // ------------------------------------------------------------------
    // 1. Deduplicate image colours and sort by luminance (spectral proxy).
    // ------------------------------------------------------------------
    const seen = new Set<string>();
    const uniqueColors: Array<{ hex: string; rgb: RGB; lum: number; count: number }> = [];
    for (const s of imageSwatches) {
        if (seen.has(s.hex)) continue;
        seen.add(s.hex);
        const rgb = hexToRgb(s.hex);
        uniqueColors.push({
            hex: s.hex,
            rgb,
            lum: getLuminance(rgb) / 255,
            count: s.count ?? 1,
        });
    }
    uniqueColors.sort((a, b) => a.lum - b.lum);

    const K = uniqueColors.length;
    const M = Math.ceil(K / N);

    // ------------------------------------------------------------------
    // 2. Initial band assignment: consecutive N-sized groups of the
    //    luminance-sorted colour list → band index = floor(i / N).
    // ------------------------------------------------------------------
    const bands: number[] = uniqueColors.map((_, i) => Math.floor(i / N));

    // ------------------------------------------------------------------
    // 3. Local-search refinement (plan §3.3 tryMoveOrSwap).
    //    Swap pairs of colours between adjacent bands if the variance proxy
    //    strictly decreases. One sweep is usually sufficient for the
    //    luminance-proximity proxy (which already yields a near-optimal
    //    ordering); iterate until convergence.
    // ------------------------------------------------------------------
    const bandSize = (b: number) => bands.filter(x => x === b).length;
    let improved = true;
    while (improved) {
        improved = false;
        for (let a = 0; a < K; a++) {
            for (const target of [bands[a] - 1, bands[a] + 1]) {
                if (target < 0 || target >= M) continue;

                // Try moving colour a into target band.
                const origBands = bands.slice();
                const origSize = bandSize(bands[a]);
                const targetSize = bandSize(target);

                if (targetSize < N) {
                    // Spare slot — just move.
                    bands[a] = target;
                    if (varianceProxy(uniqueColors, bands) < varianceProxy(uniqueColors, origBands)) {
                        improved = true;
                    } else {
                        bands[a] = origBands[a]; // revert
                    }
                } else if (origSize > 1) {
                    // No spare slot; try swapping a with every colour in target band.
                    for (let b = 0; b < K; b++) {
                        if (bands[b] !== target) continue;
                        bands[a] = target;
                        bands[b] = origBands[a];
                        if (varianceProxy(uniqueColors, bands) < varianceProxy(uniqueColors, origBands)) {
                            improved = true;
                            break;
                        }
                        // Revert swap.
                        bands[a] = origBands[a];
                        bands[b] = origBands[b];
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // 4. Materialise phase groups from final band assignment.
    // ------------------------------------------------------------------
    const phaseOf = new Map<string, number>();
    const phaseColors: typeof uniqueColors[] = Array.from({ length: M }, () => []);
    for (let i = 0; i < K; i++) {
        phaseOf.set(uniqueColors[i].hex, bands[i]);
        phaseColors[bands[i]].push(uniqueColors[i]);
    }

    // ------------------------------------------------------------------
    // 5. Nearest-filament assignment for each image colour.
    // ------------------------------------------------------------------
    const filamentFor = new Map<string, number>();
    for (const c of uniqueColors) {
        filamentFor.set(c.hex, nearestFilamentIndex(c.rgb, filaments));
    }

    // ------------------------------------------------------------------
    // 6. Build M printer layers (one per phase, each layerHeight thick).
    //    Layer 0 uses max(layerHeight, firstLayerHeight) to respect the
    //    slicer's minimum first-layer requirement.
    // ------------------------------------------------------------------
    const effectiveFirstLayer = Math.max(layerHeight, firstLayerHeight);
    const patchedLayers: PrinterLayer[] = [];
    for (let j = 0; j < M; j++) {
        const group = phaseColors[j];
        const repFilamentIdx = group.length > 0
            ? nearestFilamentIndex(centroidRgb(group.map(c => c.rgb)), filaments)
            : 0;
        const repFilament = filaments[repFilamentIdx];
        const thickness = j === 0 ? effectiveFirstLayer : layerHeight;
        const startZ = j === 0 ? 0 : effectiveFirstLayer + (j - 1) * layerHeight;
        patchedLayers.push({
            startZ,
            thickness,
            filamentIdx: repFilamentIdx,
            filamentRgb: hexToRgb(repFilament.color),
            td: repFilament.td * FRONTLIT_TD_SCALE,
        });
    }

    // Total height used by ThreeDView to scale the luminance → height map.
    // With this value, luminance snapped to layerHeight grid gives exactly M
    // discrete levels matching the M phases.
    const spatialVarianceTotalHeight =
        patchedLayers[M - 1].startZ + patchedLayers[M - 1].thickness;

    // ------------------------------------------------------------------
    // 7. Per-colour filament-per-layer sequences.
    //    Colour C in phase j:
    //      layers 0 … j−1 → filament 0 (support; not visible in opaque model)
    //      layers j … M−1 → nearest filament for C
    // ------------------------------------------------------------------
    const colorLayerFilaments = new Map<string, number[]>();
    for (const [hex, phase] of phaseOf) {
        const assigned = filamentFor.get(hex) ?? 0;
        const seq = new Array<number>(M);
        for (let j = 0; j < M; j++) {
            seq[j] = j < phase ? 0 : assigned;
        }
        colorLayerFilaments.set(hex, seq);
    }

    // ------------------------------------------------------------------
    // 8. WindowResult entries (one per phase) for the swap-plan display.
    // ------------------------------------------------------------------
    const windows: WindowResult[] = phaseColors.map((colors, j) => {
        const uniqueFI = [...new Set(colors.map(c => filamentFor.get(c.hex) ?? 0))];
        return {
            windowStart: j,
            windowEnd: j,
            windowBottomZ: patchedLayers[j].startZ,
            windowTopZ: patchedLayers[j].startZ + patchedLayers[j].thickness,
            currentFilaments: uniqueFI.map(
                fi => filaments[fi]?.name ?? filaments[fi]?.color ?? `f${fi}`
            ),
            filamentIds: uniqueFI.map(fi => filaments[fi]?.id ?? `f${fi}`),
            affectedSwatches: colors.reduce((s, c) => s + c.count, 0),
            errorFactor: 0,
            lut: [],
            pixelOptimalLUTIdx: [],
        };
    });

    console.log(
        `[SpatialVariance] K=${K} colours → M=${M} phases × N=${N} heads` +
        ` | totalHeight=${spatialVarianceTotalHeight.toFixed(3)} mm`
    );

    return {
        windows,
        colorAssignments: phaseColors.map((colors) => {
            const map = new Map<string, number[]>();
            colors.forEach((c, i) => map.set(c.hex, [i % N]));
            return map;
        }),
        uniqueLayerCount: M,
        patchedLayers,
        colorLayerFilaments,
        spatialVarianceTotalHeight,
        phaseOf,
        phaseCount: M,
    };
}
