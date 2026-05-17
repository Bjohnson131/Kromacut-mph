import type { MeshData } from '../src/lib/meshing.ts';

export interface MeshBounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export interface MeshIntegrityReport {
    vertexCount: number;
    triangleCount: number;
    invalidPositionCount: number;
    invalidIndexCount: number;
    degenerateTriangleCount: number;
    duplicateTriangleCount: number;
    boundaryEdgeCount: number;
    nonManifoldEdgeCount: number;
    inconsistentWindingEdgeCount: number;
    signedVolume: number;
    bounds: MeshBounds | null;
    isWatertight: boolean;
    isConsistentlyOriented: boolean;
    isOutwardFacing: boolean;
    isValid: boolean;
}

interface EdgeUse {
    count: number;
    directions: Map<string, number>;
}

export interface MeshIntegrityOptions {
    edgeEpsilon?: number;
    volumeEpsilon?: number;
    areaEpsilon?: number;
}

const DEFAULT_EDGE_EPSILON = 1e-6;
const DEFAULT_VOLUME_EPSILON = 1e-9;
const DEFAULT_AREA_EPSILON = 1e-12;

const makeBounds = (): MeshBounds => ({
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
});

const updateBounds = (bounds: MeshBounds, x: number, y: number, z: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
};

const addEdgeUse = (edges: Map<string, EdgeUse>, from: string, to: string) => {
    const edgeKey = from < to ? `${from}|${to}` : `${to}|${from}`;
    const directionKey = `${from}>${to}`;
    let edge = edges.get(edgeKey);

    if (!edge) {
        edge = { count: 0, directions: new Map() };
        edges.set(edgeKey, edge);
    }

    edge.count++;
    edge.directions.set(directionKey, (edge.directions.get(directionKey) ?? 0) + 1);
};

export function inspectMeshIntegrity(
    mesh: MeshData,
    options: MeshIntegrityOptions = {}
): MeshIntegrityReport {
    const edgeEpsilon = options.edgeEpsilon ?? DEFAULT_EDGE_EPSILON;
    const volumeEpsilon = options.volumeEpsilon ?? DEFAULT_VOLUME_EPSILON;
    const areaEpsilon = options.areaEpsilon ?? DEFAULT_AREA_EPSILON;
    const vertexCount = Math.floor(mesh.positions.length / 3);
    const triangleCount = Math.floor(mesh.indices.length / 3);
    const bounds = makeBounds();
    const vertexKeys: string[] = [];
    const invalidVertices = new Uint8Array(vertexCount);
    let invalidPositionCount = mesh.positions.length % 3;
    let hasBounds = false;

    for (let vertex = 0; vertex < vertexCount; vertex++) {
        const offset = vertex * 3;
        const x = mesh.positions[offset];
        const y = mesh.positions[offset + 1];
        const z = mesh.positions[offset + 2];

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            invalidVertices[vertex] = 1;
            invalidPositionCount++;
            vertexKeys[vertex] = `invalid:${vertex}`;
            continue;
        }

        updateBounds(bounds, x, y, z);
        hasBounds = true;
        vertexKeys[vertex] = [
            Math.round(x / edgeEpsilon),
            Math.round(y / edgeEpsilon),
            Math.round(z / edgeEpsilon),
        ].join(',');
    }

    const edges = new Map<string, EdgeUse>();
    const triangles = new Map<string, number>();
    let invalidIndexCount = mesh.indices.length % 3;
    let degenerateTriangleCount = 0;
    let signedVolume = 0;

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const a = mesh.indices[i];
        const b = mesh.indices[i + 1];
        const c = mesh.indices[i + 2];

        if (
            !Number.isInteger(a) ||
            !Number.isInteger(b) ||
            !Number.isInteger(c) ||
            a < 0 ||
            b < 0 ||
            c < 0 ||
            a >= vertexCount ||
            b >= vertexCount ||
            c >= vertexCount
        ) {
            invalidIndexCount += Number.isInteger(a) && a >= 0 && a < vertexCount ? 0 : 1;
            invalidIndexCount += Number.isInteger(b) && b >= 0 && b < vertexCount ? 0 : 1;
            invalidIndexCount += Number.isInteger(c) && c >= 0 && c < vertexCount ? 0 : 1;
            continue;
        }

        if (invalidVertices[a] || invalidVertices[b] || invalidVertices[c]) {
            continue;
        }

        const keyA = vertexKeys[a];
        const keyB = vertexKeys[b];
        const keyC = vertexKeys[c];

        if (keyA === keyB || keyB === keyC || keyC === keyA) {
            degenerateTriangleCount++;
            continue;
        }

        const ai = a * 3;
        const bi = b * 3;
        const ci = c * 3;
        const ax = mesh.positions[ai];
        const ay = mesh.positions[ai + 1];
        const az = mesh.positions[ai + 2];
        const bx = mesh.positions[bi];
        const by = mesh.positions[bi + 1];
        const bz = mesh.positions[bi + 2];
        const cx = mesh.positions[ci];
        const cy = mesh.positions[ci + 1];
        const cz = mesh.positions[ci + 2];

        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const crossX = aby * acz - abz * acy;
        const crossY = abz * acx - abx * acz;
        const crossZ = abx * acy - aby * acx;
        const area = Math.hypot(crossX, crossY, crossZ) * 0.5;

        if (area <= areaEpsilon) {
            degenerateTriangleCount++;
            continue;
        }

        const triangleKey = [keyA, keyB, keyC].sort().join('|');
        triangles.set(triangleKey, (triangles.get(triangleKey) ?? 0) + 1);

        signedVolume +=
            (ax * (by * cz - bz * cy) +
                ay * (bz * cx - bx * cz) +
                az * (bx * cy - by * cx)) /
            6;

        addEdgeUse(edges, keyA, keyB);
        addEdgeUse(edges, keyB, keyC);
        addEdgeUse(edges, keyC, keyA);
    }

    let duplicateTriangleCount = 0;
    for (const count of triangles.values()) {
        if (count > 1) {
            duplicateTriangleCount += count - 1;
        }
    }

    let boundaryEdgeCount = 0;
    let nonManifoldEdgeCount = 0;
    let inconsistentWindingEdgeCount = 0;

    for (const edge of edges.values()) {
        if (edge.count === 1) {
            boundaryEdgeCount++;
        } else if (edge.count !== 2) {
            nonManifoldEdgeCount++;
        } else if (edge.directions.size !== 2) {
            inconsistentWindingEdgeCount++;
        }
    }

    const isWatertight = boundaryEdgeCount === 0 && nonManifoldEdgeCount === 0;
    const isConsistentlyOriented = inconsistentWindingEdgeCount === 0;
    const isOutwardFacing = signedVolume > volumeEpsilon;
    const isValid =
        invalidPositionCount === 0 &&
        invalidIndexCount === 0 &&
        degenerateTriangleCount === 0 &&
        duplicateTriangleCount === 0 &&
        isWatertight &&
        isConsistentlyOriented &&
        isOutwardFacing;

    return {
        vertexCount,
        triangleCount,
        invalidPositionCount,
        invalidIndexCount,
        degenerateTriangleCount,
        duplicateTriangleCount,
        boundaryEdgeCount,
        nonManifoldEdgeCount,
        inconsistentWindingEdgeCount,
        signedVolume,
        bounds: hasBounds ? bounds : null,
        isWatertight,
        isConsistentlyOriented,
        isOutwardFacing,
        isValid,
    };
}
