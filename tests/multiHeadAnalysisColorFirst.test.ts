import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAutoLayers } from '../src/lib/autoPaint.ts';
import {
    selectBestWindows,
    buildColorStack,
    expandZonesToPrinterLayers,
    type PrinterLayer,
} from '../src/lib/multiHeadAnalysis.ts';
import {
    buildPixelDataColorFirst,
    buildColorRuns,
    analyzeMultiHeadWindowsColorFirst,
    runMultiHeadLayerAnalysisColorFirst,
} from '../src/lib/multiHeadAnalysisColorFirst.ts';
import type { Filament } from '../src/types/index.ts';

const LAYER_HEIGHT = 0.12;
const FIRST_LAYER_HEIGHT = 0.20;

function filament(id: string, color: string, td: number, name?: string): Filament {
    return { id, color, td, name };
}

const BLACK = filament('black', '#000000', 5.0, 'Black');
const WHITE = filament('white', '#ffffff', 5.0, 'White');

// Four-filament fixture for run-based window tests.
// High TD → tall model → each zone spans several printer layers → runs are wide.
const F0 = filament('f0', '#000000', 5.0, 'VeryDark');
const F1 = filament('f1', '#555555', 5.0, 'Dark');
const F2 = filament('f2', '#aaaaaa', 5.0, 'Light');
const F3 = filament('f3', '#ffffff', 5.0, 'VeryLight');
const FOUR_FILAMENTS = [F0, F1, F2, F3];

function gradient(n: number, count = 1): Array<{ hex: string; count: number }> {
    return Array.from({ length: n }, (_, i) => {
        const v = Math.round((i / (n - 1)) * 255);
        const h = v.toString(16).padStart(2, '0');
        return { hex: `#${h}${h}${h}`, count };
    });
}

// ---------------------------------------------------------------------------
// buildColorRuns
// ---------------------------------------------------------------------------

test('buildColorRuns — single run when all layers share the same filament', () => {
    const swatches = [{ hex: '#808080' }];
    const result = generateAutoLayers([BLACK], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const runs = buildColorRuns(layers);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].startLayerIdx, 0);
    assert.equal(runs[0].endLayerIdx, layers.length - 1);
});

test('buildColorRuns — runs partition all layers with no gaps', () => {
    const swatches = gradient(10);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK, WHITE], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const runs = buildColorRuns(layers);

    // Every layer index must appear in exactly one run.
    let covered = 0;
    for (const run of runs) {
        assert.ok(run.startLayerIdx <= run.endLayerIdx, 'run must have at least one layer');
        covered += run.endLayerIdx - run.startLayerIdx + 1;
    }
    assert.equal(covered, layers.length, 'runs must cover every printer layer exactly once');
});

test('buildColorRuns — adjacent layers with different filaments each become their own run', () => {
    const swatches = gradient(10);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK, WHITE], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const runs = buildColorRuns(layers);

    for (let i = 1; i < runs.length; i++) {
        assert.notEqual(
            runs[i].filamentIdx, runs[i - 1].filamentIdx,
            `adjacent runs at indices ${i - 1} and ${i} should have different filaments`
        );
    }
});

// ---------------------------------------------------------------------------
// buildPixelDataColorFirst
// ---------------------------------------------------------------------------

test('buildPixelDataColorFirst — produces fewer entries than input swatches for a dense gradient', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK, WHITE], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const colorAtLayer = buildColorStack(layers);

    const pixels = buildPixelDataColorFirst(
        swatches, layers, colorAtLayer,
        result.transitionZones, result.totalHeight, FIRST_LAYER_HEIGHT
    );

    assert.ok(pixels.length < swatches.length,
        `expected color-first to collapse 200 swatches into fewer entries, got ${pixels.length}`);
    assert.ok(pixels.length > 0, 'must produce at least one entry');
});

test('buildPixelDataColorFirst — counts sum to total input count', () => {
    const swatches = gradient(200, 10);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK, WHITE], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const colorAtLayer = buildColorStack(layers);

    const pixels = buildPixelDataColorFirst(
        swatches, layers, colorAtLayer,
        result.transitionZones, result.totalHeight, FIRST_LAYER_HEIGHT
    );

    const totalCount = pixels.reduce((s, p) => s + p.count, 0);
    const expectedCount = swatches.reduce((s, sw) => s + sw.count, 0);
    assert.equal(totalCount, expectedCount);
});

test('buildPixelDataColorFirst — all actualErr values are non-negative', () => {
    const swatches = gradient(100);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const layers = expandZonesToPrinterLayers(result, [BLACK, WHITE], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const colorAtLayer = buildColorStack(layers);

    const pixels = buildPixelDataColorFirst(
        swatches, layers, colorAtLayer,
        result.transitionZones, result.totalHeight, FIRST_LAYER_HEIGHT
    );
    for (const p of pixels) {
        assert.ok(p.actualErr >= 0, `actualErr=${p.actualErr} at layerIdx=${p.layerIdx}`);
    }
});

// ---------------------------------------------------------------------------
// analyzeMultiHeadWindowsColorFirst (run-based windowing)
// ---------------------------------------------------------------------------

test('analyzeMultiHeadWindowsColorFirst — produces at least one window', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const windows = analyzeMultiHeadWindowsColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.ok(windows.length > 0, 'should produce at least one run-based window');
});

