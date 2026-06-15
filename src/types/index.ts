import type { AutoPaintResult, TransitionZone } from '../lib/autoPaint';
import type { WindowResult } from '../lib/multiHeadAnalysis';
import type { PatchedSliceData } from '../lib/patchedLayersToPlan';
import type { CalibrationResult } from '../lib/calibration';

export type Swatch = { hex: string; a: number };

export interface CustomPalette {
    id: string;
    name: string;
    version: number;
    colors: string[];
    createdAt: number;
    updatedAt: number;
}

export interface Filament {
    id: string;
    color: string;
    td: number;
    calibration?: CalibrationResult;
    name?: string;
    brand?: string;
}

/** Realized nozzle state for a non-windowed layer range (pre-window, gap, or post-window). */
export interface MultiHeadRangeAssignment {
    /** First layer index (0-indexed, inclusive). */
    rangeStart: number;
    /** Last layer index (0-indexed, inclusive). */
    rangeEnd: number;
    /**
     * Which filament is loaded on each head during this range (length = N heads).
     * nozzleFilaments[k] = filament ID for head k+1. '' = head is unused.
     */
    nozzleFilaments: string[];
}

export interface ThreeDControlsStateShape {
    layerHeight: number;
    slicerFirstLayerHeight: number;
    calibrationLayerHeight?: number;
    colorSliceHeights: number[];
    colorOrder: number[];
    filteredSwatches: Swatch[];
    pixelSize: number; // mm per pixel (XY)
    smoothMeshing?: boolean; // boundary-chain smoothed grid meshing
    filaments: Filament[];
    paintMode: 'manual' | 'autopaint';
    // Enhanced color matching options
    enhancedColorMatch?: boolean;
    allowRepeatedSwaps?: boolean;
    heightDithering?: boolean;
    ditherLineWidth?: number;
    /** Flat Paint: build a flat, face-down slab (auto-paint only) */
    flatPaint?: boolean;
    // Optimizer options
    optimizerAlgorithm?: 'exhaustive' | 'simulated-annealing' | 'genetic' | 'auto';
    optimizerSeed?: number;
    regionWeightingMode?: 'uniform' | 'center' | 'edge';
    // Multi-head mode (per-pixel layer order optimization)
    multiHeadMode?: boolean;
    multiHeadCount?: number; // 2–5 heads
    multiHeadSearchDepth?: 'fast' | 'balanced' | 'thorough';
    multiHeadOptimizationMode?: 'color-accuracy' | 'spatial-variance';
    /**
     * Total height override for spatial-variance mode (M * layerHeight).
     * When set, ThreeDView uses this instead of autoPaintResult.totalHeight so
     * the luminance → height mapping quantises to exactly M discrete levels.
     */
    spatialVarianceTotalHeight?: number;
    multiHeadWindows?: WindowResult[];
    /** Reordered transition zones derived from the multi-head patched layer stack. */
    patchedTransitionZones?: TransitionZone[];
    /** Slice data for ThreeDView mesh generation derived from the patched layer stack. */
    patchedSliceData?: PatchedSliceData;
    /**
     * Per image-colour blended colour per printer layer (keys = image palette hex).
     * Drives per-pixel filament mixing in the 3D render: a pixel of colour `hex`
     * shows perColorLayerColors.get(hex)[layerIdx] at each layer.
     */
    perColorLayerColors?: Map<string, string[]>;
    /**
     * Per image-colour filament index per printer layer (keys = image palette hex).
     * colorLayerFilaments.get(hex)[layerIdx] is the global filament-array index
     * that a pixel of colour `hex` uses at that layer.  Used with nozzleAssignments
     * to tag each sub-mesh with the physical nozzle that prints it.
     */
    colorLayerFilaments?: Map<string, number[]>;
    /**
     * Consensus filament ID per run slot per window.
     * windowRunFilaments[w][r] is the filament ID that run slot r carries in window w.
     */
    windowRunFilaments?: string[][];
    /**
     * Optimal nozzle-to-run-slot permutation per window.
     * nozzleAssignments[w][k] = run-slot index for nozzle (k+1) in window w.
     */
    nozzleAssignments?: number[][];
    /** Filament IDs used in non-windowed layers before the first window. */
    preWindowFilaments?: string[];
    /** Nozzle assignments for non-windowed layer ranges (pre-window, gaps, post-window). */
    nonWindowedRanges?: MultiHeadRangeAssignment[];
    // Auto-paint computed state (only used when paintMode is 'autopaint')
    autoPaintResult?: AutoPaintResult;
    autoPaintSwatches?: Swatch[];
    autoPaintFilamentSwatches?: Swatch[];
}
