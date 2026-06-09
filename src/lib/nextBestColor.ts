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

// CIE XYZ (D65) → sRGB inverse matrix row coefficients.
const M_INV_XR =  3.2404542, M_INV_YR = -1.5371385, M_INV_ZR = -0.4985314;
const M_INV_XG = -0.9692660, M_INV_YG =  1.8760108, M_INV_ZG =  0.0415560;
const M_INV_XB =  0.0556434, M_INV_YB = -0.2040259, M_INV_ZB =  1.0572252;

// CIE standard illuminant D65 tristimulus values (normalises XYZ to [0,1]).
const D65_X = 0.95047;
const D65_Y = 1.00000;
const D65_Z = 1.08883;

// CIE L*a*b* cube-root approximation thresholds and coefficients (CIE 1976).
const LAB_EPSILON     = 0.008856; // (6/29)³
const LAB_KAPPA       = 7.787;    // (29/6)² / 3  — slope of the linear segment
const LAB_DELTA_16    = 16 / 116; // y-intercept of the linear segment
const LAB_INV_CBRT    = 6 / 29;   // cbrt(LAB_EPSILON) — Lab→XYZ cube-root threshold

// Threshold for linear RGB values in the sRGB de-linearisation step.
// Derived from SRGB_LINEARISE_THRESHOLD / SRGB_LINEARISE_SCALE ≈ 0.0031308.
const SRGB_LINEAR_THRESHOLD = SRGB_LINEARISE_THRESHOLD / SRGB_LINEARISE_SCALE;

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

