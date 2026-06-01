/**
 * Multi-head layer selection analysis.
 *
 * For a sliding window of N consecutive printer layers, builds a LUT of all N^N
 * filament-to-layer assignments and computes how much color error could be
 * reduced by choosing the best assignment (vs. the current global ordering)
 * at each pixel.
 */

import type { AutoPaintResult } from './autoPaint';
import type { Filament } from '../types';
import {
    hexToRgb,
    blendColors,
    deltaE,
    getLuminance,
    luminanceToHeight,
    type RGB,
} from './autoPaint';

const FRONTLIT_TD_SCALE = 0.1;

interface PrinterLayer {
    /** Index into the original filaments array */
    filamentIdx: number;
    filamentRgb: RGB;
    /** TD already multiplied by FRONTLIT_TD_SCALE */
    td: number;
    thickness: number;
    startZ: number;
}

/** Per-window output from the sliding-window analysis. */
export interface WindowResult {
    /** Index of the first layer in the window (1-based; layer 0 is the opaque foundation). */
    windowStart: number;
    /** Index of the last layer in the window (inclusive). */
    windowEnd: number;
    windowBottomZ: number;
    windowTopZ: number;
    /** Current filament name/color at each window position in the actual stack. */
    currentFilaments: string[];
    /** Number of palette swatches whose mapped height reaches this window. */
    affectedSwatches: number;
    /** Sum of (actualΔE − minPossibleΔE) across affected swatches. Always ≥ 0. */
    errorFactor: number;
}

/** Expand transition zones into individual printer-layer entries. */
function expandZonesToPrinterLayers(
    result: AutoPaintResult,
    filaments: Filament[],
    layerHeight: number,
    firstLayerHeight: number
): PrinterLayer[] {
    const layers: PrinterLayer[] = [];
    const { transitionZones: zones, totalHeight } = result;
    if (zones.length === 0 || totalHeight <= 0) return layers;

    let currentZ = 0;
    let layerIndex = 0;

    while (currentZ < totalHeight) {
        const thickness =
            layerIndex === 0 ? Math.max(firstLayerHeight, layerHeight) : layerHeight;

        let activeZoneIdx = 0;
        for (let zi = 0; zi < zones.length; zi++) {
            if (currentZ >= zones[zi].startHeight) activeZoneIdx = zi;
        }

        const zone = zones[activeZoneIdx];
        const filamentIdx = filaments.findIndex((f) => f.id === zone.filamentId);
        const filament = filamentIdx >= 0 ? filaments[filamentIdx] : filaments[0];

        layers.push({
            filamentIdx: Math.max(0, filamentIdx),
            filamentRgb: hexToRgb(zone.filamentColor),
            td: filament.td * FRONTLIT_TD_SCALE,
            thickness,
            startZ: currentZ,
        });

        currentZ += thickness;
        layerIndex++;
        if (layerIndex > 500) break;
    }

    return layers;
}

/**
 * Generate all N^N filament-index assignments for a window of N layers.
 * Entry i encodes which filament (0..N-1) goes in each window position,
 * reading the digits of i in base N.
 */
function buildLUT(n: number): number[][] {
    const total = Math.pow(n, n);
    const lut: number[][] = new Array(total);
    for (let i = 0; i < total; i++) {
        const entry = new Array(n);
        let v = i;
        for (let j = 0; j < n; j++) {
            entry[j] = v % n;
            v = Math.floor(v / n);
        }
        lut[i] = entry;
    }
    return lut;
}

/** Return the index of the last printer layer whose startZ ≤ h. */
function findLayerIdxAtHeight(layers: PrinterLayer[], h: number): number {
    let idx = 0;
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].startZ <= h) idx = i;
        else break;
    }
    return idx;
}

/**
 * Core sliding-window computation — returns one `WindowResult` per window
 * without any side effects. Use `runMultiHeadLayerAnalysis` for console output.
 */
