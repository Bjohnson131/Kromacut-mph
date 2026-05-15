// Binary STL exporter for three.js objects (Kromacut)
// Exports the object's geometry (respecting world transforms) into a binary STL Blob.
// Merges all Mesh descendants into a single STL file.
import * as THREE from 'three';

type ExportGeometrySource = {
    positions: ArrayLike<number>;
    indices?: ArrayLike<number>;
    itemSize?: number;
    activePixels?: ArrayLike<number | boolean>;
    width?: number;
    height?: number;
    pixelSize?: number;
    topZ?: number;
};

type CompactStlStats = {
    mode: 'heightfield';
    topQuads: number;
    bottomQuads: number;
    horizontalWallQuads: number;
    verticalWallQuads: number;
    totalQuads: number;
    triangleCount: number;
};

type CompactHeightfieldResult = {
    quads: number[];
    stats: CompactStlStats;
};

function publishStlStats(stats: CompactStlStats) {
    const target = globalThis as typeof globalThis & {
        __KROMACUT_E2E?: { lastStlExport?: CompactStlStats };
    };

    if (target.__KROMACUT_E2E) {
        target.__KROMACUT_E2E.lastStlExport = stats;
    }
}

function getKromacutExportGeometry(geometry: THREE.BufferGeometry): ExportGeometrySource | null {
    const source = geometry.userData?.kromacutExportGeometry as ExportGeometrySource | undefined;
    if (!source?.positions || !source.indices) return null;
    return {
        ...source,
        positions: source.positions,
        indices: source.indices,
        itemSize: source.itemSize ?? 3,
    };
}

function readTransformedPosition(
    positions: ArrayLike<number>,
    itemSize: number,
    vertexIndex: number,
    matrix: THREE.Matrix4,
    out: Float64Array
) {
    const offset = vertexIndex * itemSize;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const e = matrix.elements;

    out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
}

const HEIGHT_UNIT_SCALE = 100000;

function toHeightUnits(value: number) {
    return Math.round(value * HEIGHT_UNIT_SCALE);
}

function fromHeightUnits(value: number) {
    return value / HEIGHT_UNIT_SCALE;
}

function matrixIsIdentity(matrix: THREE.Matrix4) {
    const e = matrix.elements;
    return (
        e[0] === 1 &&
        e[1] === 0 &&
        e[2] === 0 &&
        e[3] === 0 &&
        e[4] === 0 &&
        e[5] === 1 &&
        e[6] === 0 &&
        e[7] === 0 &&
        e[8] === 0 &&
        e[9] === 0 &&
        e[10] === 1 &&
        e[11] === 0 &&
        e[12] === 0 &&
        e[13] === 0 &&
        e[14] === 0 &&
        e[15] === 1
    );
}

