import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMultiHeadSchedule } from '../src/lib/multiHeadSchedule.ts';
import type { Filament, MultiHeadRangeAssignment } from '../src/types/index.ts';
import type { WindowResult } from '../src/lib/multiHeadAnalysis.ts';

// Minimal window — buildMultiHeadSchedule only reads `windowStart`.
const win = (start: number): WindowResult =>
    ({ windowStart: start, windowEnd: start }) as unknown as WindowResult;

const fil = (id: string, color: string): Filament => ({ id, color, td: 0.5 });

const FILAMENTS = [
    fil('A', '#aaaaaa'),
    fil('B', '#bbbbbb'),
    fil('C', '#cccccc'),
    fil('D', '#dddddd'),
];

test('buildMultiHeadSchedule returns null without the required inputs', () => {
    assert.equal(buildMultiHeadSchedule({}), null);
    assert.equal(
        buildMultiHeadSchedule({ multiHeadWindows: [win(0)], filaments: FILAMENTS }),
        null,
        'needs nozzleAssignments + windowRunFilaments too'
    );
});

test('buildMultiHeadSchedule: pre-print load + a full 2-head swap at a window boundary', () => {
    const events = buildMultiHeadSchedule({
        multiHeadWindows: [win(0), win(8)],
        nozzleAssignments: [
            [0, 1],
            [0, 1],
        ],
        windowRunFilaments: [
            ['A', 'B'],
            ['C', 'D'],
        ],
        filaments: FILAMENTS,
    });

    assert.ok(events, 'expected a schedule');
    assert.equal(events!.length, 2);

    const [load, swap] = events!;

    // Pre-print event: layer 0, no swaps, both heads loaded.
    assert.equal(load.startLayer, 0);
    assert.equal(load.isPrePrint, true);
    assert.equal(load.swapCount, 0);
    assert.deepEqual(
        load.nozzles.map((n) => [n.nozzle, n.filamentId, n.filamentHex, n.changed]),
        [
            [1, 'A', '#aaaaaa', false],
            [2, 'B', '#bbbbbb', false],
        ]
    );

    // Swap checkpoint: windowStart 8 -> 1-based startLayer 9, both heads change.
    assert.equal(swap.startLayer, 9);
    assert.equal(swap.isPrePrint, false);
    assert.equal(swap.swapCount, 2);
    assert.deepEqual(
        swap.nozzles.map((n) => [n.nozzle, n.filamentId, n.changed]),
        [
            [1, 'C', true],
            [2, 'D', true],
        ]
    );
});

test('buildMultiHeadSchedule: only the heads that actually change are counted as swaps', () => {
    const events = buildMultiHeadSchedule({
        multiHeadWindows: [win(0), win(4)],
        nozzleAssignments: [
            [0, 1],
            [0, 1],
        ],
        // head 1 keeps 'A', head 2 changes 'B' -> 'C'
        windowRunFilaments: [
            ['A', 'B'],
            ['A', 'C'],
        ],
        filaments: FILAMENTS,
    });

    const swap = events!.at(-1)!;
    assert.equal(swap.startLayer, 5);
    assert.equal(swap.swapCount, 1);
    assert.deepEqual(
        swap.nozzles.map((n) => n.changed),
        [false, true]
    );
});

test('buildMultiHeadSchedule: non-windowed ranges participate and sort by start layer', () => {
    const range: MultiHeadRangeAssignment = {
        rangeStart: 12,
        rangeEnd: 20,
        nozzleFilaments: ['A', 'D'],
    };
    const events = buildMultiHeadSchedule({
        multiHeadWindows: [win(0)],
        nozzleAssignments: [[0, 1]],
        windowRunFilaments: [['A', 'B']],
        nonWindowedRanges: [range],
        filaments: FILAMENTS,
    });

    assert.equal(events!.length, 2);
    assert.equal(events![0].startLayer, 0); // pre-print (window at 0)
    assert.equal(events![1].startLayer, 13); // range at 12 -> 1-based 13
    // head 1 stays 'A', head 2 'B' -> 'D'
    assert.equal(events![1].swapCount, 1);
});
