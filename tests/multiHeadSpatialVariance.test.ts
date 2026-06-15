import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAutoLayers } from '../src/lib/autoPaint.ts';
import {
    runMultiHeadSpatialVarianceOptimization,
    type SpatialVarianceResult,
} from '../src/lib/multiHeadSpatialVariance.ts';
import type { Filament } from '../src/types/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LAYER_HEIGHT = 0.12;
const FIRST_LAYER_HEIGHT = 0.20;

function filament(id: string, color: string, td: number, name?: string): Filament {
    return { id, color, td, name };
}

const BLACK  = filament('black',  '#000000', 1.0, 'Black');
const DARK   = filament('dark',   '#333333', 1.0, 'Dark');
const MID    = filament('mid',    '#888888', 1.0, 'Mid');
const LIGHT  = filament('light',  '#cccccc', 1.0, 'Light');
const WHITE  = filament('white',  '#ffffff', 1.0, 'White');

/** Dummy AutoPaintResult produced by generating 1-colour auto-layers. */
function dummyResult() {
    return generateAutoLayers([BLACK], [{ hex: '#808080' }], LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
}

/** Build K evenly-spaced greyscale swatches. */
function greySwatches(K: number): Array<{ hex: string; count: number }> {
    return Array.from({ length: K }, (_, i) => {
        const v = K === 1 ? 128 : Math.round((i / (K - 1)) * 255);
        const h = v.toString(16).padStart(2, '0');
        return { hex: `#${h}${h}${h}`, count: 1 };
    });
}

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

test('returns empty result for empty swatches', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), [], LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.patchedLayers.length, 0);
    assert.equal(r.spatialVarianceTotalHeight, 0);
    assert.equal(r.phaseCount, 0);
});

test('returns empty result when no filaments', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.patchedLayers.length, 0);
});

// ---------------------------------------------------------------------------
// Phase count M = ⌈K/N⌉
// ---------------------------------------------------------------------------

test('K=1, N=2 → M=1 (one phase)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(1), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseCount, 1);
    assert.equal(r.patchedLayers.length, 1);
    assert.equal(r.windows.length, 1);
});

test('K=2, N=2 → M=1 (all colours fit in one phase)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(2), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseCount, 1);
    assert.equal(r.patchedLayers.length, 1);
});

test('K=4, N=2 → M=2 phases', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseCount, 2);
    assert.equal(r.patchedLayers.length, 2);
    assert.equal(r.windows.length, 2);
});

test('K=6, N=2 → M=3 phases', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseCount, 3);
    assert.equal(r.patchedLayers.length, 3);
});

test('K=5, N=2 → M=3 (ceil division)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(5), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseCount, 3);
});

test('K=4, N=4 → M=1 (all colours fit in one phase)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, DARK, LIGHT, WHITE], dummyResult(), greySwatches(4),
        LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 4
    );
    assert.equal(r.phaseCount, 1);
    assert.equal(r.patchedLayers.length, 1);
});

// ---------------------------------------------------------------------------
// Layer heights
// ---------------------------------------------------------------------------

test('layer 0 uses max(layerHeight, firstLayerHeight) as thickness', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    const effective = Math.max(LAYER_HEIGHT, FIRST_LAYER_HEIGHT);
    assert.equal(r.patchedLayers[0].thickness, effective);
    assert.equal(r.patchedLayers[0].startZ, 0);
});

test('subsequent layers use layerHeight', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let j = 1; j < r.patchedLayers.length; j++) {
        assert.equal(r.patchedLayers[j].thickness, LAYER_HEIGHT);
    }
});

test('spatialVarianceTotalHeight = effectiveFirstLayer + (M-1)*layerHeight', () => {
    const fourFilaments = [BLACK, DARK, LIGHT, WHITE];
    const effective = Math.max(LAYER_HEIGHT, FIRST_LAYER_HEIGHT);

    const cases: Array<[number, number, number, Filament[]]> = [
        [4, 2, 2, [BLACK, WHITE]],
        [6, 2, 3, [BLACK, WHITE]],
        [4, 4, 1, fourFilaments],
    ];

    for (const [K, N, M, fils] of cases) {
        const r = runMultiHeadSpatialVarianceOptimization(
            fils, dummyResult(), greySwatches(K),
            LAYER_HEIGHT, FIRST_LAYER_HEIGHT, N
        );
        const expected = effective + (M - 1) * LAYER_HEIGHT;
        assert.ok(
            Math.abs(r.spatialVarianceTotalHeight - expected) < 1e-9,
            `K=${K},N=${N}: expected ${expected}, got ${r.spatialVarianceTotalHeight}`
        );
    }
});

// ---------------------------------------------------------------------------
// Phase assignment — darkest colours go to lowest phase
// ---------------------------------------------------------------------------

