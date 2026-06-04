/**
 * Convert a patched printer-layer stack (from ColorFirstResult.patchedLayers)
 * into a TransitionZone[] that the existing swap-plan and mesh-generation
 * pipeline can consume without further modification.
 *
 * The output has the same shape as AutoPaintResult.transitionZones, so any
 * code that already iterates transition zones works unchanged.
 */

import type { TransitionZone } from './autoPaint.ts';
import type { PrinterLayer } from './multiHeadAnalysis.ts';
import type { Filament } from '../types';
import { buildColorRuns } from './multiHeadAnalysisColorFirst.ts';

// ---------------------------------------------------------------------------
// Slice data — ThreeDView mesh generation
// ---------------------------------------------------------------------------

/**
 * The three arrays ThreeDView needs to build a layered mesh, derived from the
 * patched printer-layer stack.  Structurally identical to what App.tsx normally
 * derives from autoPaintSliceData, so ThreeDView requires no changes.
 *
 * colorOrder is always the identity mapping [0, 1, …, N-1] so that
 * colorSliceHeights[colorOrder[i]] == colorSliceHeights[i] == thickness of run i.
 */
export interface PatchedSliceData {
    colorOrder: number[];
    colorSliceHeights: number[];
    swatches: { hex: string; a: number }[];
}

/**
 * Derive a PatchedSliceData triple from the patched printer-layer stack.
 *
 * Each contiguous same-filament run becomes one slice.  firstLayerHeight is
 * applied to slice 0 to match the clamping ThreeDView already does for the
 * base layer.
 */
export function patchedLayersToSliceData(
    layers: PrinterLayer[],
    filaments: Filament[],
    firstLayerHeight: number
): PatchedSliceData {
    if (layers.length === 0) return { colorOrder: [], colorSliceHeights: [], swatches: [] };

    const runs = buildColorRuns(layers);
    const colorOrder: number[] = [];
    const colorSliceHeights: number[] = [];
    const swatches: { hex: string; a: number }[] = [];

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const filament = filaments[run.filamentIdx];

        const startZ = layers[run.startLayerIdx].startZ;
        const lastLayer = layers[run.endLayerIdx];
        const thickness = lastLayer.startZ + lastLayer.thickness - startZ;

        colorOrder.push(i);
        // Match ThreeDView's first-layer clamping so the base is always watertight.
        colorSliceHeights.push(i === 0 ? Math.max(thickness, firstLayerHeight) : thickness);

        const raw = filament?.color ?? '#000000';
        swatches.push({ hex: raw.startsWith('#') ? raw : `#${raw}`, a: 255 });
    }

    return { colorOrder, colorSliceHeights, swatches };
}

/**
 * Convert a (possibly reordered) printer-layer stack into a TransitionZone[].
 *
 * Each contiguous run of layers sharing the same filamentIdx becomes one zone.
 * Zone heights are derived from the actual layer startZ values and thicknesses
 * stored in the stack, so they are exact rather than ideal floats.
 *
 * idealThickness and actualThickness are set to the same value — there is no
 * compression step in the multi-head pipeline; the layer heights are already
 * discretised to the printer's layer height.
 */
export function patchedLayersToPlan(
    layers: PrinterLayer[],
    filaments: Filament[]
): TransitionZone[] {
    if (layers.length === 0) return [];

    const runs = buildColorRuns(layers);

    return runs.map((run) => {
        const filament = filaments[run.filamentIdx];
        const startHeight = layers[run.startLayerIdx].startZ;
        const lastLayer = layers[run.endLayerIdx];
        const endHeight = lastLayer.startZ + lastLayer.thickness;
        const thickness = endHeight - startHeight;

        return {
            filamentId:      filament?.id    ?? `f${run.filamentIdx}`,
            filamentColor:   filament?.color ?? '#000000',
            filamentTd:      filament?.td    ?? 0,
            startHeight,
            endHeight,
            idealThickness:  thickness,
            actualThickness: thickness,
        };
    });
}
