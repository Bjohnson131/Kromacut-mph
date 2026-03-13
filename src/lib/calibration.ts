/**
 * Filament Calibration System
 *
 * Implements TD (Transmission Distance) calibration workflow where users measure
 * light transmission through stacked filament layers to derive accurate TD values.
 *
 * Calibration process:
 * 1. User prints test patches at different layer counts (e.g., 2, 4, 6, 8, 10 layers)
 * 2. User photographs patches on backlit surface and samples RGB values
 * 3. Algorithm fits Beer-Lambert curve to derive TD for each color channel
 * 4. Confidence score computed based on fit quality and measurement consistency
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Single measurement point: layer count and measured transmission
 */
export interface CalibrationMeasurement {
    layers: number; // Number of layers printed
    rgb: [number, number, number]; // Measured RGB value (0-255)
    transmission: [number, number, number]; // Normalized transmission (0-1)
}

/**
 * Complete calibration result for a filament
 */
export interface CalibrationResult {
    color: string; // Hex color
    measurements: CalibrationMeasurement[];
    td: [number, number, number]; // Fitted TD for R, G, B channels (mm)
    tdSingleValue: number; // Weighted average TD (mm)
    confidence: number; // 0-1 score based on fit quality
    calibrationDate: string; // ISO timestamp
    notes?: string; // Optional user notes
}

/**
 * Calibration wizard state
 */
export interface CalibrationState {
    filamentColor: string;
    measurements: CalibrationMeasurement[];
    currentStep: 'intro' | 'print' | 'measure' | 'results';
    layerHeight: number; // mm per layer
}

// ============================================================================
// Constants
// ============================================================================

const RECOMMENDED_LAYER_COUNTS = [2, 4, 6, 8, 10];
const MIN_MEASUREMENTS = 3;
const CONFIDENCE_THRESHOLD_EXCELLENT = 0.9;
const CONFIDENCE_THRESHOLD_GOOD = 0.7;

// ============================================================================
// Core Calibration Algorithm
// ============================================================================

/**
 * Calculate TD from calibration measurements using Beer-Lambert law.
 *
 * Beer-Lambert: T = 10^(-d/TD)
 * Where T = transmission, d = distance (layers × layer_height), TD = transmission distance
 *
 * Solving for TD: TD = -d / log10(T)
 *
 * For each channel, we compute TD from each measurement pair, then
 * use weighted least-squares to fit a robust average.
 */
export function calculateTDFromMeasurements(
    measurements: CalibrationMeasurement[],
    layerHeight: number
): { td: [number, number, number]; tdSingleValue: number; confidence: number } {
    if (measurements.length < MIN_MEASUREMENTS) {
        throw new Error(
            `Need at least ${MIN_MEASUREMENTS} measurements, got ${measurements.length}`
        );
    }

    // Sort measurements by layer count
    const sorted = [...measurements].sort((a, b) => a.layers - b.layers);

    // Compute TD for each channel independently
    const tdChannels: [number, number, number] = [0, 0, 0];
    const confidences: [number, number, number] = [0, 0, 0];

    for (let channel = 0; channel < 3; channel++) {
        const { td, confidence } = fitTDForChannel(sorted, channel, layerHeight);
        tdChannels[channel] = td;
        confidences[channel] = confidence;
    }

    // Compute weighted average TD (prefer channels with less transmission for lithophanes)
    const weights = tdChannels.map((td) => 1 / td); // Lower TD = higher weight
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    const tdSingleValue =
        tdChannels.reduce((sum, td, i) => sum + td * weights[i], 0) / weightSum;

    // Overall confidence is the minimum of channel confidences
    const confidence = Math.min(...confidences);

    return { td: tdChannels, tdSingleValue, confidence };
}

/**
 * Fit TD for a single color channel using weighted least-squares
 */