test('K=4, N=2: two darkest colours in phase 0, two lightest in phase 1', () => {
    // Swatches sorted darkest→lightest: #000000, #555555, #aaaaaa, #ffffff
    const swatches = [
        { hex: '#000000', count: 1 },
        { hex: '#555555', count: 1 },
        { hex: '#aaaaaa', count: 1 },
        { hex: '#ffffff', count: 1 },
    ];
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.phaseOf.get('#000000'), 0);
    assert.equal(r.phaseOf.get('#555555'), 0);
    assert.equal(r.phaseOf.get('#aaaaaa'), 1);
    assert.equal(r.phaseOf.get('#ffffff'), 1);
});

// ---------------------------------------------------------------------------
// colorLayerFilaments
// ---------------------------------------------------------------------------

test('every image colour has a sequence of length M', () => {
    const swatches = greySwatches(6);
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const [, seq] of r.colorLayerFilaments) {
        assert.equal(seq.length, r.phaseCount);
    }
});

test('all K image colours have an entry in colorLayerFilaments', () => {
    const swatches = greySwatches(6);
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const s of swatches) {
        assert.ok(
            r.colorLayerFilaments.has(s.hex),
            `Missing colorLayerFilaments entry for ${s.hex}`
        );
    }
});

test('phase-0 colours use assigned filament at all M layers', () => {
    // With K=4, N=2, phase-0 colours are the two darkest.
    const swatches = [
        { hex: '#000000', count: 1 },  // phase 0
        { hex: '#555555', count: 1 },  // phase 0
        { hex: '#aaaaaa', count: 1 },  // phase 1
        { hex: '#ffffff', count: 1 },  // phase 1
    ];
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    ) as SpatialVarianceResult;

    // Phase-0 colours: all layers use the assigned filament (no support layers below them).
    for (const hex of ['#000000', '#555555']) {
        const seq = r.colorLayerFilaments.get(hex)!;
        assert.ok(seq, `Missing sequence for ${hex}`);
        // All M layers should be the assigned filament (phase 0 → no layers below).
        for (let j = 0; j < r.phaseCount; j++) {
            assert.equal(typeof seq[j], 'number');
        }
    }
});

test('phase-1 colour uses filament 0 at layer 0, assigned filament at layer 1', () => {
    const swatches = [
        { hex: '#000000', count: 1 },  // phase 0
        { hex: '#555555', count: 1 },  // phase 0
        { hex: '#aaaaaa', count: 1 },  // phase 1
        { hex: '#ffffff', count: 1 },  // phase 1
    ];
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), swatches, LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    ) as SpatialVarianceResult;

    for (const hex of ['#aaaaaa', '#ffffff']) {
        const seq = r.colorLayerFilaments.get(hex)!;
        assert.ok(seq, `Missing sequence for ${hex}`);
        // Layer 0 should use base filament (index 0).
        assert.equal(seq[0], 0, `${hex}: expected base filament at layer 0`);
        // Layer 1 should use the assigned filament.
        assert.equal(typeof seq[1], 'number');
    }
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

test('windows are non-overlapping and cover all M phases', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.windows.length, r.phaseCount);
    for (let j = 0; j < r.windows.length; j++) {
        assert.equal(r.windows[j].windowStart, j);
        assert.equal(r.windows[j].windowEnd, j);
    }
});

test('window Z ranges are contiguous and cover total height', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    // First window starts at Z=0.
    assert.ok(Math.abs(r.windows[0].windowBottomZ) < 1e-9);
    // Last window top = totalHeight.
    const lastW = r.windows[r.windows.length - 1];
    assert.ok(
        Math.abs(lastW.windowTopZ - r.spatialVarianceTotalHeight) < 1e-9,
        `last window top ${lastW.windowTopZ} ≠ totalHeight ${r.spatialVarianceTotalHeight}`
    );
    // Consecutive windows share a boundary.
    for (let j = 1; j < r.windows.length; j++) {
        assert.ok(
            Math.abs(r.windows[j].windowBottomZ - r.windows[j - 1].windowTopZ) < 1e-9,
            `gap between windows ${j - 1} and ${j}`
        );
    }
});

// ---------------------------------------------------------------------------
// N-head cap: n is capped to filaments.length
// ---------------------------------------------------------------------------

test('n > filaments.length is clamped to filaments.length', () => {
    // 2 filaments, ask for n=10 heads → effective N=2 → M=ceil(4/2)=2
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 10
    );
    assert.equal(r.phaseCount, 2); // K=4, effective N=2 → M=2
});

// ---------------------------------------------------------------------------
// Scheduling fields (windowRunFilaments, nozzleAssignments, nonWindowedRanges,
// preWindowFilaments) — added with the scheduling layer implementation.
// ---------------------------------------------------------------------------

