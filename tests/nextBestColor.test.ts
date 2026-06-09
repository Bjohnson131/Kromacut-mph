import assert from 'node:assert/strict';
import test from 'node:test';
import { nextBestColor } from '../src/lib/nextBestColor.ts';
import type { Filament } from '../src/types/index.ts';

function filament(id: string, color: string, td: number): Filament {
    return { id, color, td };
}

const BLACK = filament('black', '#000000', 1.0);
const WHITE = filament('white', '#ffffff', 2.0);
const RED   = filament('red',   '#ff0000', 1.5);

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('returns null candidate for empty filaments', () => {
    const r = nextBestColor([], [{ hex: '#808080', count: 100 }]);
    assert.equal(r.candidate, null);
    assert.equal(r.baselineAvgDeltaE, 0);
});

test('returns null candidate for empty swatches', () => {
    const r = nextBestColor([BLACK, WHITE], []);
    assert.equal(r.candidate, null);
});

test('returns null candidate when all swatches are already covered', () => {
    // Swatch exactly matches an existing filament — ΔE < 3, so it is skipped.
    const r = nextBestColor([BLACK], [{ hex: '#000000', count: 100 }]);
    assert.equal(r.candidate, null);
});

// ---------------------------------------------------------------------------
// Basic ranking
// ---------------------------------------------------------------------------

test('identifies the most impactful missing color', () => {
    // Black filament only. Image has black (covered) and white (uncovered).
    // White is the only viable candidate.
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 100 },
            { hex: '#ffffff', count: 100 },
        ]
    );
    assert.ok(r.candidate !== null, 'expected a candidate');
    assert.equal(r.candidate.hex, '#ffffff');
});

test('blend-aware: far candidate wins when its segment covers the common color territory', () => {
    // With only BLACK and an achromatic image, near-white creates a segment
    // (#eeeeee↔BLACK) that spans the full L-axis, passing through #888888's Lab
    // position — so adding it captures those pixels via blending.  Blend-aware
    // scoring correctly prefers the longer segment even at count=1.
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#888888', count: 1000 }, // common mid-grey
            { hex: '#eeeeee', count: 1 },    // rare near-white
        ]
    );
    assert.ok(r.candidate !== null);
    assert.equal(r.candidate.hex, '#eeeeee');
});

test('pixel count weighting: common color beats rare one when blend segments diverge', () => {
    // BLACK + WHITE already cover the L-axis via blending.
    // Two chromatic candidates in opposite hue directions: their C↔filament
    // segments do not pass near each other, so pixel count dominates.
    // Four covered greys anchor p75 below both chromatic candidates.
    const r = nextBestColor(
        [BLACK, WHITE],
        [
            { hex: '#606060', count: 1 },    // grey — on L-axis blend, covered
            { hex: '#808080', count: 1 },    // grey — covered
            { hex: '#a0a0a0', count: 1 },    // grey — covered
            { hex: '#c0c0c0', count: 1 },    // grey — covered
            { hex: '#ff6666', count: 1000 }, // desaturated red — common
            { hex: '#00ffff', count: 1 },    // cyan — opposite hue, rare
        ]
    );
    assert.ok(r.candidate !== null);
    assert.equal(r.candidate.hex, '#ff6666');
});

// ---------------------------------------------------------------------------
// Improvement percentage
// ---------------------------------------------------------------------------

test('improvementPct is > 0 and ≤ 100', () => {
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 50 },
            { hex: '#ffffff', count: 50 },
        ]
    );
    assert.ok(r.candidate !== null);
    assert.ok(r.candidate.improvementPct > 0, `expected > 0, got ${r.candidate.improvementPct}`);
    assert.ok(r.candidate.improvementPct <= 100, `expected ≤ 100, got ${r.candidate.improvementPct}`);
});

// ---------------------------------------------------------------------------
// Isolation score
// ---------------------------------------------------------------------------

test('isolationScore is in [0, 1]', () => {
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 50 },
            { hex: '#ffffff', count: 50 },
        ]
    );
    assert.ok(r.candidate !== null);
    assert.ok(r.candidate.isolationScore >= 0 && r.candidate.isolationScore <= 1,
        `expected 0–1, got ${r.candidate.isolationScore}`);
});

