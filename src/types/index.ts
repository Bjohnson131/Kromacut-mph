import type { AutoPaintResult, TransitionZone } from '../lib/autoPaint';
import type { WindowResult } from '../lib/multiHeadAnalysis';
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

export interface ThreeDControlsStateShape {
    layerHeight: number;
    slicerFirstLayerHeight: number;
    calibrationLayerHeight?: number;
    colorSliceHeights: number[];
    colorOrder: number[];
    filteredSwatches: Swatch[];
    pixelSize: number; // mm per pixel (XY)
    smoothMeshing?: boolean; // marching squares contour meshing
    filaments: Filament[];
    paintMode: 'manual' | 'autopaint';
    // Enhanced color matching options
    enhancedColorMatch?: boolean;
    allowRepeatedSwaps?: boolean;
    heightDithering?: boolean;
    ditherLineWidth?: number;
    // Optimizer options
    optimizerAlgorithm?: 'exhaustive' | 'simulated-annealing' | 'genetic' | 'auto';
    optimizerSeed?: number;
    regionWeightingMode?: 'uniform' | 'center' | 'edge';
    // Multi-head mode (per-pixel layer order optimization)
    multiHeadMode?: boolean;
    multiHeadCount?: number; // 2–5 heads
    multiHeadSearchDepth?: 'fast' | 'balanced' | 'thorough';
    multiHeadWindows?: WindowResult[];
    /** Reordered transition zones derived from the multi-head patched layer stack. */
    patchedTransitionZones?: TransitionZone[];
    // Auto-paint computed state (only used when paintMode is 'autopaint')
    autoPaintResult?: AutoPaintResult;
    autoPaintSwatches?: Swatch[];
    autoPaintFilamentSwatches?: Swatch[];
}