test('analyzeMultiHeadWindowsColorFirst — windows never cover the foundation layer (layer 0)', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const windows = analyzeMultiHeadWindowsColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const w of windows) {
        assert.ok(w.windowStart > 0, `window starts at layer 0 (foundation): windowStart=${w.windowStart}`);
    }
});

test('analyzeMultiHeadWindowsColorFirst — errorFactor is never negative', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const windows = analyzeMultiHeadWindowsColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const w of windows) {
        assert.ok(w.errorFactor >= -1e-9,
            `window [${w.windowStart}–${w.windowEnd}] errorFactor=${w.errorFactor}`);
    }
});

test('analyzeMultiHeadWindowsColorFirst — windows span multiple layers (not just N)', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const windows = analyzeMultiHeadWindowsColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    const N = 2;
    const widerThanN = windows.some((w) => w.windowEnd - w.windowStart + 1 > N);
    assert.ok(widerThanN, 'at least one run-based window should span more than N=2 printer layers');
});

test('analyzeMultiHeadWindowsColorFirst — returns empty for insufficient data', () => {
    const result = generateAutoLayers(FOUR_FILAMENTS, gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    assert.equal(
        analyzeMultiHeadWindowsColorFirst([F0], result, gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2).length,
        0
    );
    assert.equal(
        analyzeMultiHeadWindowsColorFirst(FOUR_FILAMENTS, result, [], LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2).length,
        0
    );
});

test('analyzeMultiHeadWindowsColorFirst — LUT indices in pixelOptimalLUTIdx are valid or -1', () => {
    const swatches = gradient(20);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const windows = analyzeMultiHeadWindowsColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const w of windows) {
        for (const idx of w.pixelOptimalLUTIdx) {
            assert.ok(
                idx === -1 || (idx >= 0 && idx < w.lut.length),
                `pixelOptimalLUTIdx ${idx} out of range [0, ${w.lut.length})`
            );
        }
    }
});

// ---------------------------------------------------------------------------
// runMultiHeadLayerAnalysisColorFirst
// ---------------------------------------------------------------------------

test('runMultiHeadLayerAnalysisColorFirst — returns empty for insufficient data', () => {
    const result = generateAutoLayers([BLACK, WHITE], gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    assert.deepEqual(
        runMultiHeadLayerAnalysisColorFirst([BLACK], result, gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2),
        { windows: [], colorAssignments: [], uniqueLayerCount: 0, patchedLayers: [], colorLayerFilaments: new Map() }
    );
    assert.deepEqual(
        runMultiHeadLayerAnalysisColorFirst([BLACK, WHITE], result, [], LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2),
        { windows: [], colorAssignments: [], uniqueLayerCount: 0, patchedLayers: [], colorLayerFilaments: new Map() }
    );
});

test('runMultiHeadLayerAnalysisColorFirst — colorAssignments length matches windows length', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { windows, colorAssignments } = runMultiHeadLayerAnalysisColorFirst(
        [BLACK, WHITE], result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(colorAssignments.length, windows.length);
});

test('runMultiHeadLayerAnalysisColorFirst — colorAssignments only contain input hex colors', () => {
    const swatches = gradient(200);
    const knownHexes = new Set(swatches.map((s) => s.hex));
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { colorAssignments } = runMultiHeadLayerAnalysisColorFirst(
        [BLACK, WHITE], result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let i = 0; i < colorAssignments.length; i++) {
        for (const hex of colorAssignments[i].keys()) {
            assert.ok(knownHexes.has(hex), `colorAssignments[${i}] contains unknown hex "${hex}"`);
        }
    }
});

test('runMultiHeadLayerAnalysisColorFirst — all slot indices in colorAssignments are valid', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { windows, colorAssignments } = runMultiHeadLayerAnalysisColorFirst(
        [BLACK, WHITE], result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let i = 0; i < windows.length; i++) {
        const numFilaments = windows[i].filamentIds.length;
        for (const [hex, slots] of colorAssignments[i]) {
            for (let s = 0; s < slots.length; s++) {
                assert.ok(
                    slots[s] >= 0 && slots[s] < numFilaments,
                    `colorAssignments[${i}].get("${hex}")[${s}] = ${slots[s]} out of range [0, ${numFilaments})`
                );
            }
        }
    }
});

