import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import useThreeScene from '../hooks/useThreeScene';
import { generateGreedyMesh } from '../lib/meshing';
import { Slider } from '@/components/ui/slider';
import { Layers } from 'lucide-react';

interface ThreeDViewProps {
    imageSrc?: string | null;
    baseSliceHeight: number; // mm
    layerHeight: number; // mm (granularity)
    slicerFirstLayerHeight?: number; // mm
    colorSliceHeights: number[]; // per color height increments (mm)
    colorOrder: number[]; // ordering (indices into swatches)
    swatches: { hex: string; a: number }[]; // filtered (non-transparent) swatches in original order
    pixelSize?: number; // mm per pixel horizontally (X & Z). Default 0.01 => 100px = 1mm
    heightScale?: number; // vertical exaggeration (1 = real scale)
    stepped?: boolean; // if true, flatten each cell to a uniform height (square plateaus instead of spikes)
    pixelColumns?: boolean; // if true, final build uses one plateau per image pixel (rectangular towers)
    rebuildSignal?: number;
    // Auto-paint mode props
    autoPaintEnabled?: boolean;
    autoPaintTotalHeight?: number; // Total model height when auto-paint is enabled
    autoPaintFilamentOrder?: string[]; // Filament IDs in order (for cache invalidation)
    enhancedColorMatch?: boolean; // Use color-distance mapping instead of luminance
    heightDithering?: boolean; // Floyd-Steinberg error diffusion on height map
    ditherLineWidth?: number; // Minimum dot size in mm for dithering
}

// Convert hex color to RGB tuple
function hexToRGB(hex: string): [number, number, number] {
    const h = hex.replace(/^#/, '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return [r, g, b];
}

// Calculate perceived luminance (0-1 range)
function getLuminance(r: number, g: number, b: number): number {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Nearest-color match with small cache to avoid exact equality issues
function buildNearestSwatchFinder(swatches: { hex: string; a: number }[]) {
    const rgb = swatches.map((s) => hexToRGB(s.hex));
    const cache = new Map<number, number>(); // key = (r<<16)|(g<<8)|b -> swatch index
    return (r: number, g: number, b: number) => {
        const key = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
        const cached = cache.get(key);
        if (cached !== undefined) return cached;
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < rgb.length; i++) {
            const [sr, sg, sb] = rgb[i];
            const dr = sr - r;
            const dg = sg - g;
            const db = sb - b;
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) {
                bestD = d;
                best = i;
                if (d === 0) break; // exact match
            }
        }
        cache.set(key, best);
        return best;
    };
}

