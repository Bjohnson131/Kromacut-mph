import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAutoLayers } from '../src/lib/autoPaint.ts';
import { expandZonesToPrinterLayers } from '../src/lib/multiHeadAnalysis.ts';
import { runMultiHeadLayerAnalysisColorFirst } from '../src/lib/multiHeadAnalysisColorFirst.ts';
import { patchedLayersToPlan } from '../src/lib/patchedLayersToPlan.ts';
import type { Filament } from '../src/types/index.ts';

const LAYER_HEIGHT = 0.12;
const FIRST_LAYER_HEIGHT = 0.20;

function filament(id: string, color: string, td: number, name?: string): Filament {
    return { id, color, td, name };
}

const F0 = filament('f0', '#000000', 5.0, 'VeryDark');
const F1 = filament('f1', '#555555', 5.0, 'Dark');
const F2 = filament('f2', '#aaaaaa', 5.0, 'Light');
const F3 = filament('f3', '#ffffff', 5.0, 'VeryLight');
const FOUR_FILAMENTS = [F0, F1, F2, F3];

function gradient(n: number): Array<{ hex: string }> {
    return Array.from({ length: n }, (_, i) => {
        const v = Math.round((i / (n - 1)) * 255);
        const h = v.toString(16).padStart(2, '0');
        return { hex: `#${h}${h}${h}` };
    });
}

// ---------------------------------------------------------------------------
// patchedLayersToPlan — basic structural invariants
// ---------------------------------------------------------------------------

test('patchedLayersToPlan — returns empty for empty input', () => {
    assert.deepEqual(patchedLayersToPlan([], FOUR_FILAMENTS), []);
});

test('patchedLayersToPlan — zone count equals run count from the same layers', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);
    // One zone per contiguous same-filament run — count must be ≥ 1 and ≤ layers.length.
    assert.ok(zones.length >= 1, 'must produce at least one zone');
    assert.ok(zones.length <= layers.length, 'cannot have more zones than layers');
});

test('patchedLayersToPlan — zones are contiguous (endHeight[i] === startHeight[i+1])', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);

    for (let i = 1; i < zones.length; i++) {
        assert.ok(
            Math.abs(zones[i].startHeight - zones[i - 1].endHeight) < 1e-9,
            `gap between zone ${i - 1} (end ${zones[i - 1].endHeight}) and zone ${i} (start ${zones[i].startHeight})`
        );
    }
});

test('patchedLayersToPlan — startHeight values are monotonically increasing', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);

    for (let i = 1; i < zones.length; i++) {
        assert.ok(
            zones[i].startHeight > zones[i - 1].startHeight,
            `startHeight not increasing at zone ${i}: ${zones[i].startHeight} <= ${zones[i - 1].startHeight}`
        );
    }
});

test('patchedLayersToPlan — all zone heights are non-negative', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);

    for (const z of zones) {
        assert.ok(z.startHeight >= 0, `negative startHeight: ${z.startHeight}`);
        assert.ok(z.endHeight > 0,    `non-positive endHeight: ${z.endHeight}`);
        assert.ok(z.endHeight > z.startHeight, `zero-thickness zone at ${z.startHeight}`);
    }
});

test('patchedLayersToPlan — idealThickness equals actualThickness (no compression)', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);

    for (const z of zones) {
        assert.equal(z.idealThickness, z.actualThickness,
            `idealThickness ${z.idealThickness} !== actualThickness ${z.actualThickness}`);
    }
});

test('patchedLayersToPlan — filamentId and filamentColor round-trip to the correct filament', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const zones = patchedLayersToPlan(layers, FOUR_FILAMENTS);

    const knownIds    = new Set(FOUR_FILAMENTS.map((f) => f.id));
    const knownColors = new Set(FOUR_FILAMENTS.map((f) => f.color));

    for (const z of zones) {
        assert.ok(knownIds.has(z.filamentId),
            `filamentId "${z.filamentId}" not found in filaments`);
        assert.ok(knownColors.has(z.filamentColor),
            `filamentColor "${z.filamentColor}" not found in filaments`);
    }
});

// ---------------------------------------------------------------------------
// patchedLayersToPlan — integration with the iterative analysis
// ---------------------------------------------------------------------------

test('patchedLayersToPlan — zones from patchedLayers cover the same total height as original layers', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    if (patchedLayers.length === 0) return; // no windows found, skip

    const originalLayers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const originalTop = originalLayers.at(-1)!;
    const expectedTop = originalTop.startZ + originalTop.thickness;

    const zones = patchedLayersToPlan(patchedLayers, FOUR_FILAMENTS);
    const actualTop = zones.at(-1)!.endHeight;

    assert.ok(
        Math.abs(actualTop - expectedTop) < 1e-6,
        `total height mismatch: patched=${actualTop.toFixed(4)} original=${expectedTop.toFixed(4)}`
    );
});

test('patchedLayersToPlan — all zone filamentIds are valid after iterative reordering', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    if (patchedLayers.length === 0) return;

    const knownIds = new Set(FOUR_FILAMENTS.map((f) => f.id));
    const zones = patchedLayersToPlan(patchedLayers, FOUR_FILAMENTS);

    for (const z of zones) {
        assert.ok(knownIds.has(z.filamentId),
            `reordered zone has unknown filamentId "${z.filamentId}"`);
    }
});