test('runMultiHeadLayerAnalysisColorFirst — direct lookup resolves to known filament IDs', () => {
    const swatches = gradient(200);
    const filaments = [BLACK, WHITE];
    const knownIds = new Set(filaments.map((f) => f.id));
    const result = generateAutoLayers(filaments, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { windows, colorAssignments } = runMultiHeadLayerAnalysisColorFirst(
        filaments, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        for (const [hex, slots] of colorAssignments[i]) {
            for (let s = 0; s < slots.length; s++) {
                const id = w.filamentIds[slots[s]];
                assert.ok(knownIds.has(id),
                    `window ${i}, hex "${hex}", slot ${s}: filamentId "${id}" unknown`);
            }
        }
    }
});

test('runMultiHeadLayerAnalysisColorFirst — uniqueLayerCount is less than swatch count for dense gradient', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers([BLACK, WHITE], swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { uniqueLayerCount } = runMultiHeadLayerAnalysisColorFirst(
        [BLACK, WHITE], result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.ok(uniqueLayerCount < swatches.length,
        `expected fewer unique layers than swatches (200), got ${uniqueLayerCount}`);
});

// ---------------------------------------------------------------------------
// colorLayerFilaments + non-overlapping windows
// ---------------------------------------------------------------------------

test('runMultiHeadLayerAnalysisColorFirst — selected windows never overlap', () => {
    const swatches = gradient(40);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { windows } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    const sorted = [...windows].sort((a, b) => a.windowStart - b.windowStart);
    for (let i = 1; i < sorted.length; i++) {
        assert.ok(
            sorted[i].windowStart > sorted[i - 1].windowEnd,
            `windows overlap: [${sorted[i - 1].windowStart}-${sorted[i - 1].windowEnd}] and ` +
            `[${sorted[i].windowStart}-${sorted[i].windowEnd}]`
        );
    }
});

test('runMultiHeadLayerAnalysisColorFirst — colorLayerFilaments has one entry per input colour', () => {
    const swatches = gradient(40);
    const knownHexes = new Set(swatches.map((s) => s.hex));
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { colorLayerFilaments } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const hex of colorLayerFilaments.keys()) {
        assert.ok(knownHexes.has(hex), `colorLayerFilaments has unknown hex "${hex}"`);
    }
    assert.ok(colorLayerFilaments.size > 0, 'expected at least one colour mapping');
});

test('runMultiHeadLayerAnalysisColorFirst — every colour sequence has length = patchedLayers and valid indices', () => {
    const swatches = gradient(40);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { colorLayerFilaments, patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const [hex, seq] of colorLayerFilaments) {
        assert.equal(seq.length, patchedLayers.length, `seq length mismatch for "${hex}"`);
        for (const fi of seq) {
            assert.ok(fi >= 0 && fi < FOUR_FILAMENTS.length, `filamentIdx ${fi} out of range for "${hex}"`);
        }
    }
});

test('runMultiHeadLayerAnalysisColorFirst — at least two colours differ somewhere in their layer sequences', () => {
    const swatches = gradient(40);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { colorLayerFilaments, windows } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    if (windows.length === 0) return; // nothing to mix
    const seqs = [...colorLayerFilaments.values()].map((s) => s.join(','));
    const distinct = new Set(seqs).size;
    assert.ok(distinct > 1, 'expected per-colour variety in filament sequences, all were identical');
});

// ---------------------------------------------------------------------------
// patchedLayers
// ---------------------------------------------------------------------------

test('runMultiHeadLayerAnalysisColorFirst — patchedLayers is empty when no windows are found', () => {
    const result = generateAutoLayers([BLACK, WHITE], gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        [BLACK], result, gradient(10), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(patchedLayers.length, 0);
});

test('runMultiHeadLayerAnalysisColorFirst — patchedLayers is non-empty when windows are found', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { windows, patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    if (windows.length === 0) return; // guard: no windows found, skip
    assert.ok(patchedLayers.length > 0, 'patchedLayers must be non-empty when windows were applied');
});

test('runMultiHeadLayerAnalysisColorFirst — patchedLayers filamentIdx values are all in range', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let i = 0; i < patchedLayers.length; i++) {
        assert.ok(
            patchedLayers[i].filamentIdx >= 0 && patchedLayers[i].filamentIdx < FOUR_FILAMENTS.length,
            `patchedLayers[${i}].filamentIdx = ${patchedLayers[i].filamentIdx} out of range`
        );
    }
});

test('runMultiHeadLayerAnalysisColorFirst — patchedLayers length matches original layer count', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    const originalLayers = expandZonesToPrinterLayers(result, FOUR_FILAMENTS, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    assert.equal(patchedLayers.length, originalLayers.length,
        'patchedLayers must have the same number of entries as the original layer stack');
});

test('runMultiHeadLayerAnalysisColorFirst — patchedLayers startZ values are monotonically non-decreasing', () => {
    const swatches = gradient(200);
    const result = generateAutoLayers(FOUR_FILAMENTS, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    const { patchedLayers } = runMultiHeadLayerAnalysisColorFirst(
        FOUR_FILAMENTS, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let i = 1; i < patchedLayers.length; i++) {
        assert.ok(
            patchedLayers[i].startZ >= patchedLayers[i - 1].startZ,
            `patchedLayers[${i}].startZ=${patchedLayers[i].startZ} < patchedLayers[${i-1}].startZ=${patchedLayers[i-1].startZ}`
        );
    }
});