export default function ThreeDView({
    imageSrc,
    baseSliceHeight,
    layerHeight,
    slicerFirstLayerHeight = 0,
    colorSliceHeights,
    colorOrder,
    swatches,
    pixelSize = 0.01,
    heightScale = 1,
    stepped = false,
    pixelColumns = true,
    rebuildSignal = 0,
    autoPaintEnabled = false,
    autoPaintTotalHeight,
    autoPaintFilamentOrder,
    enhancedColorMatch = false,
    heightDithering = false,
    ditherLineWidth = 0.42,
}: ThreeDViewProps) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [isBuilding, setIsBuilding] = useState(false);
    const [buildProgress, setBuildProgress] = useState(0);
    const [modelDimensions, setModelDimensions] = useState<{
        width: number;
        height: number;
        depth: number;
    } | null>(null);
    const [previewHeight, setPreviewHeight] = useState<number | null>(null);
    const [maxModelHeight, setMaxModelHeight] = useState(0);
    const { cameraRef, controlsRef, modelGroupRef, materialRef, requestRender } = useThreeScene(
        mountRef,
        setIsBuilding
    );

    const progressRef = useRef(0);
    const progressLastUpdateRef = useRef(0);
    const pushProgress = (value: number) => {
        progressRef.current = value;
        const now = performance.now();
        if (value >= 1 || now - progressLastUpdateRef.current > 60) {
            progressLastUpdateRef.current = now;
            setBuildProgress(value);
        }
    };

    useEffect(() => {
        if (controlsRef.current) {
            controlsRef.current.enabled = !isBuilding;
        }
    }, [controlsRef, isBuilding]);

    // Update mesh visibility based on preview height slider
    useEffect(() => {
        const modelGroup = modelGroupRef.current;
        if (!modelGroup || previewHeight === null) return;

        modelGroup.traverse((child) => {
            if (child instanceof THREE.Mesh && child.userData.baseZ !== undefined) {
                const baseZ = child.userData.baseZ as number;
                // Show mesh if any part of it is below or at the preview height
                child.visible = baseZ < previewHeight;
            }
        });

        requestRender();
    }, [previewHeight, modelGroupRef, requestRender]);

    const snapPreviewHeight = (value: number): number => {
        const bounded = Math.max(0, Math.min(maxModelHeight, value));
        if (layerHeight <= 0) return bounded;

        const first = Math.max(0, slicerFirstLayerHeight || 0);
        if (first <= 0) {
            return Math.max(0, Math.min(maxModelHeight, Math.round(bounded / layerHeight) * layerHeight));
        }

        if (bounded <= first / 2) return 0;
        if (bounded <= first + layerHeight / 2) return first;

        const delta = Math.max(0, bounded - first);
        const snapped = first + Math.round(delta / layerHeight) * layerHeight;
        return Math.max(0, Math.min(maxModelHeight, snapped));
    };

    // 2. Rebuild mesh geometry whenever inputs change (debounced, progressive, adaptive resolution)
    const buildTokenRef = useRef(0);
    const debounceTimerRef = useRef<number | null>(null);
    const lastParamsKeyRef = useRef<string | null>(null);
    const lastRebuildRef = useRef<number>(rebuildSignal);

    useEffect(() => {
        const modelGroup = modelGroupRef.current;
        if (!modelGroup || !imageSrc) return;

        // If parent requested a rebuild via the rebuildSignal, clear the last params key
        // to force the effect to proceed even if params otherwise match.
        if (rebuildSignal !== lastRebuildRef.current) {
            lastParamsKeyRef.current = null;
            lastRebuildRef.current = rebuildSignal;
        }

        // Don't build if there are no layers configured
        if (!colorOrder || colorOrder.length === 0 || !swatches || swatches.length === 0) {
            modelGroup.clear();
            setIsBuilding(false);
            return;
        }

        // Stable key of inputs to avoid duplicate builds when references unchanged
        const paramsKey = JSON.stringify({
            imageSrc,
            baseSliceHeight,
            layerHeight,
            colorSliceHeights,
            colorOrder,
            swatches: swatches.map((s) => s.hex),
            pixelSize,
            heightScale,
            stepped,
            pixelColumns,
            autoPaintFilamentOrder, // Include filament order to detect optimizer changes
        });
        if (paramsKey === lastParamsKeyRef.current) return; // nothing changed logically
        lastParamsKeyRef.current = paramsKey;

        // Debounce rapid changes (e.g., dragging slider)
        if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = window.setTimeout(() => {
            const token = ++buildTokenRef.current;
            // mark that a build is in progress for the overlay
            setIsBuilding(true);
            pushProgress(0);

            const requestIdle = (fn: () => void) => {
                const ric = (
                    window as unknown as {
                        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
                    }
                ).requestIdleCallback;
                if (typeof ric === 'function') ric(fn, { timeout: 300 });
                else setTimeout(fn, 0);
            };

            // Shared image load (do once for preview + final)
            const loadImage = () =>
                new Promise<HTMLImageElement | null>((res) => {
                    const i = new Image();
                    i.crossOrigin = 'anonymous';
                    i.onload = () => res(i);
                    i.onerror = () => res(null);
                    i.src = imageSrc;
                });

            // Build multi-mesh geometry (one object per color layer)
            const buildPixelGeometry = async (
                img: HTMLImageElement,
                bbox: { minX: number; minY: number; boxW: number; boxH: number }
            ) => {
                const nearestSwatchIndex = buildNearestSwatchFinder(swatches);
                if (token !== buildTokenRef.current) return;
                const fullW = img.naturalWidth;
                const fullH = img.naturalHeight;
                const { minX, minY, boxW, boxH } = bbox;
                const totalUnitsBase = Math.max(1, colorOrder.length * boxH);
                const totalUnits = Math.max(1, totalUnitsBase + boxH);

                const canvas = document.createElement('canvas');
                canvas.width = fullW;
                canvas.height = fullH;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(img, 0, 0, fullW, fullH);
                const { data } = ctx.getImageData(0, 0, fullW, fullH);

                // Clear current model
                modelGroup.clear();

                const YIELD_MS = 12;
                let lastYield = performance.now();

                if (autoPaintEnabled && autoPaintTotalHeight && autoPaintTotalHeight > 0) {
                    // === AUTO-PAINT MODE ===

                    // Build layers from the colorSliceHeights
                    const cumulativeHeights: number[] = [];
                    let running = 0;
                    colorOrder.forEach((fi, pos) => {
                        const h = colorSliceHeights[fi] || 0;
                        const eff = pos === 0 ? Math.max(h, slicerFirstLayerHeight) : h;
                        running += eff;
                        cumulativeHeights[pos] = running;
                    });

                    // Precompute pixel height map (same size as image crop)
                    // This avoids recomputing per-layer
                    const pixelHeightMap = new Float32Array(boxW * boxH);

                    if (enhancedColorMatch) {
                        // === ENHANCED: Polyline projection in Lab color space ===
                        // The virtual swatches trace a path (polyline) through
                        // CIE-Lab space, parameterized by height.  For each image
                        // pixel we find the nearest point on this polyline via
                        // segment projection, yielding a continuous height that
                        // varies smoothly even among similar colors.
                        //
                        // Flat zones (consecutive identical-color swatches from
                        // the same filament) are collapsed into single nodes with
                        // a height *range*.  Within these ranges we fall back to
                        // luminance-based sub-detail, preserving surface texture
                        // without affecting color accuracy (the printed color is
                        // constant across the flat zone).

                        // Inline sRGB -> Lab conversion helper
                        const toLab = (
                            sr: number,
                            sg: number,
                            sb: number
                        ): { L: number; a: number; b: number } => {
                            let rr = sr / 255,
                                gg = sg / 255,
                                bb = sb / 255;
                            rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
                            gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
                            bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
                            rr *= 100;
                            gg *= 100;
                            bb *= 100;
                            let x = rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375;
                            let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175;
                            let z = rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041;
                            x /= 95.047;
                            y /= 100.0;
                            z /= 108.883;
                            x = x > 0.008856 ? Math.cbrt(x) : (903.3 * x + 16) / 116;
                            y = y > 0.008856 ? Math.cbrt(y) : (903.3 * y + 16) / 116;
                            z = z > 0.008856 ? Math.cbrt(z) : (903.3 * z + 16) / 116;
                            return {
                                L: 116 * y - 16,
                                a: 500 * (x - y),
                                b: 200 * (y - z),
                            };
                        };

                        // Pre-compute Lab + cumulative height for every virtual swatch
                        const swatchEntries: Array<{
                            lab: { L: number; a: number; b: number };
                            height: number;
                        }> = [];
                        for (let si = 0; si < swatches.length; si++) {
                            const rgb = hexToRGB(swatches[si].hex);
                            swatchEntries.push({
                                lab: toLab(rgb[0], rgb[1], rgb[2]),
                                height: cumulativeHeights[si] || 0,
                            });
                        }

                        // --- Collapse consecutive same-color runs into polyline nodes ---
                        // Only truly identical colors collapse (DeltaE < 0.5).
                        // Each node keeps its height range so flat zones can use
                        // luminance for sub-detail.
                        const polyNodes: Array<{
                            lab: { L: number; a: number; b: number };
                            minHeight: number;
                            maxHeight: number;
                        }> = [];
                        const COLLAPSE_DE_SQ = 0.25; // 0.5^2 -- very conservative
                        if (swatchEntries.length > 0) {
                            let runStart = 0;
                            for (let si = 1; si <= swatchEntries.length; si++) {
                                let split = si === swatchEntries.length;
                                if (!split) {
                                    const ref = swatchEntries[runStart].lab;
                                    const cur = swatchEntries[si].lab;
                                    const deSq =
                                        (cur.L - ref.L) ** 2 +
                                        (cur.a - ref.a) ** 2 +
                                        (cur.b - ref.b) ** 2;
                                    split = deSq >= COLLAPSE_DE_SQ;
                                }
                                if (split) {
                                    // Average Lab over the run
                                    let sL = 0,
                                        sa = 0,
                                        sb = 0;
                                    const cnt = si - runStart;
                                    for (let j = runStart; j < si; j++) {
                                        sL += swatchEntries[j].lab.L;
                                        sa += swatchEntries[j].lab.a;
                                        sb += swatchEntries[j].lab.b;
                                    }
                                    polyNodes.push({
                                        lab: { L: sL / cnt, a: sa / cnt, b: sb / cnt },
                                        minHeight: swatchEntries[runStart].height,
                                        maxHeight: swatchEntries[si - 1].height,
                                    });
                                    runStart = si;
                                }
                            }
                        }

                        // --- Pre-compute transition segments between consecutive nodes ---
                        // A segment connects the END of one flat zone to the START of
                        // the next, tracing the color-blend path through Lab space.
                        const polySegs: Array<{
                            aL: number;
                            aa: number;
                            ab: number;
                            dL: number;
                            da: number;
                            db: number;
                            lenSq: number;
                            hStart: number;
                            hEnd: number;
                        }> = [];
                        for (let ni = 0; ni < polyNodes.length - 1; ni++) {
                            const A = polyNodes[ni],
                                B = polyNodes[ni + 1];
                            const dL = B.lab.L - A.lab.L;
                            const da = B.lab.a - A.lab.a;
                            const db = B.lab.b - A.lab.b;
                            polySegs.push({
                                aL: A.lab.L,
                                aa: A.lab.a,
                                ab: A.lab.b,
                                dL,
                                da,
                                db,
                                lenSq: dL * dL + da * da + db * db,
                                hStart: A.maxHeight, // transition begins at end of A
                                hEnd: B.minHeight, // transition ends at start of B
                            });
                        }

                        // Pre-scan image luminance range for flat-zone sub-detail
                        let imgMinLum = 1,
                            imgMaxLum = 0;
                        for (let py = minY; py < minY + boxH; py++) {
                            for (let px = minX; px < minX + boxW; px++) {
                                const idx = (py * fullW + px) * 4;
                                if (data[idx + 3] === 0) continue;
                                const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
                                if (lum < imgMinLum) imgMinLum = lum;
                                if (lum > imgMaxLum) imgMaxLum = lum;
                            }
                        }
                        if (imgMaxLum <= imgMinLum) imgMaxLum = imgMinLum + 0.001;
                        const imgLumRange = imgMaxLum - imgMinLum;

                        const maxModelH = cumulativeHeights[cumulativeHeights.length - 1] || 1;
                        const minModelH = cumulativeHeights[0] || 0;

                        // --- Pass 1: Compute continuous (un-snapped) heights ---
                        // We deliberately do NOT snap to the layer grid here.
                        // The RGB cache is still valid because it stores the ideal
                        // continuous height; dithering happens spatially in Pass 2.
                        const colorHeightCache = new Map<number, number>();

                        for (let py = minY; py < minY + boxH; py++) {
                            for (let px = minX; px < minX + boxW; px++) {
                                const idx = (py * fullW + px) * 4;
                                const a = data[idx + 3];
                                const mapIdx = (py - minY) * boxW + (px - minX);
                                if (a === 0) {
                                    pixelHeightMap[mapIdx] = 0;
                                    continue;
                                }

                                const pr = data[idx],
                                    pg = data[idx + 1],
                                    pb = data[idx + 2];
                                const cacheKey =
                                    ((pr & 0xff) << 16) | ((pg & 0xff) << 8) | (pb & 0xff);
                                const cached = colorHeightCache.get(cacheKey);
                                if (cached !== undefined) {
                                    pixelHeightMap[mapIdx] = cached;
                                    continue;
                                }

                                const pLab = toLab(pr, pg, pb);

                                let bestDist = Infinity;
                                let targetHeight = 0;

                                // --- Match against flat-zone nodes ---
                                for (let ni = 0; ni < polyNodes.length; ni++) {
                                    const nd = polyNodes[ni];
                                    const dist = Math.sqrt(
                                        (pLab.L - nd.lab.L) ** 2 +
                                            (pLab.a - nd.lab.a) ** 2 +
                                            (pLab.b - nd.lab.b) ** 2
                                    );
                                    if (dist < bestDist) {
                                        bestDist = dist;
                                        const range = nd.maxHeight - nd.minHeight;
                                        if (range > 1e-6) {
                                            const lum = getLuminance(pr, pg, pb);
                                            const lumT = (lum - imgMinLum) / imgLumRange;
                                            targetHeight = nd.minHeight + lumT * range;
                                        } else {
                                            targetHeight = (nd.minHeight + nd.maxHeight) * 0.5;
                                        }
                                    }
                                }

                                // --- Match against transition segments ---
                                for (let si = 0; si < polySegs.length; si++) {
                                    const seg = polySegs[si];
                                    if (seg.lenSq < 0.01) continue;

                                    const pL = pLab.L - seg.aL;
                                    const pa = pLab.a - seg.aa;
                                    const pba = pLab.b - seg.ab;
                                    let t = (pL * seg.dL + pa * seg.da + pba * seg.db) / seg.lenSq;
                                    t = Math.max(0, Math.min(1, t));

                                    const projL = seg.aL + t * seg.dL;
                                    const proja = seg.aa + t * seg.da;
                                    const projb = seg.ab + t * seg.db;
                                    const dist = Math.sqrt(
                                        (pLab.L - projL) ** 2 +
                                            (pLab.a - proja) ** 2 +
                                            (pLab.b - projb) ** 2
                                    );

                                    if (dist < bestDist) {
                                        bestDist = dist;
                                        targetHeight = seg.hStart + t * (seg.hEnd - seg.hStart);
                                    }
                                }

                                // Clamp to model bounds (continuous, no grid snap)
                                targetHeight = Math.max(
                                    minModelH,
                                    Math.min(maxModelH, targetHeight)
                                );

                                pixelHeightMap[mapIdx] = targetHeight;
                                colorHeightCache.set(cacheKey, targetHeight);
                            }
                            pushProgress((py - minY + 1) / totalUnits);
                        }

                        // --- Pass 2: Quantize heights (with optional dithering) ---
                        // The continuous height map has sub-layer precision, but
                        // the 3D model must use discrete layer heights.  When
                        // heightDithering is ON, block-aware Floyd-Steinberg error
                        // diffusion produces dots sized to the printer's line width
                        // so the dither pattern is actually printable.  Edges
                        // between different quantized heights are protected from
                        // dithering to avoid staircase artifacts that expose wrong
                        // colors.  When OFF, simple rounding is used.
                        if (layerHeight > 0 && heightDithering) {
                            // --- Step 2a: Snap everything to the grid first ---
                            const snappedMap = new Float32Array(boxW * boxH);
                            for (let mi = 0; mi < boxW * boxH; mi++) {
                                const h = pixelHeightMap[mi];
                                if (h <= 0) {
                                    snappedMap[mi] = 0;
                                    continue;
                                }
                                const delta = Math.max(0, h - slicerFirstLayerHeight);
                                let s =
                                    slicerFirstLayerHeight +
                                    Math.round(delta / layerHeight) * layerHeight;
                                s = Math.max(slicerFirstLayerHeight, Math.min(maxModelH, s));
                                snappedMap[mi] = s;
                            }

                            // --- Step 2b: Identify edge pixels ---
                            // A pixel is on an edge if any of its 4-connected
                            // neighbors has a different snapped height.  Dithering
                            // these would create jagged staircases that expose the
                            // wrong filament color, so we leave them at their
                            // nearest-round height.
                            const isEdge = new Uint8Array(boxW * boxH);
                            for (let y = 0; y < boxH; y++) {
                                for (let x = 0; x < boxW; x++) {
                                    const mi = y * boxW + x;
                                    const sh = snappedMap[mi];
                                    if (sh <= 0) continue;
                                    if (
                                        (x > 0 &&
                                            snappedMap[mi - 1] > 0 &&
                                            snappedMap[mi - 1] !== sh) ||
                                        (x < boxW - 1 &&
                                            snappedMap[mi + 1] > 0 &&
                                            snappedMap[mi + 1] !== sh) ||
                                        (y > 0 &&
                                            snappedMap[mi - boxW] > 0 &&
                                            snappedMap[mi - boxW] !== sh) ||
                                        (y < boxH - 1 &&
                                            snappedMap[mi + boxW] > 0 &&
                                            snappedMap[mi + boxW] !== sh)
                                    ) {
                                        isEdge[mi] = 1;
                                    }
                                }
                            }

                            // --- Step 2c: Block-aware Floyd-Steinberg ---
                            // The block size ensures dither dots are at least as
                            // wide as the printer's line width (in pixels).
                            const blockSize = Math.max(1, Math.round(ditherLineWidth / pixelSize));
                            const bW = Math.ceil(boxW / blockSize);
                            const bH = Math.ceil(boxH / blockSize);

                            // Compute average continuous height per block
                            const blockAvg = new Float64Array(bW * bH);
                            const blockCnt = new Uint32Array(bW * bH);
                            const blockHasEdge = new Uint8Array(bW * bH);
                            for (let y = 0; y < boxH; y++) {
                                for (let x = 0; x < boxW; x++) {
                                    const mi = y * boxW + x;
                                    const h = pixelHeightMap[mi]; // still continuous
                                    if (h <= 0) continue;
                                    const bx = Math.floor(x / blockSize);
                                    const by = Math.floor(y / blockSize);
                                    const bi = by * bW + bx;
                                    blockAvg[bi] += h;
                                    blockCnt[bi]++;
                                    if (isEdge[mi]) blockHasEdge[bi] = 1;
                                }
                            }
                            for (let bi = 0; bi < bW * bH; bi++) {
                                if (blockCnt[bi] > 0) blockAvg[bi] /= blockCnt[bi];
                            }

                            // Dither at block level
                            const errBuf = new Float64Array(bW * bH);
                            const blockSnapped = new Float32Array(bW * bH);

                            for (let by = 0; by < bH; by++) {
                                const ltr = by % 2 === 0;
                                for (let bxi = 0; bxi < bW; bxi++) {
                                    const bx = ltr ? bxi : bW - 1 - bxi;
                                    const bi = by * bW + bx;
                                    if (blockCnt[bi] === 0) continue;

                                    let snapped: number;
                                    if (blockHasEdge[bi]) {
                                        // Edge block: no dithering, use simple snap
                                        const delta = Math.max(
                                            0,
                                            blockAvg[bi] - slicerFirstLayerHeight
                                        );
                                        snapped =
                                            slicerFirstLayerHeight +
                                            Math.round(delta / layerHeight) * layerHeight;
                                    } else {
                                        const adjusted = blockAvg[bi] + errBuf[bi];
                                        const delta = Math.max(
                                            0,
                                            adjusted - slicerFirstLayerHeight
                                        );
                                        snapped =
                                            slicerFirstLayerHeight +
                                            Math.round(delta / layerHeight) * layerHeight;
                                    }
                                    snapped = Math.max(
                                        slicerFirstLayerHeight,
                                        Math.min(maxModelH, snapped)
                                    );
                                    blockSnapped[bi] = snapped;

                                    if (!blockHasEdge[bi]) {
                                        const err = blockAvg[bi] + errBuf[bi] - snapped;
                                        const xFwd = ltr ? bx + 1 : bx - 1;
                                        const xDiagFwd = ltr ? bx + 1 : bx - 1;
                                        const xDiagBack = ltr ? bx - 1 : bx + 1;

                                        if (xFwd >= 0 && xFwd < bW)
                                            errBuf[by * bW + xFwd] += err * (7 / 16);
                                        if (by + 1 < bH) {
                                            if (xDiagBack >= 0 && xDiagBack < bW)
                                                errBuf[(by + 1) * bW + xDiagBack] += err * (3 / 16);
                                            errBuf[(by + 1) * bW + bx] += err * (5 / 16);
                                            if (xDiagFwd >= 0 && xDiagFwd < bW)
                                                errBuf[(by + 1) * bW + xDiagFwd] += err * (1 / 16);
                                        }
                                    }
                                }
                            }

                            // Write block-level results back to pixel map
                            for (let y = 0; y < boxH; y++) {
                                for (let x = 0; x < boxW; x++) {
                                    const mi = y * boxW + x;
                                    if (pixelHeightMap[mi] <= 0) continue;
                                    const bx = Math.floor(x / blockSize);
                                    const by = Math.floor(y / blockSize);
                                    const bi = by * bW + bx;
                                    if (blockHasEdge[bi]) {
                                        // Edge blocks: use per-pixel snap
                                        pixelHeightMap[mi] = snappedMap[mi];
                                    } else {
                                        pixelHeightMap[mi] = blockSnapped[bi];
                                    }
                                }
                            }
                        } else if (layerHeight > 0) {
                            // Simple grid snap without error diffusion
                            for (let mi = 0; mi < boxW * boxH; mi++) {
                                const h = pixelHeightMap[mi];
                                if (h <= 0) continue;
                                const delta = Math.max(0, h - slicerFirstLayerHeight);
                                let snapped =
                                    slicerFirstLayerHeight +
                                    Math.round(delta / layerHeight) * layerHeight;
                                snapped = Math.max(
                                    slicerFirstLayerHeight,
                                    Math.min(maxModelH, snapped)
                                );
                                pixelHeightMap[mi] = snapped;
                            }
                        }
                    } else {
                        // === STANDARD: Luminance-based mapping ===
                        // First, find the luminance range of the image
                        let minLum = 1,
                            maxLum = 0;
                        for (let py = minY; py < minY + boxH; py++) {
                            for (let px = minX; px < minX + boxW; px++) {
                                const idx = (py * fullW + px) * 4;
                                const a = data[idx + 3];
                                if (a > 0) {
                                    const lum = getLuminance(
                                        data[idx],
                                        data[idx + 1],
                                        data[idx + 2]
                                    );
                                    minLum = Math.min(minLum, lum);
                                    maxLum = Math.max(maxLum, lum);
                                }
                            }
                        }
                        if (maxLum <= minLum) maxLum = minLum + 0.001;

                        for (let py = minY; py < minY + boxH; py++) {
                            for (let px = minX; px < minX + boxW; px++) {
                                const idx = (py * fullW + px) * 4;
                                const a = data[idx + 3];
                                const mapIdx = (py - minY) * boxW + (px - minX);
                                if (a === 0) {
                                    pixelHeightMap[mapIdx] = 0;
                                    continue;
                                }

                                const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
                                const normalizedLum = (lum - minLum) / (maxLum - minLum);

                                const firstLayerH = Math.max(
                                    slicerFirstLayerHeight,
                                    colorSliceHeights[colorOrder[0]] || slicerFirstLayerHeight
                                );
                                let pixelHeight =
                                    firstLayerH +
                                    normalizedLum * (autoPaintTotalHeight - firstLayerH);

                                // Snap to layer height grid
                                if (layerHeight > 0) {
                                    const delta = Math.max(0, pixelHeight - slicerFirstLayerHeight);
                                    pixelHeight =
                                        slicerFirstLayerHeight +
                                        Math.round(delta / layerHeight) * layerHeight;
                                    pixelHeight = Math.max(slicerFirstLayerHeight, pixelHeight);
                                }

                                pixelHeightMap[mapIdx] = pixelHeight;
                            }
                            pushProgress((py - minY + 1) / totalUnits);
                        }
                    }

                    // For each layer, find pixels whose target height falls within this layer
                    for (let i = 0; i < colorOrder.length; i++) {
                        if (token !== buildTokenRef.current) return;

                        const swatchIdx = colorOrder[i];
                        if (!swatches[swatchIdx]) continue;
                        const colorHex = swatches[swatchIdx].hex;
                        const thickness =
                            i === 0
                                ? Math.max(
                                      colorSliceHeights[swatchIdx] || 0,
                                      slicerFirstLayerHeight
                                  )
                                : colorSliceHeights[swatchIdx] || 0;
                        if (thickness <= 0.0001) continue;

                        const topZ = i === 0 ? cumulativeHeights[0] : cumulativeHeights[i];
                        const baseZ = i === 0 ? 0 : cumulativeHeights[i - 1];

                        // Identify active pixels for this layer using precomputed height map
                        const activePixels = new Uint8Array(boxW * boxH);
                        let activeCount = 0;

                        for (let y = 0; y < boxH; y++) {
                            for (let x = 0; x < boxW; x++) {
                                const mapIdx = y * boxW + x;
                                const pixelHeight = pixelHeightMap[mapIdx];

                                if (pixelHeight > 0 && pixelHeight >= topZ - 0.001) {
                                    activePixels[(boxH - 1 - y) * boxW + x] = 1;
                                    activeCount++;
                                }
                            }

                            pushProgress((boxH + i * boxH + (y + 1)) / totalUnits);

                            if (performance.now() - lastYield > YIELD_MS) {
                                await new Promise((r) => requestAnimationFrame(r));
                                if (token !== buildTokenRef.current) return;
                                lastYield = performance.now();
                            }
                        }

                        if (activeCount === 0) continue;

                        // Generate mesh for this layer
                        const { positions, indices } = await generateGreedyMesh(
                            activePixels,
                            boxW,
                            boxH,
                            thickness,
                            baseZ,
                            pixelSize,
                            heightScale,
                            { yieldIntervalMs: 8 }
                        );

                        const geom = new THREE.BufferGeometry();
                        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                        geom.setIndex(indices);
                        geom.computeVertexNormals();

                        const mat = new THREE.MeshStandardMaterial({
                            color: colorHex,
                            roughness: 0.5,
                            metalness: 0.1,
                            side: THREE.DoubleSide,
                        });

                        const mesh = new THREE.Mesh(geom, mat);
                        // Store layer Z range for preview slider
                        mesh.userData.baseZ = baseZ;
                        mesh.userData.topZ = topZ;
                        modelGroup.add(mesh);

                        if (performance.now() - lastYield > YIELD_MS) {
                            await new Promise((r) => requestAnimationFrame(r));
                            if (token !== buildTokenRef.current) return;
                            lastYield = performance.now();
                        }
                    }
                } else {
                    // === STANDARD MODE ===
                    // Prepare layers
                    const cumulativeHeights: number[] = [];
                    let running = 0;
                    colorOrder.forEach((fi, pos) => {
                        const h = colorSliceHeights[fi] || 0;
                        const eff = pos === 0 ? Math.max(h, slicerFirstLayerHeight) : h;
                        running += eff;
                        cumulativeHeights[pos] = running;
                    });

                    const layerIndexBySwatch = new Int32Array(swatches.length);
                    layerIndexBySwatch.fill(-1);
                    colorOrder.forEach((swatchIdx, pos) => {
                        if (swatchIdx >= 0 && swatchIdx < layerIndexBySwatch.length) {
                            layerIndexBySwatch[swatchIdx] = pos;
                        }
                    });

                    // Precompute each pixel's swatch layer position once.
                    // This avoids re-running nearest-color matching for every layer.
                    const pixelLayerPos = new Int16Array(boxW * boxH);
                    pixelLayerPos.fill(-1);

                    for (let y = 0; y < boxH; y++) {
                        const py = minY + y;
                        const rowOffset = py * fullW;
                        const flippedRowOffset = (boxH - 1 - y) * boxW;

                        for (let x = 0; x < boxW; x++) {
                            const px = minX + x;
                            const idx = (rowOffset + px) * 4;
                            const a = data[idx + 3];
                            if (a === 0) continue;

                            const sIdx = nearestSwatchIndex(data[idx], data[idx + 1], data[idx + 2]);
                            if (sIdx === -1) continue;

                            const layerPos = layerIndexBySwatch[sIdx];
                            pixelLayerPos[flippedRowOffset + x] = layerPos;
                        }

                        pushProgress((y + 1) / totalUnits);
                        if (performance.now() - lastYield > YIELD_MS) {
                            await new Promise((r) => requestAnimationFrame(r));
                            if (token !== buildTokenRef.current) return;
                            lastYield = performance.now();
                        }
                    }

                    // Iterate each color layer and build a mesh
                    for (let i = 0; i < colorOrder.length; i++) {
                        if (token !== buildTokenRef.current) return;

                        const swatchIdx = colorOrder[i];
                        if (!swatches[swatchIdx]) continue;
                        const colorHex = swatches[swatchIdx].hex;
                        const thickness =
                            i === 0
                                ? Math.max(
                                      colorSliceHeights[swatchIdx] || 0,
                                      slicerFirstLayerHeight
                                  )
                                : colorSliceHeights[swatchIdx] || 0;
                        if (thickness <= 0.0001) continue; // Skip empty layers

                        const baseZ = i === 0 ? 0 : cumulativeHeights[i - 1];
                        const topZ = baseZ + thickness * heightScale;

                        // Identify active pixels for this layer
                        // Pixel is active if its color index maps to a layer >= i
                        const activePixels = new Uint8Array(boxW * boxH);
                        let activeCount = 0;

                        for (let y = 0; y < boxH; y++) {
                            const rowOffset = y * boxW;
                            for (let x = 0; x < boxW; x++) {
                                const mapIdx = rowOffset + x;
                                if (pixelLayerPos[mapIdx] >= i) {
                                    activePixels[mapIdx] = 1;
                                    activeCount++;
                                }
                            }
                            pushProgress((boxH + i * boxH + (y + 1)) / totalUnits);
                            if (performance.now() - lastYield > YIELD_MS) {
                                await new Promise((r) => requestAnimationFrame(r));
                                if (token !== buildTokenRef.current) return;
                                lastYield = performance.now();
                            }
                        }

                        if (activeCount === 0) continue;

                        // Generate Optimized Greedy Mesh
                        const { positions, indices } = await generateGreedyMesh(
                            activePixels,
                            boxW,
                            boxH,
                            thickness,
                            baseZ,
                            pixelSize,
                            heightScale,
                            { yieldIntervalMs: 8 }
                        );

                        const geom = new THREE.BufferGeometry();
                        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                        geom.setIndex(indices);
                        geom.computeVertexNormals();

                        const mat = new THREE.MeshStandardMaterial({
                            color: colorHex,
                            roughness: 0.5,
                            metalness: 0.1,
                            side: THREE.DoubleSide,
                        });

                        // Note: generateGreedyMesh returns world-space coordinates (scaled by pixelSize/heightScale)
                        // so we do not need to apply scale/position to the mesh itself.
                        const mesh = new THREE.Mesh(geom, mat);
                        // Store layer Z range for preview slider
                        mesh.userData.baseZ = baseZ;
                        mesh.userData.topZ = topZ;
                        modelGroup.add(mesh);

                        if (performance.now() - lastYield > YIELD_MS) {
                            await new Promise((r) => requestAnimationFrame(r));
                            if (token !== buildTokenRef.current) return;
                            lastYield = performance.now();
                        }
                    }
                }

                if (token !== buildTokenRef.current) return;

                try {
                    (
                        window as unknown as { __KROMACUT_LAST_MESH?: THREE.Object3D }
                    ).__KROMACUT_LAST_MESH = modelGroup;
                } catch {
                    /* ignore */
                }

                // Calculate dimensions
                const box = new THREE.Box3().setFromObject(modelGroup);
                const maxDepth = box.max.z - box.min.z;
                const finalW = boxW;
                const finalH = boxH;
                setModelDimensions({
                    width: finalW * pixelSize,
                    height: finalH * pixelSize,
                    depth: maxDepth,
                });
                // Set max height for layer preview slider
                setMaxModelHeight(box.max.z);
                setPreviewHeight(box.max.z); // Start at full height

                // Auto-frame
                try {
                    const camera = cameraRef.current;
                    const controls = controlsRef.current;
                    if (camera && controls) {
                        const sphere = new THREE.Sphere();
                        box.getBoundingSphere(sphere);
                        // ... same framing logic ...
                        const fov = (camera.fov * Math.PI) / 180;
                        const distance = sphere.radius / Math.sin(fov / 2);
                        const dir = new THREE.Vector3(0.9, 0.8, 1).normalize();
                        const camPos = sphere.center
                            .clone()
                            .add(dir.multiplyScalar(distance * 1.35));
                        camera.position.copy(camPos);
                        controls.target.copy(sphere.center);
                        camera.near = Math.max(0.01, sphere.radius * 0.01);
                        camera.far = sphere.radius * 20;
                        camera.updateProjectionMatrix();
                        controls.update();
                    }
                } catch {
                    /* ignore */
                }

                requestRender();
                pushProgress(1);
            };

            (async () => {
                const img = await loadImage();
                if (!img || token !== buildTokenRef.current) return;
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                // compute opaque bounding box
                const c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                const cx = c.getContext('2d');
                if (!cx) return;
                cx.drawImage(img, 0, 0, w, h);
                const imgd = cx.getImageData(0, 0, w, h).data;
                let minX = w,
                    minY = h,
                    maxX = 0,
                    maxY = 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const a = imgd[(y * w + x) * 4 + 3];
                        if (a > 0) {
                            if (x < minX) minX = x;
                            if (y < minY) minY = y;
                            if (x > maxX) maxX = x;
                            if (y > maxY) maxY = y;
                        }
                    }
                }
                if (maxX < minX || maxY < minY) {
                    minX = 0;
                    minY = 0;
                    maxX = w - 1;
                    maxY = h - 1;
                }
                const boxW = maxX - minX + 1;
                const boxH = maxY - minY + 1;
                const bbox = { minX, minY, boxW, boxH };

                if (token !== buildTokenRef.current) {
                    setIsBuilding(false);
                    return;
                }

                // Schedule final build
                await new Promise<void>((res) =>
                    requestIdle(async () => {
                        if (token !== buildTokenRef.current) {
                            res();
                            return;
                        }
                        if (pixelColumns) await buildPixelGeometry(img, bbox);
                        res();
                    })
                );
                if (token === buildTokenRef.current) {
                    setIsBuilding(false);
                    pushProgress(1);
                }
            })();
        }, 120);

        return () => {
            if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        };
    }, [
        imageSrc,
        baseSliceHeight,
        layerHeight,
        slicerFirstLayerHeight,
        colorSliceHeights,
        colorOrder,
        swatches,
        pixelSize,
        heightScale,
        stepped,
        pixelColumns,
        rebuildSignal,
        autoPaintEnabled,
        autoPaintTotalHeight,
        autoPaintFilamentOrder,
        enhancedColorMatch,
        heightDithering,
        ditherLineWidth,
        cameraRef,
        controlsRef,
        materialRef,
        modelGroupRef,
        requestRender,
    ]);

    return (
        <div className="w-full h-full relative" ref={mountRef}>
            {isBuilding && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                    <div className="w-[260px] rounded-xl border border-border/60 bg-background/90 shadow-lg px-4 py-3">
                        <div className="text-sm font-semibold text-foreground">
                            Generating mesh...
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                            {Math.round(buildProgress * 100)}%
                        </div>
                        <div className="mt-3 h-2 w-full rounded-full bg-muted">
                            <div
                                className="h-2 rounded-full bg-primary transition-[width] duration-150"
                                style={{ width: `${Math.round(buildProgress * 100)}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}
            {modelDimensions && (
                <div
                    className="absolute top-2 left-2 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono font-semibold z-10"
                    aria-hidden
                >
                    Model: {modelDimensions.width.toFixed(1)}×{modelDimensions.height.toFixed(1)}×
                    {modelDimensions.depth.toFixed(1)} mm
                </div>
            )}
            {/* Layer Preview Slider */}
            {!isBuilding && maxModelHeight > 0 && previewHeight !== null && (
                <div className="absolute bottom-4 left-4 right-4 bg-background/90 backdrop-blur-sm border border-border/50 rounded-lg p-3 shadow-lg z-10">
                    <div className="flex items-center gap-3">
                        <Layers className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground font-medium">
                                    Layer Preview
                                </span>
                                <span className="text-foreground font-mono font-semibold">
                                    {previewHeight.toFixed(2)} mm
                                </span>
                            </div>
                            <Slider
                                value={[previewHeight]}
                                onValueChange={(v) => setPreviewHeight(snapPreviewHeight(v[0]))}
                                min={0}
                                max={maxModelHeight}
                                step={0.01}
                                className="w-full"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>Base (0)</span>
                                <span>Top ({maxModelHeight.toFixed(2)})</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}