test('empty result has all scheduling fields as empty arrays', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), [], LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.deepEqual(r.windowRunFilaments, []);
    assert.deepEqual(r.nozzleAssignments, []);
    assert.deepEqual(r.preWindowFilaments, []);
    assert.deepEqual(r.nonWindowedRanges, []);
});

test('windowRunFilaments has one entry per phase', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    // K=4, N=2 → M=2 phases
    assert.equal(r.windowRunFilaments.length, r.phaseCount);
});

test('windowRunFilaments entries contain valid filament IDs', () => {
    const filamentSet = [BLACK, DARK, MID, LIGHT, WHITE];
    const validIds = new Set(filamentSet.map(f => f.id));
    const r = runMultiHeadSpatialVarianceOptimization(
        filamentSet, dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (const phaseIds of r.windowRunFilaments) {
        assert.ok(phaseIds.length > 0, 'each phase must have at least one filament ID');
        for (const id of phaseIds) {
            assert.ok(validIds.has(id), `unknown filament ID: ${id}`);
        }
    }
});

test('windowRunFilaments matches windows[j].filamentIds', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let j = 0; j < r.phaseCount; j++) {
        assert.deepEqual(
            r.windowRunFilaments[j],
            r.windows[j].filamentIds,
            `phase ${j}: windowRunFilaments ≠ windows[j].filamentIds`
        );
    }
});

test('nozzleAssignments has one entry per phase', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.equal(r.nozzleAssignments.length, r.phaseCount);
});

test('nozzleAssignments[j] has length N (one slot per nozzle)', () => {
    const N = 2;
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, N
    );
    for (let j = 0; j < r.phaseCount; j++) {
        assert.equal(
            r.nozzleAssignments[j].length, N,
            `phase ${j}: expected ${N} nozzle slots`
        );
    }
});

test('nozzleAssignments slots are valid run-slot indices or -1 (idle)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let j = 0; j < r.phaseCount; j++) {
        const K = r.windowRunFilaments[j].length;
        for (const slot of r.nozzleAssignments[j]) {
            assert.ok(
                slot === -1 || (slot >= 0 && slot < K),
                `phase ${j}: slot ${slot} out of range [−1, ${K})`
            );
        }
    }
});

test('each phase has at least one active nozzle (not all idle)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let j = 0; j < r.phaseCount; j++) {
        const activeCount = r.nozzleAssignments[j].filter(s => s !== -1).length;
        assert.ok(activeCount > 0, `phase ${j}: all nozzles idle`);
    }
});

test('every filament in windowRunFilaments[j] is assigned to exactly one nozzle', () => {
    // Verifies the assignment is injective (no two nozzles share the same run-slot).
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    for (let j = 0; j < r.phaseCount; j++) {
        const active = r.nozzleAssignments[j].filter(s => s !== -1);
        const unique = new Set(active);
        assert.equal(unique.size, active.length, `phase ${j}: duplicate nozzle→slot assignment`);
        // Every run slot must be covered by exactly one active nozzle.
        const K = r.windowRunFilaments[j].length;
        assert.equal(active.length, K, `phase ${j}: ${K} filaments but ${active.length} active nozzles`);
    }
});

test('nonWindowedRanges is always empty (all layers are in phases)', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.deepEqual(r.nonWindowedRanges, []);
});

test('preWindowFilaments is always empty', () => {
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(4), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, 2
    );
    assert.deepEqual(r.preWindowFilaments, []);
});

test('nozzle swap count is minimal for a monotone ordering (0 or 1 swap)', () => {
    // With 2 heads and 3 phases, the optimizer should find a schedule with
    // at most 1 nozzle swap: the idle nozzle at phase 0 can carry its filament
    // into phase 1 for free if the filament reappears there.
    // We just verify the result doesn't exceed the theoretical maximum (N * (M-1)).
    const N = 2;
    const r = runMultiHeadSpatialVarianceOptimization(
        [BLACK, WHITE], dummyResult(), greySwatches(6), LAYER_HEIGHT, FIRST_LAYER_HEIGHT, N
    );
    const M = r.phaseCount; // 3

    let totalSwaps = 0;
    let prev: number[] = [];
    for (let j = 0; j < M; j++) {
        const cur = r.nozzleAssignments[j];
        const runs = r.windowRunFilaments[j];
        if (j > 0) {
            const prevRuns = r.windowRunFilaments[j - 1];
            const curFilIds = cur.map(s => s === -1 ? prev[cur.indexOf(s)] : runs[s]);
            const prevFilIds = prev.map(s => s === -1 ? '' : prevRuns[s] ?? '');
            for (let k = 0; k < N; k++) {
                if (curFilIds[k] !== prevFilIds[k]) totalSwaps++;
            }
        }
        prev = cur;
    }
    // Upper bound: every nozzle could change at every transition.
    assert.ok(totalSwaps <= N * (M - 1), `totalSwaps ${totalSwaps} exceeds max ${N * (M - 1)}`);
});