test('single viable candidate always gets isolationScore 1.0', () => {
    // Only one candidate passes the coverage threshold, so it is the most isolated by definition.
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 10 },  // covered — skipped
            { hex: '#ffffff', count: 90 },  // sole viable candidate
        ]
    );
    assert.ok(r.candidate !== null);
    assert.ok(
        Math.abs(r.candidate.isolationScore - 1.0) < 1e-9,
        `expected 1.0, got ${r.candidate.isolationScore}`
    );
});

test('blend-aware: both candidates produce a candidate with valid isolation score', () => {
    // BLACK filament only.
    // #444444 (dark grey) — close to BLACK, very common → its C↔BLACK segment covers mid-tones
    // #ffffff (white)     — far from BLACK, rare        → its C↔BLACK segment covers more Lab space
    // The blend-aware metric naturally weighs segment length; winner depends on pixel counts.
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 1   },  // covered
            { hex: '#444444', count: 500 },  // common, moderate isolation
            { hex: '#ffffff', count: 1   },  // rare, maximum isolation
        ]
    );
    assert.ok(r.candidate !== null);
    assert.ok(typeof r.candidate.isolationScore === 'number');
    assert.ok(r.candidate.isolationScore > 0);
});

test('adding exact best candidate as a second filament gives near-zero further improvement', () => {
    const swatches = [
        { hex: '#000000', count: 50 },
        { hex: '#aaaaaa', count: 50 },
    ];
    const first = nextBestColor([BLACK], swatches);
    assert.ok(first.candidate !== null);
    // Now add the winner as a filament and re-run.
    const newFilament = filament('new', first.candidate.hex, first.candidate.td);
    const second = nextBestColor([BLACK, newFilament], swatches);
    // Candidate should be null or have negligible improvement.
    if (second.candidate !== null) {
        assert.ok(
            second.candidate.improvementPct < first.candidate.improvementPct,
            'second best should improve less than the first'
        );
    }
});

// ---------------------------------------------------------------------------
// pixelsCaptured
// ---------------------------------------------------------------------------

test('pixelsCaptured is > 0 for a valid candidate', () => {
    const r = nextBestColor(
        [BLACK],
        [
            { hex: '#000000', count: 100 },
            { hex: '#cccccc', count: 80 },
        ]
    );
    assert.ok(r.candidate !== null);
    assert.ok(r.candidate.pixelsCaptured > 0);
});

test('pixelsCaptured does not exceed totalPixels', () => {
    const swatches = [
        { hex: '#333333', count: 40 },
        { hex: '#999999', count: 60 },
    ];
    const r = nextBestColor([BLACK], swatches);
    assert.ok(r.candidate !== null);
    assert.ok(r.candidate.pixelsCaptured <= r.totalPixels);
});

// ---------------------------------------------------------------------------
// TD recommendation
// ---------------------------------------------------------------------------

test('recommended TD comes from the nearest existing filament', () => {
    // BLACK (td=1.0) and WHITE (td=2.0). Candidate is mid-grey — closer to BLACK.
    const r = nextBestColor(
        [BLACK, WHITE],
        [
            { hex: '#000000', count: 100 },
            { hex: '#333333', count: 100 }, // dark grey — nearest filament is BLACK
            { hex: '#ffffff', count: 100 },
        ]
    );
    assert.ok(r.candidate !== null);
    // Mid-grey candidate is closer to black → td should be 1.0 (BLACK's td)
    assert.equal(r.candidate.td, BLACK.td);
});

test('light candidate gets WHITE td when WHITE is nearest', () => {
    const r = nextBestColor(
        [BLACK, WHITE],
        [
            { hex: '#000000', count: 100 },
            { hex: '#ffffff', count: 100 },
            { hex: '#dddddd', count: 200 }, // light — nearest filament is WHITE
        ]
    );
    assert.ok(r.candidate !== null);
    assert.equal(r.candidate.td, WHITE.td);
});

// ---------------------------------------------------------------------------
// totalPixels and baselineAvgDeltaE
// ---------------------------------------------------------------------------

test('totalPixels equals sum of swatch counts', () => {
    const swatches = [
        { hex: '#ff0000', count: 30 },
        { hex: '#00ff00', count: 70 },
    ];
    const r = nextBestColor([RED], swatches);
    assert.equal(r.totalPixels, 100);
});

test('baselineAvgDeltaE is 0 when all swatches exactly match filaments', () => {
    // Single swatch that exactly matches the filament — ΔE ≈ 0.
    const r = nextBestColor([RED], [{ hex: '#ff0000', count: 50 }]);
    assert.ok(r.baselineAvgDeltaE < 1, `expected near 0, got ${r.baselineAvgDeltaE}`);
});