function buildKromacutHeightfieldQuads(meshes: THREE.Mesh[]): CompactHeightfieldResult | null {
    const layerSources: Required<
        Pick<ExportGeometrySource, 'activePixels' | 'width' | 'height' | 'pixelSize' | 'topZ'>
    >[] = [];
    let width = 0;
    let height = 0;
    let pixelSize = 0;

    for (const mesh of meshes) {
        const source = getKromacutExportGeometry(mesh.geometry);

        if (
            !source?.activePixels ||
            source.width === undefined ||
            source.height === undefined ||
            source.pixelSize === undefined ||
            source.topZ === undefined ||
            !matrixIsIdentity(mesh.matrixWorld)
        ) {
            return null;
        }

        if (layerSources.length === 0) {
            width = source.width;
            height = source.height;
            pixelSize = source.pixelSize;
        } else if (
            width !== source.width ||
            height !== source.height ||
            pixelSize !== source.pixelSize
        ) {
            return null;
        }

        layerSources.push({
            activePixels: source.activePixels,
            width: source.width,
            height: source.height,
            pixelSize: source.pixelSize,
            topZ: source.topZ,
        });
    }

    if (layerSources.length === 0 || width <= 0 || height <= 0 || pixelSize <= 0) {
        return null;
    }

    layerSources.sort((a, b) => a.topZ - b.topZ);

    const heightUnits = new Int32Array(width * height);
    const uniqueHeights = new Set<number>();

    for (const source of layerSources) {
        const topUnits = toHeightUnits(source.topZ);
        if (topUnits <= 0) continue;

        for (let i = 0; i < heightUnits.length; i++) {
            if (source.activePixels[i] && topUnits > heightUnits[i]) {
                heightUnits[i] = topUnits;
            }
        }
    }

    for (const heightUnit of heightUnits) {
        if (heightUnit > 0) uniqueHeights.add(heightUnit);
    }

    if (uniqueHeights.size === 0) {
        return null;
    }

    const quads: number[] = [];
    const stats: CompactStlStats = {
        mode: 'heightfield',
        topQuads: 0,
        bottomQuads: 0,
        horizontalWallQuads: 0,
        verticalWallQuads: 0,
        totalQuads: 0,
        triangleCount: 0,
    };
    const pushQuad = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
        dx: number,
        dy: number,
        dz: number
    ) => {
        quads.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    };

    const addTopRect = (x: number, y: number, w: number, h: number, z: number) => {
        const x0 = x * pixelSize;
        const x1 = (x + w) * pixelSize;
        const y0 = y * pixelSize;
        const y1 = (y + h) * pixelSize;
        pushQuad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
        stats.topQuads++;
    };

    const addBottomRect = (x: number, y: number, w: number, h: number) => {
        const x0 = x * pixelSize;
        const x1 = (x + w) * pixelSize;
        const y0 = y * pixelSize;
        const y1 = (y + h) * pixelSize;
        pushQuad(x0, y0, 0, x0, y1, 0, x1, y1, 0, x1, y0, 0);
        stats.bottomQuads++;
    };

    type Rect = {
        x: number;
        y: number;
        w: number;
        h: number;
    };

    const visited = new Uint8Array(width * height);
    const collectGreedyRects = (
        matches: (index: number) => boolean,
        mode: 'wide' | 'tall' | 'area'
    ) => {
        const rects: Rect[] = [];
        visited.fill(0);

        if (mode === 'tall') {
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = y * width + x;
                    if (visited[idx] || !matches(idx)) continue;

                    let h = 1;
                    while (y + h < height) {
                        const nextIdx = (y + h) * width + x;
                        if (visited[nextIdx] || !matches(nextIdx)) break;
                        h++;
                    }

                    let w = 1;
                    let canExpand = true;
                    while (x + w < width && canExpand) {
                        for (let dy = 0; dy < h; dy++) {
                            const nextIdx = (y + dy) * width + x + w;
                            if (visited[nextIdx] || !matches(nextIdx)) {
                                canExpand = false;
                                break;
                            }
                        }
                        if (canExpand) w++;
                    }

                    for (let dx = 0; dx < w; dx++) {
                        for (let dy = 0; dy < h; dy++) {
                            visited[(y + dy) * width + x + dx] = 1;
                        }
                    }

                    rects.push({ x, y, w, h });
                }
            }

            return rects;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (visited[idx] || !matches(idx)) continue;

                if (mode === 'area') {
                    let maxW = width - x;
                    let bestW = 1;
                    let bestH = 1;
                    let bestArea = 0;

                    for (let dy = 0; y + dy < height; dy++) {
                        let rowW = 0;
                        const rowOffset = (y + dy) * width;

                        while (rowW < maxW) {
                            const nextIdx = rowOffset + x + rowW;
                            if (visited[nextIdx] || !matches(nextIdx)) break;
                            rowW++;
                        }

                        if (rowW === 0) break;
                        maxW = Math.min(maxW, rowW);

                        const h = dy + 1;
                        const area = maxW * h;
                        if (area > bestArea) {
                            bestArea = area;
                            bestW = maxW;
                            bestH = h;
                        }
                    }

                    for (let dy = 0; dy < bestH; dy++) {
                        const rowOffset = (y + dy) * width;
                        for (let dx = 0; dx < bestW; dx++) {
                            visited[rowOffset + x + dx] = 1;
                        }
                    }

                    rects.push({ x, y, w: bestW, h: bestH });
                    continue;
                }

                let w = 1;
                while (x + w < width) {
                    const nextIdx = y * width + x + w;
                    if (visited[nextIdx] || !matches(nextIdx)) break;
                    w++;
                }

                let h = 1;
                let canExpand = true;
                while (y + h < height && canExpand) {
                    const rowOffset = (y + h) * width;
                    for (let dx = 0; dx < w; dx++) {
                        const nextIdx = rowOffset + x + dx;
                        if (visited[nextIdx] || !matches(nextIdx)) {
                            canExpand = false;
                            break;
                        }
                    }
                    if (canExpand) h++;
                }

                for (let dy = 0; dy < h; dy++) {
                    const rowOffset = (y + dy) * width;
                    for (let dx = 0; dx < w; dx++) {
                        visited[rowOffset + x + dx] = 1;
                    }
                }

                rects.push({ x, y, w, h });
            }
        }

        return rects;
    };

    const emitGreedyRects = (
        matches: (index: number) => boolean,
        emit: (x: number, y: number, w: number, h: number) => void
    ) => {
        const wideRects = collectGreedyRects(matches, 'wide');
        const tallRects = collectGreedyRects(matches, 'tall');
        const areaRects = collectGreedyRects(matches, 'area');
        const rects = [wideRects, tallRects, areaRects].reduce((best, candidate) =>
            candidate.length < best.length ? candidate : best
        );

        for (const rect of rects) {
            emit(rect.x, rect.y, rect.w, rect.h);
        }
    };

    for (const heightUnit of uniqueHeights) {
        emitGreedyRects(
            (index) => heightUnits[index] === heightUnit,
            (x, y, w, h) => addTopRect(x, y, w, h, fromHeightUnits(heightUnit))
        );
    }

    emitGreedyRects(
        (index) => heightUnits[index] > 0,
        (x, y, w, h) => addBottomRect(x, y, w, h)
    );

    const addHorizontalWall = (
        y: number,
        x0: number,
        x1: number,
        lowerUnits: number,
        upperUnits: number,
        solidSouth: boolean
    ) => {
        const left = x0 * pixelSize;
        const right = x1 * pixelSize;
        const yCoord = y * pixelSize;
        const lower = fromHeightUnits(lowerUnits);
        const upper = fromHeightUnits(upperUnits);

        if (solidSouth) {
            pushQuad(right, yCoord, lower, right, yCoord, upper, left, yCoord, upper, left, yCoord, lower);
        } else {
            pushQuad(left, yCoord, lower, left, yCoord, upper, right, yCoord, upper, right, yCoord, lower);
        }
        stats.horizontalWallQuads++;
    };

    const addVerticalWall = (
        x: number,
        y0: number,
        y1: number,
        lowerUnits: number,
        upperUnits: number,
        solidEast: boolean
    ) => {
        const xCoord = x * pixelSize;
        const top = y0 * pixelSize;
        const bottom = y1 * pixelSize;
        const lower = fromHeightUnits(lowerUnits);
        const upper = fromHeightUnits(upperUnits);

        if (solidEast) {
            pushQuad(xCoord, top, lower, xCoord, top, upper, xCoord, bottom, upper, xCoord, bottom, lower);
        } else {
            pushQuad(xCoord, bottom, lower, xCoord, bottom, upper, xCoord, top, upper, xCoord, top, lower);
        }
        stats.verticalWallQuads++;
    };

    for (let y = 0; y <= height; y++) {
        let runStart = 0;
        let runLower = 0;
        let runUpper = 0;
        let runSolidSouth = false;
        let inRun = false;

        for (let x = 0; x <= width; x++) {
            const north = x < width && y > 0 ? heightUnits[(y - 1) * width + x] : 0;
            const south = x < width && y < height ? heightUnits[y * width + x] : 0;
            const hasWall = x < width && north !== south;
            const lower = hasWall ? Math.min(north, south) : 0;
            const upper = hasWall ? Math.max(north, south) : 0;
            const solidSouth = south > north;
            const continues =
                hasWall &&
                inRun &&
                lower === runLower &&
                upper === runUpper &&
                solidSouth === runSolidSouth;

            if (!continues && inRun) {
                addHorizontalWall(y, runStart, x, runLower, runUpper, runSolidSouth);
                inRun = false;
            }

            if (hasWall && !inRun) {
                runStart = x;
                runLower = lower;
                runUpper = upper;
                runSolidSouth = solidSouth;
                inRun = true;
            }
        }
    }

    for (let x = 0; x <= width; x++) {
        let runStart = 0;
        let runLower = 0;
        let runUpper = 0;
        let runSolidEast = false;
        let inRun = false;

        for (let y = 0; y <= height; y++) {
            const west = y < height && x > 0 ? heightUnits[y * width + x - 1] : 0;
            const east = y < height && x < width ? heightUnits[y * width + x] : 0;
            const hasWall = y < height && west !== east;
            const lower = hasWall ? Math.min(west, east) : 0;
            const upper = hasWall ? Math.max(west, east) : 0;
            const solidEast = east > west;
            const continues =
                hasWall &&
                inRun &&
                lower === runLower &&
                upper === runUpper &&
                solidEast === runSolidEast;

            if (!continues && inRun) {
                addVerticalWall(x, runStart, y, runLower, runUpper, runSolidEast);
                inRun = false;
            }

            if (hasWall && !inRun) {
                runStart = y;
                runLower = lower;
                runUpper = upper;
                runSolidEast = solidEast;
                inRun = true;
            }
        }
    }

    if (quads.length === 0) {
        return null;
    }

    stats.totalQuads = quads.length / 12;
    stats.triangleCount = stats.totalQuads * 2;
    return { quads, stats };
}

