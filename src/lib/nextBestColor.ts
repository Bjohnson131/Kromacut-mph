import type { Filament } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Minimal color math — inlined to avoid pulling in autoPaint's optimizer dep.
// ---------------------------------------------------------------------------

interface RGB { r: number; g: number; b: number }
interface Lab { L: number; a: number; b: number }

function hexToRgb(hex: string): RGB {
    const h = hex.replace(/^#/, '');
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

// IEC 61966-2-1 sRGB linearisation thresholds and coefficients.
const SRGB_LINEARISE_THRESHOLD = 0.04045;
const SRGB_LINEARISE_SCALE     = 12.92;
const SRGB_LINEARISE_OFFSET    = 0.055;
const SRGB_LINEARISE_DENOM     = 1.055;
const SRGB_LINEARISE_GAMMA     = 2.4;

// IEC 61966-2-1 sRGB → CIE XYZ (D65) matrix row coefficients.
const M_RX = 0.4124564, M_GX = 0.3575761, M_BX = 0.1804375;
const M_RY = 0.2126729, M_GY = 0.7151522, M_BY = 0.0721750;
const M_RZ = 0.0193339, M_GZ = 0.1191920, M_BZ = 0.9503041;

// CIE standard illuminant D65 tristimulus values (normalises XYZ to [0,1]).
const D65_X = 0.95047;
const D65_Y = 1.00000;
const D65_Z = 1.08883;

// CIE L*a*b* cube-root approximation thresholds and coefficients (CIE 1976).
const LAB_EPSILON  = 0.008856; // (6/29)³
const LAB_KAPPA    = 7.787;    // (29/6)² / 3  — slope of the linear segment
const LAB_DELTA_16 = 16 / 116; // y-intercept of the linear segment

function rgbToLab(rgb: RGB): Lab {
    const linearise = (v: number) => {
        const s = v / 255;
        return s <= SRGB_LINEARISE_THRESHOLD
            ? s / SRGB_LINEARISE_SCALE
            : Math.pow((s + SRGB_LINEARISE_OFFSET) / SRGB_LINEARISE_DENOM, SRGB_LINEARISE_GAMMA);
    };
    const r = linearise(rgb.r), g = linearise(rgb.g), b = linearise(rgb.b);

    const fx = (r * M_RX + g * M_GX + b * M_BX) / D65_X;
    const fy = (r * M_RY + g * M_GY + b * M_BY) / D65_Y;
    const fz = (r * M_RZ + g * M_GZ + b * M_BZ) / D65_Z;

    const f = (t: number) => t > LAB_EPSILON ? Math.cbrt(t) : LAB_KAPPA * t + LAB_DELTA_16;
    return { L: 116 * f(fy) - 16, a: 500 * (f(fx) - f(fy)), b: 200 * (f(fy) - f(fz)) };
}

function deltaELab(a: Lab, b: Lab): number {
    return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/**
 * CIE76 distance from Lab point P to the nearest point on segment A↔B.
 * In Beer-Lambert blending, any mix of filaments A and B lies on the straight
 * line between them in Lab space, so this gives the minimum ΔE achievable by
 * blending A and B at any ratio.
 */
function distToSegment(P: Lab, A: Lab, B: Lab): number {
    const ABL = B.L - A.L, ABa = B.a - A.a, ABb = B.b - A.b;
    const APL = P.L - A.L, APa = P.a - A.a, APb = P.b - A.b;
    const lenSq = ABL * ABL + ABa * ABa + ABb * ABb;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, (APL * ABL + APa * ABa + APb * ABb) / lenSq)) : 0;
    const dL = APL - t * ABL, da = APa - t * ABa, db = APb - t * ABb;
    return Math.sqrt(dL * dL + da * da + db * db);
}

export interface ColorCandidate {
    hex: string;
    /** Recommended starting TD, derived from the nearest existing filament by ΔE. */
    td: number;
    /**
     * % reduction in blend-aware weighted-average ΔE vs current filament set.
     * The baseline already accounts for existing filament↔filament blend lines,
     * so this reflects how much the new candidate genuinely adds.
     */
    improvementPct: number;
    /** Number of image pixels whose blend-aware error improves with this candidate. */
    pixelsCaptured: number;
    /** 0–1: nearest-filament ΔE normalised to [0,1] across viable candidates. Informational only — ranking uses blend-aware gain directly. */
    isolationScore: number;
}

export interface NextBestColorResult {
    candidate: ColorCandidate | null;
    /** Blend-aware weighted-average ΔE across all image pixels before adding anything. */
    baselineAvgDeltaE: number;
    totalPixels: number;
}

/**
 * Given the current filament set and image swatches, returns the single image
 * color whose addition as a new filament would most reduce the blend-aware
 * weighted-average ΔE between the rendered print and the target image.
 *
 * Blend-aware metric: the "reachable error" for a swatch is the minimum ΔE
 * achievable by any filament point or any blend along a filament↔filament
 * segment in Lab space. Adding candidate C introduces new C↔filament segments,
 * so isolated candidates are naturally rewarded — they create long new segments
 * that sweep previously unreachable regions of Lab space.
 *
 *   currentReachable(swatch) = min over all filament points and F↔F segments
 *   newReachable(swatch, C)  = min(currentReachable, ΔE(swatch,C), min_F dist(swatch, C↔F))
 *   gain(C)                  = Σ_i max(0, currentReachable_i − newReachable_i) × count_i
 */
export function nextBestColor(
    filaments: Filament[],
    imageSwatches: Array<{ hex: string; count?: number }>
): NextBestColorResult {
    const empty: NextBestColorResult = { candidate: null, baselineAvgDeltaE: 0, totalPixels: 0 };

    if (filaments.length === 0 || imageSwatches.length === 0) return empty;

    // Pre-compute Lab values for filaments and swatches.
    const filamentLabs: Lab[] = filaments.map((f) => rgbToLab(hexToRgb(f.color)));
    const swatchLabs: Lab[] = imageSwatches.map((s) => rgbToLab(hexToRgb(s.hex)));
    const counts: number[] = imageSwatches.map((s) => s.count ?? 1);

    // -------------------------------------------------------------------------
    // Baseline: blend-aware reachable error for every swatch.
    // Accounts for direct filament points and all existing filament↔filament
    // blend lines (Beer-Lambert linear interpolation in Lab space).
    // -------------------------------------------------------------------------
    const currentReachable: number[] = swatchLabs.map((sLab) => {
        let best = Infinity;
        for (const fLab of filamentLabs) {
            best = Math.min(best, deltaELab(sLab, fLab));
        }
        for (let fi = 0; fi < filamentLabs.length; fi++) {
            for (let fj = fi + 1; fj < filamentLabs.length; fj++) {
                best = Math.min(best, distToSegment(sLab, filamentLabs[fi], filamentLabs[fj]));
            }
        }
        return best;
    });

    const totalPixels = counts.reduce((s, c) => s + c, 0);
    const baselineTotal = currentReachable.reduce((s, e, i) => s + e * counts[i], 0);
    const baselineAvgDeltaE = totalPixels > 0 ? baselineTotal / totalPixels : 0;

    if (baselineAvgDeltaE === 0) return { candidate: null, baselineAvgDeltaE: 0, totalPixels };

    // -------------------------------------------------------------------------
    // Score each candidate.
    // Restrict the candidate pool to the most underserved swatches — those at
    // or above the 75th percentile of blend-aware reachable error — so the
    // O(candidates × swatches × filaments) inner loop only runs for colors
    // that genuinely lack coverage.  Also skip near-duplicates of existing
    // filaments regardless of percentile rank.
    // -------------------------------------------------------------------------
    const COVERAGE_THRESHOLD = 3.0; // ΔE — skip near-duplicates of existing filaments

    const sortedReachable = [...currentReachable].sort((a, b) => a - b);
    const p75Threshold = sortedReachable[Math.floor(sortedReachable.length * 0.75)];

    interface CandidateScore { idx: number; gain: number; nearestFilamentDE: number }
    const scores: CandidateScore[] = [];

    for (let c = 0; c < swatchLabs.length; c++) {
        if (currentReachable[c] < p75Threshold) continue;

        let nearestFilamentDE = Infinity;
        for (const fLab of filamentLabs) {
            nearestFilamentDE = Math.min(nearestFilamentDE, deltaELab(swatchLabs[c], fLab));
        }
        if (nearestFilamentDE < COVERAGE_THRESHOLD) continue;

        // For each swatch, compute the new reachable error if candidate C is added.
        // This includes direct distance to C and segments from C to every existing filament.
        let gain = 0;
        for (let i = 0; i < swatchLabs.length; i++) {
            let newReachable = currentReachable[i];
            newReachable = Math.min(newReachable, deltaELab(swatchLabs[i], swatchLabs[c]));
            for (const fLab of filamentLabs) {
                newReachable = Math.min(newReachable, distToSegment(swatchLabs[i], swatchLabs[c], fLab));
            }
            const improvement = currentReachable[i] - newReachable;
            if (improvement > 0) gain += improvement * counts[i];
        }

        scores.push({ idx: c, gain, nearestFilamentDE });
    }

    if (scores.length === 0) return { candidate: null, baselineAvgDeltaE, totalPixels };

    // Isolation score is informational — the blend-aware gain metric already
    // rewards isolated candidates (longer C↔F segments cover more Lab space).
    const maxIsolation = Math.max(...scores.map((s) => s.nearestFilamentDE));

    // Pick winner by blend-aware gain.
    let bestGain = -1;
    let bestIdx = -1;
    for (const s of scores) {
        if (s.gain > bestGain) { bestGain = s.gain; bestIdx = s.idx; }
    }

    if (bestIdx === -1) return { candidate: null, baselineAvgDeltaE, totalPixels };

    // -------------------------------------------------------------------------
    // Build the result for the winning candidate.
    // -------------------------------------------------------------------------
    const candLab = swatchLabs[bestIdx];

    // Pixel capture: swatches whose blend-aware reachable error improves with C.
    let pixelsCaptured = 0;
    for (let i = 0; i < swatchLabs.length; i++) {
        let newReachable = currentReachable[i];
        newReachable = Math.min(newReachable, deltaELab(swatchLabs[i], candLab));
        for (const fLab of filamentLabs) {
            newReachable = Math.min(newReachable, distToSegment(swatchLabs[i], candLab, fLab));
        }
        if (newReachable < currentReachable[i]) pixelsCaptured += counts[i];
    }

    // TD: borrow from nearest existing filament by ΔE.
    let nearestFilamentIdx = 0;
    let nearestDE = Infinity;
    for (let fi = 0; fi < filamentLabs.length; fi++) {
        const de = deltaELab(candLab, filamentLabs[fi]);
        if (de < nearestDE) { nearestDE = de; nearestFilamentIdx = fi; }
    }
    const recommendedTd = filaments[nearestFilamentIdx].td;

    const winnerScore = scores.find((s) => s.idx === bestIdx)!;
    const isolationScore = winnerScore.nearestFilamentDE / maxIsolation;
    const improvementPct = (bestGain / baselineTotal) * 100;

    console.group(
        `[NextBestColor] ${filaments.length} filament${filaments.length !== 1 ? 's' : ''} → ` +
        `${imageSwatches.length} image colors | ${totalPixels.toLocaleString()} px`
    );
    console.log(`  Baseline avg ΔE:  ${baselineAvgDeltaE.toFixed(2)}  (blend-aware)`);
    console.log(
        `  Suggestion:       ${imageSwatches[bestIdx].hex.toUpperCase()}  TD ${recommendedTd.toFixed(2)}`
    );
    console.log(
        `  Accuracy gain:    +${improvementPct.toFixed(1)}%  ` +
        `(${pixelsCaptured.toLocaleString()} px / ` +
        `${((pixelsCaptured / totalPixels) * 100).toFixed(1)}% of image improve)`
    );
    console.log(
        `  Isolation:        ${isolationScore.toFixed(3)}  ` +
        `(nearest filament ΔE ${winnerScore.nearestFilamentDE.toFixed(1)} / ` +
        `max ${maxIsolation.toFixed(1)})`
    );
    console.groupEnd();

    return {
        candidate: {
            hex: imageSwatches[bestIdx].hex,
            td: recommendedTd,
            improvementPct,
            pixelsCaptured,
            isolationScore,
        },
        baselineAvgDeltaE,
        totalPixels,
    };
}