function fitTDForChannel(
    measurements: CalibrationMeasurement[],
    channel: number,
    layerHeight: number
): { td: number; confidence: number } {
    // Compute TD from each measurement
    const tdEstimates: Array<{ td: number; thickness: number; transmission: number }> = [];

    for (const measurement of measurements) {
        const transmission = measurement.transmission[channel];
        if (transmission <= 0 || transmission >= 1) continue; // Skip invalid measurements

        const thickness = measurement.layers * layerHeight;
        const td = -thickness / Math.log10(transmission);

        if (td > 0 && td < 100) {
            // Sanity check: TD should be 0.5-20mm typically
            tdEstimates.push({ td, thickness, transmission });
        }
    }

    if (tdEstimates.length === 0) {
        // Fallback: return default TD with low confidence
        return { td: 2.0, confidence: 0.1 };
    }

    // Weighted average: measurements with moderate transmission (0.2-0.8) get higher weight
    let weightedSum = 0;
    let totalWeight = 0;

    for (const { td, transmission } of tdEstimates) {
        // Weight function: peaks at T=0.5, drops off at extremes
        const weight = 1 - Math.abs(transmission - 0.5) * 2; // 0 at T=0 or T=1, 1 at T=0.5
        weightedSum += td * weight;
        totalWeight += weight;
    }

    const tdFitted = weightedSum / totalWeight;

    // Calculate confidence based on consistency of estimates
    const variance =
        tdEstimates.reduce((sum, { td }) => sum + Math.pow(td - tdFitted, 2), 0) /
        tdEstimates.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / tdFitted;

    // Confidence: 1.0 if CV < 0.1, decreases linearly to 0.5 at CV = 0.4
    const confidence = Math.max(0.5, 1.0 - coefficientOfVariation * 2.5);

    return { td: tdFitted, confidence };
}

/**
 * Convert measured RGB values to normalized transmission values.
 * Assumes white backlight (255, 255, 255) as reference.
 */
export function rgbToTransmission(rgb: [number, number, number]): [number, number, number] {
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/**
 * Estimate expected RGB for a given layer count based on current TD estimate.
 * Useful for showing preview during calibration.
 */
export function predictTransmission(
    filamentColor: string,
    layers: number,
    layerHeight: number,
    td: [number, number, number]
): [number, number, number] {
    const thickness = layers * layerHeight;

    // Parse filament color
    const rgb = hexToRgb(filamentColor);
    if (!rgb) return [128, 128, 128];

    // Beer-Lambert: T = 10^(-d/TD)
    const transmission: [number, number, number] = [
        Math.pow(10, -thickness / td[0]),
        Math.pow(10, -thickness / td[1]),
        Math.pow(10, -thickness / td[2]),
    ];

    // Tint white backlight by filament color
    return [
        Math.round(transmission[0] * (rgb[0] / 255) * 255),
        Math.round(transmission[1] * (rgb[1] / 255) * 255),
        Math.round(transmission[2] * (rgb[2] / 255) * 255),
    ];
}

// ============================================================================
// Confidence Scoring
// ============================================================================

/**
 * Compute confidence score for a filament profile.
 * Takes into account:
 * - Whether calibration data exists
 * - Quality of calibration fit
 * - Age of calibration
 * - Number of measurements
 */
export function computeProfileConfidence(profile: {
    calibration?: CalibrationResult;
    transmissionDistance: number;
}): number {
    if (!profile.calibration) {
        // No calibration data: base confidence on TD value
        // Lower TD = more typical for lithophanes = higher confidence
        const td = profile.transmissionDistance;
        if (td >= 1.0 && td <= 5.0) return 0.5; // Reasonable estimate
        if (td >= 0.5 && td <= 10.0) return 0.3; // Plausible but uncertain
        return 0.1; // Likely a guess
    }

    const cal = profile.calibration;
    let confidence = cal.confidence;

    // Penalize old calibrations (>6 months)
    const ageMs = Date.now() - new Date(cal.calibrationDate).getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths > 6) {
        confidence *= Math.max(0.7, 1 - (ageMonths - 6) / 24); // Decay over 2 years
    }

    // Bonus for more measurements
    const measurementBonus = Math.min(0.1, cal.measurements.length * 0.02);
    confidence = Math.min(1.0, confidence + measurementBonus);

    return confidence;
}

