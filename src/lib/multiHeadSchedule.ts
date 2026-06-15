import type { Filament, MultiHeadRangeAssignment } from '../types';
import type { WindowResult } from './multiHeadAnalysis';

/** One nozzle's assignment at a schedule event. */
export interface MultiHeadNozzleEntry {
    nozzle: number; // 1-based
    filamentHex: string;
    filamentId: string;
    /** True when this nozzle's filament differs from the previous event (requires a physical swap). */
    changed: boolean;
}

/** A single event in the head-load schedule: either the initial load or a swap checkpoint. */
export interface MultiHeadScheduleEvent {
    /** 1-based printer layer number where this event occurs (0 = before print starts). */
    startLayer: number;
    /** State of every nozzle at this event. */
    nozzles: MultiHeadNozzleEntry[];
    /** Number of nozzles that change filament at this event. */
    swapCount: number;
    /** True for the synthetic "before print" event that shows the initial head setup. */
    isPrePrint?: boolean;
}

export interface BuildMultiHeadScheduleParams {
    multiHeadWindows?: WindowResult[];
    nozzleAssignments?: number[][];
    windowRunFilaments?: string[][];
    nonWindowedRanges?: MultiHeadRangeAssignment[];
    filaments?: Filament[];
}

/**
 * Build the per-checkpoint head-load schedule for multi-head mode, ordered by layer.
 *
 * Each window/non-windowed range starts a "phase" with a specific filament loaded on
 * each nozzle. Where a nozzle's filament differs from the previous phase, the operator
 * must physically swap it — those checkpoints (swapCount > 0) are the layers where the
 * print must pause. The result is consumed both by the on-screen Head Schedule and by
 * the 3MF exporter (to emit pause/`M600` markers at swap layers).
 */
export function buildMultiHeadSchedule({
    multiHeadWindows,
    nozzleAssignments,
    windowRunFilaments,
    nonWindowedRanges,
    filaments,
}: BuildMultiHeadScheduleParams): MultiHeadScheduleEvent[] | null {
    if (
        !multiHeadWindows?.length ||
        !nozzleAssignments?.length ||
        !windowRunFilaments?.length ||
        !filaments?.length
    )
        return null;

    const hexById = new Map<string, string>();
    for (const f of filaments) hexById.set(f.id, f.color);

    // Build a unified sorted list of all print-order events: real windows +
    // non-windowed ranges (pre-window, gaps, post-window).
    type RawEvent =
        | { kind: 'window'; startLayer0: number; w: number }
        | { kind: 'range'; startLayer0: number; range: MultiHeadRangeAssignment };

    const rawEvents: RawEvent[] = [];

    for (let w = 0; w < multiHeadWindows.length; w++) {
        rawEvents.push({ kind: 'window', startLayer0: multiHeadWindows[w].windowStart, w });
    }
    if (nonWindowedRanges) {
        for (const range of nonWindowedRanges) {
            rawEvents.push({ kind: 'range', startLayer0: range.rangeStart, range });
        }
    }

    rawEvents.sort((a, b) => a.startLayer0 - b.startLayer0);
    if (rawEvents.length === 0) return null;

    const events: MultiHeadScheduleEvent[] = [];
    let loadedIds: string[] = [];
    let isFirst = true;

    for (const raw of rawEvents) {
        let newLoadedIds: string[];

        if (raw.kind === 'window') {
            const assgn = nozzleAssignments[raw.w] ?? [];
            const runs = windowRunFilaments[raw.w] ?? [];
            if (loadedIds.length === 0) loadedIds = new Array(assgn.length).fill('');
            newLoadedIds = assgn.map((r, k) => (r === -1 ? loadedIds[k] : (runs[r] ?? '')));
        } else {
            newLoadedIds = raw.range.nozzleFilaments.slice();
            if (loadedIds.length === 0) loadedIds = new Array(newLoadedIds.length).fill('');
        }

        const nozzles: MultiHeadNozzleEntry[] = [];
        let swapCount = 0;
        for (let k = 0; k < newLoadedIds.length; k++) {
            const fid = newLoadedIds[k];
            const hex = hexById.get(fid) ?? '#888888';
            const changed = !isFirst && fid !== loadedIds[k];
            if (changed) swapCount++;
            nozzles.push({ nozzle: k + 1, filamentHex: hex, filamentId: fid, changed });
        }

        events.push({
            startLayer: isFirst ? 0 : raw.startLayer0 + 1,
            nozzles,
            swapCount,
            isPrePrint: isFirst,
        });

        loadedIds = newLoadedIds;
        isFirst = false;
    }

    return events.length > 0 ? events : null;
}
