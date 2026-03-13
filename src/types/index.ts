import type { AutoPaintResult } from '../lib/autoPaint';
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
    // Auto-paint computed state (only used when paintMode is 'autopaint')
    autoPaintResult?: AutoPaintResult;
    autoPaintSwatches?: Swatch[];
    autoPaintFilamentSwatches?: Swatch[];
}