/**
 * Get confidence label for UI display
 */
export function getConfidenceLabel(confidence: number): string {
    if (confidence >= CONFIDENCE_THRESHOLD_EXCELLENT) return 'Excellent';
    if (confidence >= CONFIDENCE_THRESHOLD_GOOD) return 'Good';
    if (confidence >= 0.5) return 'Fair';
    return 'Low';
}

/**
 * Get confidence color for UI display (Tailwind classes)
 */
export function getConfidenceColor(confidence: number): string {
    if (confidence >= CONFIDENCE_THRESHOLD_EXCELLENT) return 'text-green-600';
    if (confidence >= CONFIDENCE_THRESHOLD_GOOD) return 'text-blue-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate a calibration measurement
 */
export function validateMeasurement(
    measurement: CalibrationMeasurement
): { valid: boolean; error?: string } {
    if (measurement.layers < 1 || measurement.layers > 50) {
        return { valid: false, error: 'Layer count must be between 1 and 50' };
    }

    const [r, g, b] = measurement.rgb;
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
        return { valid: false, error: 'RGB values must be between 0 and 255' };
    }

    const [tR, tG, tB] = measurement.transmission;
    if (tR < 0 || tR > 1 || tG < 0 || tG > 1 || tB < 0 || tB > 1) {
        return { valid: false, error: 'Transmission values must be between 0 and 1' };
    }

    return { valid: true };
}

/**
 * Check if measurements are ready for TD calculation
 */
export function canCalculateTD(measurements: CalibrationMeasurement[]): {
    ready: boolean;
    reason?: string;
} {
    if (measurements.length < MIN_MEASUREMENTS) {
        return {
            ready: false,
            reason: `Need at least ${MIN_MEASUREMENTS} measurements (have ${measurements.length})`,
        };
    }

    // Check for duplicate layer counts
    const layerCounts = new Set(measurements.map((m) => m.layers));
    if (layerCounts.size < measurements.length) {
        return { ready: false, reason: 'Duplicate layer counts detected' };
    }

    // Validate each measurement
    for (const measurement of measurements) {
        const validation = validateMeasurement(measurement);
        if (!validation.valid) {
            return { ready: false, reason: validation.error };
        }
    }

    return { ready: true };
}

/**
 * Get recommended layer counts that haven't been measured yet
 */
export function getRecommendedLayerCounts(
    existing: CalibrationMeasurement[]
): { recommended: number[]; measured: number[] } {
    const measured = existing.map((m) => m.layers);
    const recommended = RECOMMENDED_LAYER_COUNTS.filter((count) => !measured.includes(count));
    return { recommended, measured };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse hex color to RGB
 */
function hexToRgb(hex: string): [number, number, number] | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
        : null;
}

/**
 * Generate calibration instructions for user
 */
export function getCalibrationInstructions(layerHeight: number): string[] {
    return [
        `Print test patches with ${RECOMMENDED_LAYER_COUNTS.join(', ')} layers each.`,
        `Use your filament color with 100% infill.`,
        `Layer height: ${layerHeight.toFixed(2)}mm.`,
        `Place patches on a backlit white surface (e.g., phone screen at max brightness).`,
        `Photograph patches under consistent lighting.`,
        `Use color picker tool to sample RGB values from center of each patch.`,
        `Enter measurements in the calibration wizard.`,
    ];
}

/**
 * Export calibration result to JSON for sharing
 */
export function exportCalibration(result: CalibrationResult): string {
    return JSON.stringify(result, null, 2);
}

/**
 * Import calibration result from JSON
 */
export function importCalibration(json: string): CalibrationResult {
    const parsed = JSON.parse(json);

    // Validation
    if (
        !parsed.color ||
        !parsed.measurements ||
        !parsed.td ||
        !parsed.tdSingleValue ||
        !parsed.confidence
    ) {
        throw new Error('Invalid calibration data format');
    }

    return parsed as CalibrationResult;
}