export function analyzeMultiHeadWindows(
    filaments: Filament[],
    result: AutoPaintResult,
    imageSwatches: Array<{ hex: string }>,
    layerHeight: number,
    firstLayerHeight: number,
    n: number
): WindowResult[] {
    const N = Math.min(n, filaments.length);
    if (N < 2 || result.transitionZones.length === 0 || imageSwatches.length === 0) return [];

    const layers = expandZonesToPrinterLayers(result, filaments, layerHeight, firstLayerHeight);
    if (layers.length < N + 1) return [];

    const scaledFilaments = filaments.slice(0, N).map((f) => ({
        rgb: hexToRgb(f.color),
        td: f.td * FRONTLIT_TD_SCALE,
    }));

    const lut = buildLUT(N);

    // Pre-compute actual stack color at each printer layer.
    // Layer 0 (foundation) is opaque; subsequent layers blend independently.
    const colorAtLayer: RGB[] = new Array(layers.length);
    colorAtLayer[0] = { ...layers[0].filamentRgb };
    for (let i = 1; i < layers.length; i++) {
        colorAtLayer[i] = blendColors(
            colorAtLayer[i - 1],
            layers[i].filamentRgb,
            layers[i].td,
            layers[i].thickness
        );
    }

    const pixels = imageSwatches.map((s) => {
        const rgb = hexToRgb(s.hex);
        const lum = getLuminance(rgb) / 255;
        const h = luminanceToHeight(
            lum,
            result.transitionZones,
            result.totalHeight,
            firstLayerHeight
        );
        const layerIdx = findLayerIdxAtHeight(layers, h);
        return { targetRgb: rgb, layerIdx, actualErr: deltaE(rgb, colorAtLayer[layerIdx]) };
    });

    const windows: WindowResult[] = [];

    for (let wStart = 1; wStart + N <= layers.length; wStart++) {
        const wEnd = wStart + N - 1;
        const windowBottomZ = layers[wStart].startZ;
        const windowTopZ = layers[wEnd].startZ + layers[wEnd].thickness;
        const baseColor = colorAtLayer[wStart - 1];

        let totalActualError = 0;
        let totalMinError = 0;
        let affectedSwatches = 0;

        for (const px of pixels) {
            if (px.layerIdx < wStart) continue;
            affectedSwatches++;
            totalActualError += px.actualErr;

            let minErr = px.actualErr;
            for (const entry of lut) {
                let c: RGB = { ...baseColor };
                const applyCount = Math.min(N, px.layerIdx - wStart + 1);
                for (let j = 0; j < applyCount; j++) {
                    const fi = entry[j];
                    c = blendColors(
                        c,
                        scaledFilaments[fi].rgb,
                        scaledFilaments[fi].td,
                        layers[wStart + j].thickness
                    );
                }
                for (let i = wEnd + 1; i <= px.layerIdx && i < layers.length; i++) {
                    c = blendColors(c, layers[i].filamentRgb, layers[i].td, layers[i].thickness);
                }
                const err = deltaE(px.targetRgb, c);
                if (err < minErr) minErr = err;
            }

            totalMinError += minErr;
        }

        windows.push({
            windowStart: wStart,
            windowEnd: wEnd,
            windowBottomZ,
            windowTopZ,
            currentFilaments: Array.from({ length: N }, (_, j) => {
                const fi = layers[wStart + j].filamentIdx;
                return filaments[fi]?.name ?? filaments[fi]?.color ?? `f${fi}`;
            }),
            affectedSwatches,
            errorFactor: totalActualError - totalMinError,
        });
    }

    return windows;
}

/**
 * Run the multi-head layer analysis and log each window's result to the console.
 */
export function runMultiHeadLayerAnalysis(
    filaments: Filament[],
    result: AutoPaintResult,
    imageSwatches: Array<{ hex: string }>,
    layerHeight: number,
    firstLayerHeight: number,
    n: number
): void {
    const N = Math.min(n, filaments.length);

    if (N < 2 || result.transitionZones.length === 0 || imageSwatches.length === 0) {
        console.log('[MultiHead] Insufficient data (need ≥2 filaments and image swatches).');
        return;
    }

    const windows = analyzeMultiHeadWindows(
        filaments, result, imageSwatches, layerHeight, firstLayerHeight, n
    );

    if (windows.length === 0) {
        console.log(`[MultiHead] Not enough printer layers for window size N=${N}.`);
        return;
    }

    const heads = filaments.slice(0, N)
        .map((f, i) => `[${i}] ${f.name ?? f.color}`)
        .join('  ');

    console.group(
        `[MultiHead] N=${N} | LUT=${Math.pow(N, N)} entries (${N}^${N}) | ` +
            `${windows.length + N} printer layers | ${imageSwatches.length} image swatches`
    );
    console.log(`  Heads: ${heads}`);

    for (const w of windows) {
        console.log(
            `  W[${String(w.windowStart).padStart(3)}–${String(w.windowEnd).padStart(3)}]` +
                `  Z: ${w.windowBottomZ.toFixed(3)}–${w.windowTopZ.toFixed(3)} mm` +
                `  |  [${w.currentFilaments.join(' → ')}]` +
                `  |  swatches: ${w.affectedSwatches}/${imageSwatches.length}` +
                `  |  errorFactor: ${w.errorFactor.toFixed(4)}`
        );
    }

    console.groupEnd();
}