async function exportQuadsToStlBlob(
    quads: number[],
    onProgress?: (p: number) => void
): Promise<Blob> {
    const totalTris = (quads.length / 12) * 2;
    return exportTrianglesToStlBlob(totalTris, onProgress, async (writeTriangle) => {
        for (let i = 0; i < quads.length; i += 12) {
            const shouldYieldA = writeTriangle(
                quads[i],
                quads[i + 1],
                quads[i + 2],
                quads[i + 3],
                quads[i + 4],
                quads[i + 5],
                quads[i + 6],
                quads[i + 7],
                quads[i + 8]
            );
            const shouldYieldB = writeTriangle(
                quads[i],
                quads[i + 1],
                quads[i + 2],
                quads[i + 6],
                quads[i + 7],
                quads[i + 8],
                quads[i + 9],
                quads[i + 10],
                quads[i + 11]
            );

            if (shouldYieldA || shouldYieldB) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    });
}

type TriangleWriter = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number
) => boolean;

async function exportTrianglesToStlBlob(
    totalTris: number,
    onProgress: ((p: number) => void) | undefined,
    writeBody: (writeTriangle: TriangleWriter) => Promise<void>
): Promise<Blob> {
    if (totalTris > 0xffffffff) {
        throw new Error('STL export exceeds the binary STL triangle limit');
    }

    const headerBytes = 80;
    const triangleBytes = 50;
    const header = new ArrayBuffer(headerBytes + 4);
    const headerView = new DataView(header);
    const headerStr = 'Kromacut Binary STL';
    for (let i = 0; i < headerStr.length && i < 80; i++) {
        headerView.setUint8(i, headerStr.charCodeAt(i));
    }
    headerView.setUint32(headerBytes, totalTris, true);

    const parts: BlobPart[] = [header];
    const TRIANGLES_PER_OUTPUT_CHUNK = 100000;
    let chunkBuffer: ArrayBuffer | null = null;
    let chunkView: DataView | null = null;
    let chunkOffset = 0;
    let chunkTriangles = 0;
    const progressChunk = Math.max(1000, Math.floor(totalTris / 5));
    let processedTris = 0;

    const ensureChunk = () => {
        if (chunkBuffer) return;
        chunkBuffer = new ArrayBuffer(TRIANGLES_PER_OUTPUT_CHUNK * triangleBytes);
        chunkView = new DataView(chunkBuffer);
        chunkOffset = 0;
        chunkTriangles = 0;
    };

    const flushChunk = () => {
        if (!chunkBuffer || chunkTriangles === 0) return;
        parts.push(
            chunkTriangles === TRIANGLES_PER_OUTPUT_CHUNK
                ? chunkBuffer
                : chunkBuffer.slice(0, chunkOffset)
        );
        chunkBuffer = null;
        chunkView = null;
        chunkOffset = 0;
        chunkTriangles = 0;
    };

    const writeTriangle: TriangleWriter = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const normalLength = Math.hypot(nx, ny, nz);

        if (normalLength > 0) {
            nx /= normalLength;
            ny /= normalLength;
            nz /= normalLength;
        }

        ensureChunk();
        const view = chunkView!;
        const offset = chunkOffset;

        view.setFloat32(offset + 0, nx, true);
        view.setFloat32(offset + 4, ny, true);
        view.setFloat32(offset + 8, nz, true);
        view.setFloat32(offset + 12, ax, true);
        view.setFloat32(offset + 16, ay, true);
        view.setFloat32(offset + 20, az, true);
        view.setFloat32(offset + 24, bx, true);
        view.setFloat32(offset + 28, by, true);
        view.setFloat32(offset + 32, bz, true);
        view.setFloat32(offset + 36, cx, true);
        view.setFloat32(offset + 40, cy, true);
        view.setFloat32(offset + 44, cz, true);
        view.setUint16(offset + 48, 0, true);
        chunkOffset += triangleBytes;
        chunkTriangles++;
        processedTris++;

        if (chunkTriangles === TRIANGLES_PER_OUTPUT_CHUNK) {
            flushChunk();
        }

        if (processedTris % progressChunk === 0 && onProgress && totalTris > 0) {
            onProgress(processedTris / totalTris);
            return true;
        }

        return false;
    };

    await writeBody(writeTriangle);
    flushChunk();

    onProgress?.(1);
    return new Blob(parts, { type: 'model/stl' });
}

