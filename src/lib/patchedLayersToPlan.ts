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
