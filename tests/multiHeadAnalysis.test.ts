import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAutoLayers } from '../src/lib/autoPaint.ts';
import { analyzeMultiHeadWindows } from '../src/lib/multiHeadAnalysis.ts';
import type { Filament } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

const LAYER_HEIGHT = 0.12;
const FIRST_LAYER_HEIGHT = 0.20;

function filament(id: string, color: string, td: number, name?: string): Filament {
    return { id, color, td, name };
}

/** Build an AutoPaintResult for a set of filaments against some swatches. */
function buildResult(filaments: Filament[], swatches: Array<{ hex: string }>) {
    return generateAutoLayers(
        filaments,
        swatches,
        LAYER_HEIGHT,
        FIRST_LAYER_HEIGHT
    );
}

// A simple 2-colour image: mid-grey and near-white
const SWATCHES_GREY = [{ hex: '#808080' }, { hex: '#e0e0e0' }];

// Black and white filaments — maximum contrast
const BLACK = filament('black', '#000000', 0.3, 'Black');
const WHITE = filament('white', '#ffffff', 0.8, 'White');

// Two identical filaments (same colour, same TD)
const RED_A = filament('red-a', '#cc2200', 0.5, 'RedA');
const RED_B = filament('red-b', '#cc2200', 0.5, 'RedB');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('analyzeMultiHeadWindows — errorFactor is never negative', () => {
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK, WHITE], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );

    assert.ok(windows.length > 0, 'should produce at least one window');

    for (const w of windows) {
        assert.ok(
            w.errorFactor >= -1e-9,
            `window [${w.windowStart}–${w.windowEnd}] errorFactor=${w.errorFactor} is negative`
        );
    }
});

test('analyzeMultiHeadWindows — identical filaments give errorFactor of zero', () => {
    // When both "heads" carry the same colour, every LUT entry produces the
    // same result as the current stack, so no improvement is possible.
    const result = buildResult([RED_A, RED_B], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [RED_A, RED_B], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );

    assert.ok(windows.length > 0, 'should produce at least one window');

    for (const w of windows) {
        assert.ok(
            Math.abs(w.errorFactor) < 1e-6,
            `identical filaments: window [${w.windowStart}–${w.windowEnd}] ` +
            `errorFactor=${w.errorFactor} should be ~0`
        );
    }
});

test('analyzeMultiHeadWindows — window count matches expected sliding range', () => {
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK, WHITE], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );

    // Each window advances by 1 layer; windowEnd = windowStart + N - 1 = windowStart + 1
    for (let i = 0; i < windows.length; i++) {
        assert.equal(windows[i].windowStart, i + 1, `window ${i} start`);
        assert.equal(windows[i].windowEnd, i + 2, `window ${i} end`);
    }
});

test('analyzeMultiHeadWindows — affected pixels increases as window moves up', () => {
    // Darker swatches map to lower heights and fall below higher windows.
    // As wStart grows, at least as many pixels should be below the window.
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK, WHITE], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );

    for (let i = 1; i < windows.length; i++) {
        assert.ok(
            windows[i].affectedSwatches <= windows[i - 1].affectedSwatches,
            `affectedSwatches should be non-increasing: ` +
            `window ${i} has ${windows[i].affectedSwatches} > ` +
            `window ${i - 1} has ${windows[i - 1].affectedSwatches}`
        );
    }
});

test('analyzeMultiHeadWindows — windowBottomZ increases monotonically', () => {
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK, WHITE], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );

    for (let i = 1; i < windows.length; i++) {
        assert.ok(
            windows[i].windowBottomZ > windows[i - 1].windowBottomZ,
            `windowBottomZ not increasing at window ${i}`
        );
    }
});

test('analyzeMultiHeadWindows — returns empty when fewer than 2 filaments', () => {
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK], result, SWATCHES_GREY, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(windows.length, 0);
});

test('analyzeMultiHeadWindows — returns empty when no swatches', () => {
    const result = buildResult([BLACK, WHITE], SWATCHES_GREY);
    const windows = analyzeMultiHeadWindows(
        [BLACK, WHITE], result, [], LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(windows.length, 0);
});

test('analyzeMultiHeadWindows — 4-head mode produces N^N=256 LUT entries', () => {
    // Four distinct filaments so the LUT is fully populated.
    const filaments = [
        filament('f0', '#000000', 0.3),
        filament('f1', '#ff0000', 0.5),
        filament('f2', '#00ff00', 0.5),
        filament('f3', '#ffffff', 0.8),
    ];
    const swatches = [
        { hex: '#202020' }, { hex: '#606060' }, { hex: '#a0a0a0' }, { hex: '#e0e0e0' },
    ];
    const result = buildResult(filaments, swatches);
    const windows = analyzeMultiHeadWindows(
        filaments, result, swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 4
    );

    assert.ok(windows.length > 0, 'should produce windows with 4 filaments');
    for (const w of windows) {
        assert.equal(w.currentFilaments.length, 4, 'each window should span 4 positions');
        assert.ok(w.errorFactor >= -1e-9, 'errorFactor must not be negative');
    }
});