export async function exportObjectToStlBlob(
    root: THREE.Object3D,
    onProgress?: (p: number) => void
): Promise<Blob> {
    // 1. Collect all meshes
    const meshes: THREE.Mesh[] = [];
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            if (m.geometry && m.visible) {
                meshes.push(m);
            }
        }
    });

    if (meshes.length === 0) throw new Error('No meshes found to export');

    const compactHeightfield = buildKromacutHeightfieldQuads(meshes);
    if (compactHeightfield) {
        publishStlStats(compactHeightfield.stats);
        return exportQuadsToStlBlob(compactHeightfield.quads, onProgress);
    }

    // 2. Count triangles for the STL header.
    let totalTris = 0;
    for (const mesh of meshes) {
        const geom = mesh.geometry;
        const source = getKromacutExportGeometry(geom);
        if (source?.indices) {
            totalTris += Math.floor(source.indices.length / 3);
        } else if (geom.index) {
            totalTris += Math.floor(geom.index.count / 3);
        } else if (geom.attributes.position) {
            totalTris += Math.floor(geom.attributes.position.count / 3);
        }
    }

    if (totalTris > 0xffffffff) {
        throw new Error('STL export exceeds the binary STL triangle limit');
    }

    const headerBytes = 80;
    const triangleBytes = 50;
    const header = new ArrayBuffer(headerBytes + 4);
    const headerView = new DataView(header);
    const headerStr = 'Kromacut Binary STL';
    for (let i = 0; i < headerStr.length && i < 80; i++) {
        headerView.setUint8(i, headerStr.charCodeAt(i));
    }
    headerView.setUint32(headerBytes, totalTris, true);

    const parts: BlobPart[] = [header];
    const TRIANGLES_PER_OUTPUT_CHUNK = 100000;
    let chunkBuffer: ArrayBuffer | null = null;
    let chunkView: DataView | null = null;
    let chunkOffset = 0;
    let chunkTriangles = 0;

    const ensureChunk = () => {
        if (chunkBuffer) return;
        chunkBuffer = new ArrayBuffer(TRIANGLES_PER_OUTPUT_CHUNK * triangleBytes);
        chunkView = new DataView(chunkBuffer);
        chunkOffset = 0;
        chunkTriangles = 0;
    };

    const flushChunk = () => {
        if (!chunkBuffer || chunkTriangles === 0) return;
        parts.push(
            chunkTriangles === TRIANGLES_PER_OUTPUT_CHUNK
                ? chunkBuffer
                : chunkBuffer.slice(0, chunkOffset)
        );
        chunkBuffer = null;
        chunkView = null;
        chunkOffset = 0;
        chunkTriangles = 0;
    };

    const CHUNK = Math.max(1000, Math.floor(totalTris / 5)); // Process in chunks to yield to UI
    let processedTris = 0;

    // Helper vector for transforming
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const n = new THREE.Vector3();
    const vAB = new THREE.Vector3();
    const vAC = new THREE.Vector3();
    const fastA = new Float64Array(3);
    const fastB = new Float64Array(3);
    const fastC = new Float64Array(3);

    const writeTriangle = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number
    ) => {
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;
        const normalLength = Math.hypot(nx, ny, nz);

        if (normalLength > 0) {
            nx /= normalLength;
            ny /= normalLength;
            nz /= normalLength;
        }

        ensureChunk();
        const view = chunkView!;
        const offset = chunkOffset;

        view.setFloat32(offset + 0, nx, true);
        view.setFloat32(offset + 4, ny, true);
        view.setFloat32(offset + 8, nz, true);
        view.setFloat32(offset + 12, ax, true);
        view.setFloat32(offset + 16, ay, true);
        view.setFloat32(offset + 20, az, true);
        view.setFloat32(offset + 24, bx, true);
        view.setFloat32(offset + 28, by, true);
        view.setFloat32(offset + 32, bz, true);
        view.setFloat32(offset + 36, cx, true);
        view.setFloat32(offset + 40, cy, true);
        view.setFloat32(offset + 44, cz, true);
        view.setUint16(offset + 48, 0, true);
        chunkOffset += triangleBytes;
        chunkTriangles++;

        processedTris++;
        if (chunkTriangles === TRIANGLES_PER_OUTPUT_CHUNK) {
            flushChunk();
        }
        return processedTris % CHUNK === 0 && onProgress && totalTris > 0;
    };

    // 3. Write triangles
    for (const mesh of meshes) {
        const geom = mesh.geometry;
        const pos = geom.getAttribute('position');
        const index = geom.getIndex();
        const matrix = mesh.matrixWorld;
        const source = getKromacutExportGeometry(geom);

        if (source?.indices) {
            const positions = source.positions;
            const indices = source.indices;
            const itemSize = source.itemSize ?? 3;

            for (let i = 0; i < indices.length; i += 3) {
                readTransformedPosition(positions, itemSize, indices[i], matrix, fastA);
                readTransformedPosition(positions, itemSize, indices[i + 1], matrix, fastB);
                readTransformedPosition(positions, itemSize, indices[i + 2], matrix, fastC);

                if (
                    writeTriangle(
                        fastA[0],
                        fastA[1],
                        fastA[2],
                        fastB[0],
                        fastB[1],
                        fastB[2],
                        fastC[0],
                        fastC[1],
                        fastC[2]
                    )
                ) {
                    onProgress?.(processedTris / totalTris);
                    await new Promise((r) => setTimeout(r, 0));
                }
            }
            continue;
        }

        // Ensure normals for lighting if needed, though STL usually ignores them or expects computed face normals
        // We compute face normals on the fly below for the STL file

        const count = index ? index.count : pos.count;

        for (let i = 0; i < count; i += 3) {
            // Get indices
            let a, b, c;
            if (index) {
                a = index.getX(i);
                b = index.getX(i + 1);
                c = index.getX(i + 2);
            } else {
                a = i;
                b = i + 1;
                c = i + 2;
            }

            // Get vertices and transform to world space
            vA.fromBufferAttribute(pos, a).applyMatrix4(matrix);
            vB.fromBufferAttribute(pos, b).applyMatrix4(matrix);
            vC.fromBufferAttribute(pos, c).applyMatrix4(matrix);

            // Compute normal
            vAB.subVectors(vB, vA);
            vAC.subVectors(vC, vA);
            n.crossVectors(vAB, vAC).normalize();

            if (writeTriangle(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z)) {
                onProgress?.(processedTris / totalTris);
                await new Promise((r) => setTimeout(r, 0));
            }
        }
    }

    flushChunk();

    if (onProgress) onProgress(1);
    return new Blob(parts, { type: 'model/stl' });
}

export default exportObjectToStlBlob;