function labToHex(lab: Lab): string {
    // Lab → XYZ (D65)
    const fy = (lab.L + 16) / 116;
    const fx = lab.a / 500 + fy;
    const fz = fy - lab.b / 200;
    const invF = (f: number) => f > LAB_INV_CBRT ? f * f * f : (f - LAB_DELTA_16) / LAB_KAPPA;
    const X = D65_X * invF(fx);
    const Y = D65_Y * invF(fy);
    const Z = D65_Z * invF(fz);

    // XYZ → linear sRGB (clamp to [0,1] to handle out-of-gamut Lab values)
    const rl = Math.max(0, Math.min(1, M_INV_XR * X + M_INV_YR * Y + M_INV_ZR * Z));
    const gl = Math.max(0, Math.min(1, M_INV_XG * X + M_INV_YG * Y + M_INV_ZG * Z));
    const bl = Math.max(0, Math.min(1, M_INV_XB * X + M_INV_YB * Y + M_INV_ZB * Z));

    // Linear → sRGB
    const delinearise = (c: number) =>
        c <= SRGB_LINEAR_THRESHOLD
            ? c * SRGB_LINEARISE_SCALE
            : SRGB_LINEARISE_DENOM * Math.pow(c, 1 / SRGB_LINEARISE_GAMMA) - SRGB_LINEARISE_OFFSET;

    const r = Math.round(delinearise(rl) * 255);
    const g = Math.round(delinearise(gl) * 255);
    const b = Math.round(delinearise(bl) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
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

/**
 * Solves blend(C, anchor, t) = target for C in Lab space.
 * Returns the color that, when blended with `anchor` at ratio `t`, produces `target`.
 */
function extrapolateLab(target: Lab, anchor: Lab, t: number): Lab {
    return {
        L: (target.L - (1 - t) * anchor.L) / t,
        a: (target.a - (1 - t) * anchor.a) / t,
        b: (target.b - (1 - t) * anchor.b) / t,
    };
}

// Blend ratios used when extrapolating candidate colors from underserved swatches.
// t=0.7 → candidate is close to the swatch (gentle extrapolation)
// t=0.5 → candidate is the reflection of the filament through the swatch
// t=0.3 → more aggressive; may push out of gamut but gets clamped to valid hex
const EXTRAP_BLEND_RATIOS = [0.3, 0.5, 0.7];

export interface ColorCandidate {
    hex: string;
    /** Recommended starting TD, derived from the nearest existing filament by ΔE. */
    td: number;
    /**
     * % reduction in blend-aware weighted-average ΔE vs current filament set.
     * The baseline accounts for existing filament↔filament blend lines, so this
     * reflects genuine new coverage added by the candidate.
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
 * Given the current filament set and image swatches, returns the single color
 * whose addition as a new filament would most reduce the blend-aware weighted-
 * average ΔE between the rendered print and the target image.
 *
 * Candidate generation (two sources):
 *   1. Swatch colors in the p75 most underserved (by blend-aware reachable error).
 *   2. Extrapolated colors: for each underserved swatch S and filament F, solve
 *      blend(C, F, t) = S for C at t ∈ {0.3, 0.5, 0.7}. These are colors that,
 *      when blended with an existing filament, hit the underserved swatch exactly —
 *      often better than the swatch color itself because they pull the blend line
 *      further into uncovered Lab space.
 *
 * Scoring: for each candidate C, gain = Σ_i max(0, currentReachable_i −
 *   newReachable_i) × count_i, where newReachable_i is the minimum ΔE achievable
 *   from swatch i via any existing blend line or any new C↔filament segment.
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
    // Build candidate pool.
    // For each p75-underserved swatch, include the swatch color itself plus
    // extrapolated Lab positions derived from each filament at each blend ratio.
    // -------------------------------------------------------------------------
    const COVERAGE_THRESHOLD = 3.0; // ΔE — skip near-duplicates of existing filaments

    const sortedReachable = [...currentReachable].sort((a, b) => a - b);
    const p75Threshold = sortedReachable[Math.floor(sortedReachable.length * 0.75)];

    interface LabCandidate { lab: Lab; hex: string }
    const seen = new Set<string>();
    const pool: LabCandidate[] = [];

    const addCandidate = (lab: Lab, hex: string) => {
        if (seen.has(hex)) return;
        // Skip if this color is already well-covered by an existing filament.
        for (const fLab of filamentLabs) {
            if (deltaELab(lab, fLab) < COVERAGE_THRESHOLD) return;
        }
        seen.add(hex);
        pool.push({ lab, hex });
    };

    for (let c = 0; c < swatchLabs.length; c++) {
        if (currentReachable[c] < p75Threshold) continue;

        // The swatch color itself.
        addCandidate(swatchLabs[c], imageSwatches[c].hex);

        // Extrapolated: color that, blended with each filament at ratio t, hits this swatch.
        for (const fLab of filamentLabs) {
            for (const t of EXTRAP_BLEND_RATIOS) {
                const extrapLab = extrapolateLab(swatchLabs[c], fLab, t);
                addCandidate(extrapLab, labToHex(extrapLab));
            }
        }
    }

    if (pool.length === 0) return { candidate: null, baselineAvgDeltaE, totalPixels };

    // -------------------------------------------------------------------------
    // Score every candidate.
    // -------------------------------------------------------------------------
    interface CandidateScore { lab: Lab; hex: string; gain: number; nearestFilamentDE: number }
    const scores: CandidateScore[] = [];

    for (const { lab, hex } of pool) {
        let nearestFilamentDE = Infinity;
        for (const fLab of filamentLabs) {
            nearestFilamentDE = Math.min(nearestFilamentDE, deltaELab(lab, fLab));
        }

        let gain = 0;
        for (let i = 0; i < swatchLabs.length; i++) {
            let newReachable = currentReachable[i];
            newReachable = Math.min(newReachable, deltaELab(swatchLabs[i], lab));
            for (const fLab of filamentLabs) {
                newReachable = Math.min(newReachable, distToSegment(swatchLabs[i], lab, fLab));
            }
            const improvement = currentReachable[i] - newReachable;
            if (improvement > 0) gain += improvement * counts[i];
        }

        scores.push({ lab, hex, gain, nearestFilamentDE });
    }

    if (scores.length === 0) return { candidate: null, baselineAvgDeltaE, totalPixels };

    // Isolation score is informational — blend-aware gain already rewards isolated
    // candidates (longer C↔F segments cover more Lab space).
    const maxIsolation = Math.max(...scores.map((s) => s.nearestFilamentDE));

    // Pick winner by blend-aware gain.
    const winner = scores.reduce((best, s) => s.gain > best.gain ? s : best, scores[0]);

    // -------------------------------------------------------------------------
    // Build the result for the winning candidate.
    // -------------------------------------------------------------------------

    // Pixel capture: swatches whose blend-aware reachable error improves with the winner.
    let pixelsCaptured = 0;
    for (let i = 0; i < swatchLabs.length; i++) {
        let newReachable = currentReachable[i];
        newReachable = Math.min(newReachable, deltaELab(swatchLabs[i], winner.lab));
        for (const fLab of filamentLabs) {
            newReachable = Math.min(newReachable, distToSegment(swatchLabs[i], winner.lab, fLab));
        }
        if (newReachable < currentReachable[i]) pixelsCaptured += counts[i];
    }

    // TD: borrow from nearest existing filament by ΔE.
    let nearestFilamentIdx = 0;
    let nearestDE = Infinity;
    for (let fi = 0; fi < filamentLabs.length; fi++) {
        const de = deltaELab(winner.lab, filamentLabs[fi]);
        if (de < nearestDE) { nearestDE = de; nearestFilamentIdx = fi; }
    }
    const recommendedTd = filaments[nearestFilamentIdx].td;

    const isolationScore = winner.nearestFilamentDE / maxIsolation;
    const improvementPct = (winner.gain / baselineTotal) * 100;

    console.group(
        `[NextBestColor] ${filaments.length} filament${filaments.length !== 1 ? 's' : ''} → ` +
        `${imageSwatches.length} image colors | ${totalPixels.toLocaleString()} px | ` +
        `${pool.length} candidates (${scores.length} scored)`
    );
    console.log(`  Baseline avg ΔE:  ${baselineAvgDeltaE.toFixed(2)}  (blend-aware)`);
    console.log(`  Suggestion:       ${winner.hex.toUpperCase()}  TD ${recommendedTd.toFixed(2)}`);
    console.log(
        `  Accuracy gain:    +${improvementPct.toFixed(1)}%  ` +
        `(${pixelsCaptured.toLocaleString()} px / ` +
        `${((pixelsCaptured / totalPixels) * 100).toFixed(1)}% of image improve)`
    );
    console.log(
        `  Isolation:        ${isolationScore.toFixed(3)}  ` +
        `(nearest filament ΔE ${winner.nearestFilamentDE.toFixed(1)} / ` +
        `max ${maxIsolation.toFixed(1)})`
    );
    console.groupEnd();

    return {
        candidate: {
            hex: winner.hex,
            td: recommendedTd,
            improvementPct,
            pixelsCaptured,
            isolationScore,
        },
        baselineAvgDeltaE,
        totalPixels,
    };
}
