import { ShapeUtils, Vector2 } from 'three';

export interface MeshData {
    positions: Float32Array;
    indices: number[];
}

export type FootprintTriangle = [[number, number], [number, number], [number, number]];

// ============================================================================
// Smooth Contour Meshing
// ============================================================================

const SMOOTH_SIMPLIFY_EPSILON = 0.75;
const SMOOTH_CHAIKIN_ITERATIONS = 2;
const SMOOTH_CHAIKIN_WEIGHT = 0.2;
const SMOOTH_PROTECTED_WEIGHT_STEPS = 6;
const LOOP_EPSILON = 1e-6;
const LOOP_COLLINEAR_EPSILON = 1e-5;

type CornerCutValidator = (corner: Vector2, incoming: Vector2, outgoing: Vector2) => boolean;
type ShortcutValidator = (points: Vector2[]) => boolean;

const pointDistanceSq = (a: Vector2, b: Vector2) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
};

const triangleArea2D = (point: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - point[0]) * (b[1] - point[1]) - (a[1] - point[1]) * (b[0] - point[0]);

const pointInTriangleInterior2D = (
    point: [number, number],
    a: [number, number],
    b: [number, number],
    c: [number, number]
) => {
    const d1 = triangleArea2D(point, a, b);
    const d2 = triangleArea2D(point, b, c);
    const d3 = triangleArea2D(point, c, a);

    return (
        (d1 > LOOP_EPSILON && d2 > LOOP_EPSILON && d3 > LOOP_EPSILON) ||
        (d1 < -LOOP_EPSILON && d2 < -LOOP_EPSILON && d3 < -LOOP_EPSILON)
    );
};

const pointInTriangle2D = (
    point: [number, number],
    a: [number, number],
    b: [number, number],
    c: [number, number]
) => {
    const d1 = triangleArea2D(point, a, b);
    const d2 = triangleArea2D(point, b, c);
    const d3 = triangleArea2D(point, c, a);
    const hasNegative = d1 < -LOOP_EPSILON || d2 < -LOOP_EPSILON || d3 < -LOOP_EPSILON;
    const hasPositive = d1 > LOOP_EPSILON || d2 > LOOP_EPSILON || d3 > LOOP_EPSILON;

    return !(hasNegative && hasPositive);
};

const segmentIntersectsSegmentInterior2D = (
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number]
) => {
    const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);

    return (
        ((o1 > LOOP_EPSILON && o2 < -LOOP_EPSILON) || (o1 < -LOOP_EPSILON && o2 > LOOP_EPSILON)) &&
        ((o3 > LOOP_EPSILON && o4 < -LOOP_EPSILON) || (o3 < -LOOP_EPSILON && o4 > LOOP_EPSILON))
    );
};

const triangleBoundsOverlap2D = (a: FootprintTriangle, b: FootprintTriangle) => {
    const aMinX = Math.min(a[0][0], a[1][0], a[2][0]);
    const aMaxX = Math.max(a[0][0], a[1][0], a[2][0]);
    const aMinY = Math.min(a[0][1], a[1][1], a[2][1]);
    const aMaxY = Math.max(a[0][1], a[1][1], a[2][1]);
    const bMinX = Math.min(b[0][0], b[1][0], b[2][0]);
    const bMaxX = Math.max(b[0][0], b[1][0], b[2][0]);
    const bMinY = Math.min(b[0][1], b[1][1], b[2][1]);
    const bMaxY = Math.max(b[0][1], b[1][1], b[2][1]);

    return (
        aMinX <= bMaxX + LOOP_EPSILON &&
        aMaxX + LOOP_EPSILON >= bMinX &&
        aMinY <= bMaxY + LOOP_EPSILON &&
        aMaxY + LOOP_EPSILON >= bMinY
    );
};

const trianglesOverlap2D = (a: FootprintTriangle, b: FootprintTriangle) => {
    if (!triangleBoundsOverlap2D(a, b)) return false;

    const samples = (triangle: FootprintTriangle): Array<[number, number]> => [
        [
            (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
            (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
        ],
        [(triangle[0][0] + triangle[1][0]) / 2, (triangle[0][1] + triangle[1][1]) / 2],
        [(triangle[1][0] + triangle[2][0]) / 2, (triangle[1][1] + triangle[2][1]) / 2],
        [(triangle[2][0] + triangle[0][0]) / 2, (triangle[2][1] + triangle[0][1]) / 2],
    ];

    if (
        a.some((point) => pointInTriangleInterior2D(point, b[0], b[1], b[2])) ||
        b.some((point) => pointInTriangleInterior2D(point, a[0], a[1], a[2])) ||
        samples(a).some((point) => pointInTriangleInterior2D(point, b[0], b[1], b[2])) ||
        samples(b).some((point) => pointInTriangleInterior2D(point, a[0], a[1], a[2]))
    ) {
        return true;
    }

    for (let i = 0; i < 3; i++) {
        const a0 = a[i];
        const a1 = a[(i + 1) % 3];
        for (let j = 0; j < 3; j++) {
            const b0 = b[j];
            const b1 = b[(j + 1) % 3];
            if (segmentIntersectsSegmentInterior2D(a0, a1, b0, b1)) {
                return true;
            }
        }
    }

    return false;
};

export function extractHorizontalCapFootprint(
    mesh: MeshData,
    z: number,
    pixelSize: number
): FootprintTriangle[] {
    const triangles: FootprintTriangle[] = [];

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const ids = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
        const points = ids.map((id) => {
            const offset = id * 3;
            return [
                mesh.positions[offset] / pixelSize,
                mesh.positions[offset + 1] / pixelSize,
                mesh.positions[offset + 2],
            ] as const;
        });

        if (
            Math.abs(points[0][2] - z) <= 1e-6 &&
            Math.abs(points[1][2] - z) <= 1e-6 &&
            Math.abs(points[2][2] - z) <= 1e-6
        ) {
            const triangle: FootprintTriangle = [
                [points[0][0], points[0][1]],
                [points[1][0], points[1][1]],
                [points[2][0], points[2][1]],
            ];
            const area = Math.abs(triangleArea2D(triangle[0], triangle[1], triangle[2]));

            if (area > LOOP_EPSILON * LOOP_EPSILON) {
                triangles.push(triangle);
            }
        }
    }

    return triangles;
}

const footprintSamples = (triangle: FootprintTriangle): Array<[number, number]> => [
    [
        (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
        (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
    ],
    [(triangle[0][0] + triangle[1][0]) / 2, (triangle[0][1] + triangle[1][1]) / 2],
    [(triangle[1][0] + triangle[2][0]) / 2, (triangle[1][1] + triangle[2][1]) / 2],
    [(triangle[2][0] + triangle[0][0]) / 2, (triangle[2][1] + triangle[0][1]) / 2],
];

export function findUnsupportedFootprintTriangles(
    supportFootprint: FootprintTriangle[],
    protectedFootprint: FootprintTriangle[]
): FootprintTriangle[] {
    if (protectedFootprint.length === 0) return [];
    if (supportFootprint.length === 0) return protectedFootprint;

    const bucketSize = 4;
    const buckets = new Map<string, FootprintTriangle[]>();
    const bucketKey = (x: number, y: number) => `${x},${y}`;

    for (const triangle of supportFootprint) {
        const minX = Math.floor(
            Math.min(triangle[0][0], triangle[1][0], triangle[2][0]) / bucketSize
        );
        const maxX = Math.floor(
            Math.max(triangle[0][0], triangle[1][0], triangle[2][0]) / bucketSize
        );
        const minY = Math.floor(
            Math.min(triangle[0][1], triangle[1][1], triangle[2][1]) / bucketSize
        );
        const maxY = Math.floor(
            Math.max(triangle[0][1], triangle[1][1], triangle[2][1]) / bucketSize
        );

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const key = bucketKey(x, y);
                const bucket = buckets.get(key);

                if (bucket) {
                    bucket.push(triangle);
                } else {
                    buckets.set(key, [triangle]);
                }
            }
        }
    }

    return protectedFootprint.filter((triangle) =>
        footprintSamples(triangle).some((sample) => {
            const bucket = buckets.get(
                bucketKey(Math.floor(sample[0] / bucketSize), Math.floor(sample[1] / bucketSize))
            );

            return !bucket?.some((supportTriangle) =>
                pointInTriangle2D(
                    sample,
                    supportTriangle[0],
                    supportTriangle[1],
                    supportTriangle[2]
                )
            );
        })
    );
}

type FootprintEdge = {
    count: number;
    a: [number, number];
    b: [number, number];
};

const footprintVertexKey = ([x, y]: [number, number]) =>
    `${Math.round(x / LOOP_EPSILON)},${Math.round(y / LOOP_EPSILON)}`;

const footprintEdgeKey = (a: [number, number], b: [number, number]) => {
    const keyA = footprintVertexKey(a);
    const keyB = footprintVertexKey(b);

    return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
};

export function createFootprintSupportPrismMesh(
    footprint: FootprintTriangle[],
    zBottom: number,
    zTop: number,
    pixelSize: number
): MeshData | null {
    if (footprint.length === 0 || Math.abs(zTop - zBottom) <= LOOP_EPSILON) {
        return null;
    }

    const positions: number[] = [];
    const indices: number[] = [];
    const topVertices = new Map<string, number>();
    const bottomVertices = new Map<string, number>();
    const boundaryEdges = new Map<string, FootprintEdge>();

    const getVertex = (point: [number, number], z: number, vertices: Map<string, number>) => {
        const key = footprintVertexKey(point);
        const existing = vertices.get(key);

        if (existing !== undefined) {
            return existing;
        }

        const index = positions.length / 3;
        vertices.set(key, index);
        positions.push(point[0] * pixelSize, point[1] * pixelSize, z);
        return index;
    };

    const addEdge = (a: [number, number], b: [number, number]) => {
        const key = footprintEdgeKey(a, b);
        const existing = boundaryEdges.get(key);

        if (existing) {
            existing.count++;
        } else {
            boundaryEdges.set(key, { count: 1, a, b });
        }
    };

    for (const sourceTriangle of footprint) {
        const triangle: FootprintTriangle = [
            [...sourceTriangle[0]],
            [...sourceTriangle[1]],
            [...sourceTriangle[2]],
        ];
        const area = triangleArea2D(triangle[0], triangle[1], triangle[2]);

        if (Math.abs(area) <= LOOP_EPSILON * LOOP_EPSILON) {
            continue;
        }

        if (area < 0) {
            [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
        }

        const topA = getVertex(triangle[0], zTop, topVertices);
        const topB = getVertex(triangle[1], zTop, topVertices);
        const topC = getVertex(triangle[2], zTop, topVertices);
        const bottomA = getVertex(triangle[0], zBottom, bottomVertices);
        const bottomB = getVertex(triangle[1], zBottom, bottomVertices);
        const bottomC = getVertex(triangle[2], zBottom, bottomVertices);

        indices.push(topA, topB, topC);
        indices.push(bottomA, bottomC, bottomB);
        addEdge(triangle[0], triangle[1]);
        addEdge(triangle[1], triangle[2]);
        addEdge(triangle[2], triangle[0]);
    }

    for (const edge of boundaryEdges.values()) {
        if (edge.count !== 1) {
            continue;
        }

        const topA = getVertex(edge.a, zTop, topVertices);
        const topB = getVertex(edge.b, zTop, topVertices);
        const bottomA = getVertex(edge.a, zBottom, bottomVertices);
        const bottomB = getVertex(edge.b, zBottom, bottomVertices);

        indices.push(topA, bottomB, topB);
        indices.push(topA, bottomA, bottomB);
    }

    if (indices.length === 0) {
        return null;
    }

    return {
        positions: new Float32Array(positions),
        indices,
    };
}

export function createFootprintSupportPrismMeshes(
    footprint: FootprintTriangle[],
    zBottom: number,
    zTop: number,
    pixelSize: number
): MeshData[] {
    const meshes: MeshData[] = [];

    for (const triangle of footprint) {
        const mesh = createFootprintSupportPrismMesh([triangle], zBottom, zTop, pixelSize);
        if (mesh) {
            meshes.push(mesh);
        }
    }

    return meshes;
}

function simplifyLoop(loop: Vector2[]): Vector2[] {
    let points = loop.filter(
        (point, index) =>
            index === 0 || pointDistanceSq(point, loop[index - 1]) > LOOP_EPSILON * LOOP_EPSILON
    );

    if (
        points.length > 1 &&
        pointDistanceSq(points[0], points[points.length - 1]) <= LOOP_EPSILON * LOOP_EPSILON
    ) {
        points = points.slice(0, -1);
    }

    let changed = true;
    while (changed && points.length >= 3) {
        changed = false;
        const nextPoints: Vector2[] = [];

        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];

            const ax = curr.x - prev.x;
            const ay = curr.y - prev.y;
            const bx = next.x - curr.x;
            const by = next.y - curr.y;
            const cross = ax * by - ay * bx;
            const dot = ax * bx + ay * by;

            const segmentScale = Math.max(1, Math.hypot(ax, ay), Math.hypot(bx, by));

            if (Math.abs(cross) <= LOOP_COLLINEAR_EPSILON * segmentScale && dot >= 0) {
                changed = true;
                continue;
            }

            nextPoints.push(curr);
        }

        if (nextPoints.length >= 3) {
            points = nextPoints;
        } else {
            break;
        }
    }

    return points;
}

const perpendicularDistanceToLine = (point: Vector2, start: Vector2, end: Vector2) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq <= LOOP_EPSILON * LOOP_EPSILON) {
        return Math.sqrt(pointDistanceSq(point, start));
    }

    return (
        Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.sqrt(lenSq)
    );
};

function ramerDouglasPeucker(
    points: Vector2[],
    epsilon: number,
    canUseShortcut?: ShortcutValidator
): Vector2[] {
    if (points.length <= 2) return points.map((point) => point.clone());

    let maxDistance = -1;
    let splitIndex = -1;

    for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistanceToLine(
            points[i],
            points[0],
            points[points.length - 1]
        );
        if (distance > maxDistance) {
            maxDistance = distance;
            splitIndex = i;
        }
    }

    if (
        (maxDistance <= epsilon || splitIndex === -1) &&
        (!canUseShortcut || canUseShortcut(points))
    ) {
        return [points[0].clone(), points[points.length - 1].clone()];
    }

    const split = splitIndex > 0 ? splitIndex : Math.floor(points.length / 2);
    const left = ramerDouglasPeucker(points.slice(0, split + 1), epsilon, canUseShortcut);
    const right = ramerDouglasPeucker(points.slice(split), epsilon, canUseShortcut);
    return [...left.slice(0, -1), ...right];
}

function selectLoopAnchor(loop: Vector2[]): number {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < loop.length; i++) {
        const prev = loop[(i - 1 + loop.length) % loop.length];
        const curr = loop[i];
        const next = loop[(i + 1) % loop.length];

        const ax = curr.x - prev.x;
        const ay = curr.y - prev.y;
        const bx = next.x - curr.x;
        const by = next.y - curr.y;
        const turn = Math.abs(ax * by - ay * bx);
        const span = Math.hypot(ax, ay) + Math.hypot(bx, by);
        const score = turn * 10 + span;

        if (
            score > bestScore ||
            (Math.abs(score - bestScore) <= LOOP_EPSILON &&
                (curr.y < loop[bestIndex].y ||
                    (curr.y === loop[bestIndex].y && curr.x < loop[bestIndex].x)))
        ) {
            bestScore = score;
            bestIndex = i;
        }
    }

    return bestIndex;
}

function simplifyAliasedLoop(loop: Vector2[], canUseShortcut?: ShortcutValidator): Vector2[] {
    if (loop.length < 5) return loop.map((point) => point.clone());

    const anchor = selectLoopAnchor(loop);
    const rotated = [...loop.slice(anchor), ...loop.slice(0, anchor)];
    const simplified = ramerDouglasPeucker(
        [...rotated, rotated[0]],
        SMOOTH_SIMPLIFY_EPSILON,
        canUseShortcut
    ).slice(0, -1);

    return simplified.length >= 3 ? simplifyLoop(simplified) : loop.map((point) => point.clone());
}

function pushDistinctPoint(points: Vector2[], point: Vector2) {
    if (
        points.length === 0 ||
        pointDistanceSq(point, points[points.length - 1]) > LOOP_EPSILON * LOOP_EPSILON
    ) {
        points.push(point);
    }
}

function chaikinSmoothLoop(
    loop: Vector2[],
    canCutCorner?: CornerCutValidator,
    allowPartialProtectedCuts = true
): Vector2[] {
    let points = loop.map((point) => point.clone());

    for (let iteration = 0; iteration < SMOOTH_CHAIKIN_ITERATIONS; iteration++) {
        if (points.length < 3) break;

        const next: Vector2[] = [];
        for (let i = 0; i < points.length; i++) {
            const previous = points[(i - 1 + points.length) % points.length];
            const current = points[i];
            const following = points[(i + 1) % points.length];

            const makeCut = (weight: number) =>
                [
                    previous.clone().lerp(current, 1 - weight),
                    current.clone().lerp(following, weight),
                ] as const;

            let [incoming, outgoing] = makeCut(SMOOTH_CHAIKIN_WEIGHT);

            if (!canCutCorner || canCutCorner(current, incoming, outgoing)) {
                pushDistinctPoint(next, incoming);
                pushDistinctPoint(next, outgoing);
            } else if (allowPartialProtectedCuts) {
                let bestWeight = 0;
                let highWeight = SMOOTH_CHAIKIN_WEIGHT;

                for (let step = 0; step < SMOOTH_PROTECTED_WEIGHT_STEPS; step++) {
                    const testWeight = (bestWeight + highWeight) / 2;
                    const [testIncoming, testOutgoing] = makeCut(testWeight);

                    if (canCutCorner(current, testIncoming, testOutgoing)) {
                        bestWeight = testWeight;
                    } else {
                        highWeight = testWeight;
                    }
                }

                if (bestWeight > LOOP_EPSILON) {
                    [incoming, outgoing] = makeCut(bestWeight);
                    pushDistinctPoint(next, incoming);
                    pushDistinctPoint(next, outgoing);
                } else {
                    pushDistinctPoint(next, current.clone());
                }
            } else {
                pushDistinctPoint(next, current.clone());
            }
        }

        points = simplifyLoop(next);
    }

    return points.length >= 3 ? points : loop.map((point) => point.clone());
}

function smoothLoop(
    loop: Vector2[],
    canCutCorner?: CornerCutValidator,
    canUseShortcut?: ShortcutValidator,
    allowPartialProtectedCuts = true
): Vector2[] {
    const simplified = simplifyAliasedLoop(loop, canUseShortcut);
    return chaikinSmoothLoop(simplified, canCutCorner, allowPartialProtectedCuts);
}

function traceComponentLoops(
    componentCells: number[],
    activePixels: Uint8Array | Uint8ClampedArray | boolean[],
    width: number,
    height: number
): Vector2[][] {
    const stride = width + 1;

    interface BoundaryEdge {
        id: number;
        start: number;
        end: number;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        direction: number;
    }

    const edges: BoundaryEdge[] = [];
    const edgesByStart = new Map<number, BoundaryEdge[]>();
    const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
        const id = edges.length;
        const edge = {
            id,
            start: sy * stride + sx,
            end: ey * stride + ex,
            startX: sx,
            startY: sy,
            endX: ex,
            endY: ey,
            direction: ex > sx ? 0 : ey > sy ? 1 : ex < sx ? 2 : 3,
        };

        edges.push(edge);
        const outgoing = edgesByStart.get(edge.start);
        if (outgoing) {
            outgoing.push(edge);
        } else {
            edgesByStart.set(edge.start, [edge]);
        }
    };

    for (const cell of componentCells) {
        const x = cell % width;
        const y = Math.floor(cell / width);

        if (y === 0 || !activePixels[(y - 1) * width + x]) {
            addEdge(x, y, x + 1, y);
        }
        if (x === width - 1 || !activePixels[y * width + (x + 1)]) {
            addEdge(x + 1, y, x + 1, y + 1);
        }
        if (y === height - 1 || !activePixels[(y + 1) * width + x]) {
            addEdge(x + 1, y + 1, x, y + 1);
        }
        if (x === 0 || !activePixels[y * width + (x - 1)]) {
            addEdge(x, y + 1, x, y);
        }
    }

    const visitedEdges = new Uint8Array(edges.length);
    const loops: Vector2[][] = [];
    const turnPriority = [3, 0, 1, 2]; // left, straight, right, then back

    const selectNextEdge = (edge: BoundaryEdge): BoundaryEdge | undefined => {
        const outgoing = edgesByStart.get(edge.end);
        if (!outgoing) return undefined;

        for (const turn of turnPriority) {
            const wantedDirection = (edge.direction + turn) & 3;
            const next = outgoing.find(
                (candidate) =>
                    !visitedEdges[candidate.id] && candidate.direction === wantedDirection
            );
            if (next) return next;
        }

        return undefined;
    };

    for (const startEdge of edges) {
        if (visitedEdges[startEdge.id]) continue;

        const loop: Vector2[] = [];
        let current = startEdge;
        let closed = false;
        let guard = 0;

        while (!visitedEdges[current.id] && guard <= edges.length) {
            visitedEdges[current.id] = 1;
            loop.push(new Vector2(current.startX, current.startY));

            if (current.end === startEdge.start) {
                closed = true;
                break;
            }

            const next = selectNextEdge(current);
            if (!next) break;
            current = next;
            guard++;
        }

        if (closed && loop.length >= 3) {
            loops.push(simplifyLoop(loop));
        }
    }

    return loops;
}

function addExtrudedLoopWalls(
    indices: number[],
    baseVert: number,
    topVertexCount: number,
    loopOffset: number,
    loop: Vector2[],
    isHole = false
) {
    const useClockwiseWinding = isHole
        ? !ShapeUtils.isClockWise(loop)
        : ShapeUtils.isClockWise(loop);

    for (let i = 0; i < loop.length; i++) {
        const topA = baseVert + loopOffset + i;
        const topB = baseVert + loopOffset + ((i + 1) % loop.length);
        const bottomA = baseVert + topVertexCount + loopOffset + i;
        const bottomB = baseVert + topVertexCount + loopOffset + ((i + 1) % loop.length);

        if (useClockwiseWinding) {
            indices.push(topA, topB, bottomB);
            indices.push(topA, bottomB, bottomA);
        } else {
            indices.push(topA, bottomB, topB);
            indices.push(topA, bottomA, bottomB);
        }
    }
}

function triangulateLoops(loops: Vector2[][]) {
    const contour = loops[0];
    const holeLoops = loops.slice(1);
    const faces = contour ? ShapeUtils.triangulateShape(contour, holeLoops) : [];

    return { faces, loops };
}

function hasDegenerateCapFaces(loops: Vector2[][], faces: number[][], pixelSize: number) {
    const vertices = loops.flat();

    for (const [a, b, c] of faces) {
        const pointA = vertices[a];
        const pointB = vertices[b];
        const pointC = vertices[c];
        const ax = Math.fround(pointA.x * pixelSize);
        const ay = Math.fround(pointA.y * pixelSize);
        const bx = Math.fround(pointB.x * pixelSize);
        const by = Math.fround(pointB.y * pixelSize);
        const cx = Math.fround(pointC.x * pixelSize);
        const cy = Math.fround(pointC.y * pixelSize);
        const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

        if (Math.abs(area2) <= 1e-12) {
            return true;
        }
    }

    return false;
}

/**
 * Generates a smooth mesh by extracting exact voxel boundaries and rounding convex corners.
 * This preserves topology while producing cleaner diagonal edges than raw voxel extrusions.
 */
export async function generateSmoothMesh(
    activePixels: Uint8Array | Uint8ClampedArray | boolean[],
    width: number,
    height: number,
    thickness: number,
    zOffset: number,
    pixelSize: number,
    heightScale: number,
    options?: MeshYieldOptions
): Promise<MeshData> {
    const positions: number[] = [];
    const indices: number[] = [];

    const yieldControl =
        options?.onYield ??
        (() =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
            }));
    const yieldIntervalMs = options?.yieldIntervalMs ?? 8;
    let lastYield = performance.now();
    const maybeYield = async () => {
        if (performance.now() - lastYield >= yieldIntervalMs) {
            await yieldControl();
            lastYield = performance.now();
        }
    };

    const scaledThickness = thickness * heightScale;
    const scaledZOffset = zOffset * heightScale;
    const zBottom = scaledZOffset;
    const zTop = scaledZOffset + scaledThickness;

    const visited = new Uint8Array(width * height);
    const queue: number[] = [];
    const protectedPixels = options?.protectedPixels;
    const protectedFootprint = options?.protectedFootprint ?? [];
    const allowPartialProtectedCuts = options?.allowPartialProtectedCuts !== false;
    const cutRemovesProtectedFootprint = (
        corner: Vector2,
        incoming: Vector2,
        outgoing: Vector2
    ) => {
        if (!protectedPixels && protectedFootprint.length === 0) {
            return false;
        }

        const cutTriangle: FootprintTriangle = [
            [corner.x, corner.y],
            [incoming.x, incoming.y],
            [outgoing.x, outgoing.y],
        ];

        if (protectedFootprint.some((triangle) => trianglesOverlap2D(cutTriangle, triangle))) {
            return true;
        }

        if (!protectedPixels) {
            return false;
        }

        const minX = Math.max(0, Math.floor(Math.min(corner.x, incoming.x, outgoing.x)));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(corner.x, incoming.x, outgoing.x)));
        const minY = Math.max(0, Math.floor(Math.min(corner.y, incoming.y, outgoing.y)));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(corner.y, incoming.y, outgoing.y)));

        for (let yy = minY; yy <= maxY; yy++) {
            for (let xx = minX; xx <= maxX; xx++) {
                if (!protectedPixels[yy * width + xx]) {
                    continue;
                }

                const cellTriangles: FootprintTriangle[] = [
                    [
                        [xx, yy],
                        [xx + 1, yy],
                        [xx + 1, yy + 1],
                    ],
                    [
                        [xx, yy],
                        [xx + 1, yy + 1],
                        [xx, yy + 1],
                    ],
                ];

                if (
                    cellTriangles.some((cellTriangle) =>
                        trianglesOverlap2D(cutTriangle, cellTriangle)
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    };

    for (let start = 0; start < activePixels.length; start++) {
        if (!activePixels[start] || visited[start]) continue;

        const componentCells: number[] = [];
        queue.length = 0;
        queue.push(start);
        visited[start] = 1;

        for (let head = 0; head < queue.length; head++) {
            const cell = queue[head];
            componentCells.push(cell);

            const x = cell % width;
            const y = Math.floor(cell / width);
            const north = cell - width;
            const south = cell + width;
            const west = cell - 1;
            const east = cell + 1;

            if (y > 0 && activePixels[north] && !visited[north]) {
                visited[north] = 1;
                queue.push(north);
            }
            if (y + 1 < height && activePixels[south] && !visited[south]) {
                visited[south] = 1;
                queue.push(south);
            }
            if (x > 0 && activePixels[west] && !visited[west]) {
                visited[west] = 1;
                queue.push(west);
            }
            if (x + 1 < width && activePixels[east] && !visited[east]) {
                visited[east] = 1;
                queue.push(east);
            }

            if ((head & 255) === 0) {
                await maybeYield();
            }
        }

        const componentMask = new Uint8Array(width * height);
        for (const cell of componentCells) {
            componentMask[cell] = 1;
        }
        const pointInsideComponentFootprint = (x: number, y: number) => {
            const epsilon = 1e-5;
            const minX = Math.max(0, Math.floor(x - epsilon));
            const maxX = Math.min(width - 1, Math.floor(x + epsilon));
            const minY = Math.max(0, Math.floor(y - epsilon));
            const maxY = Math.min(height - 1, Math.floor(y + epsilon));

            for (let yy = minY; yy <= maxY; yy++) {
                for (let xx = minX; xx <= maxX; xx++) {
                    if (componentMask[yy * width + xx]) {
                        return true;
                    }
                }
            }

            return false;
        };
        const canCutCornerInsideFootprint = (
            corner: Vector2,
            incoming: Vector2,
            outgoing: Vector2
        ) => {
            if (cutRemovesProtectedFootprint(corner, incoming, outgoing)) {
                return false;
            }

            for (const t of [0.25, 0.5, 0.75]) {
                const x = incoming.x + (outgoing.x - incoming.x) * t;
                const y = incoming.y + (outgoing.y - incoming.y) * t;

                if (!pointInsideComponentFootprint(x, y)) {
                    return false;
                }
            }

            return true;
        };
        const shortcutRemovesProtectedFootprint = (points: Vector2[]) => {
            if (!protectedPixels && protectedFootprint.length === 0) {
                return false;
            }

            const startPoint = points[0];

            for (let i = 1; i + 1 < points.length; i++) {
                const cutTriangle: FootprintTriangle = [
                    [startPoint.x, startPoint.y],
                    [points[i].x, points[i].y],
                    [points[i + 1].x, points[i + 1].y],
                ];

                if (
                    protectedFootprint.some((triangle) => trianglesOverlap2D(cutTriangle, triangle))
                ) {
                    return true;
                }

                if (!protectedPixels) {
                    continue;
                }

                const minX = Math.max(
                    0,
                    Math.floor(Math.min(startPoint.x, points[i].x, points[i + 1].x))
                );
                const maxX = Math.min(
                    width - 1,
                    Math.ceil(Math.max(startPoint.x, points[i].x, points[i + 1].x))
                );
                const minY = Math.max(
                    0,
                    Math.floor(Math.min(startPoint.y, points[i].y, points[i + 1].y))
                );
                const maxY = Math.min(
                    height - 1,
                    Math.ceil(Math.max(startPoint.y, points[i].y, points[i + 1].y))
                );

                for (let yy = minY; yy <= maxY; yy++) {
                    for (let xx = minX; xx <= maxX; xx++) {
                        if (!protectedPixels[yy * width + xx]) {
                            continue;
                        }

                        const cellTriangles: FootprintTriangle[] = [
                            [
                                [xx, yy],
                                [xx + 1, yy],
                                [xx + 1, yy + 1],
                            ],
                            [
                                [xx, yy],
                                [xx + 1, yy + 1],
                                [xx, yy + 1],
                            ],
                        ];

                        if (
                            cellTriangles.some((cellTriangle) =>
                                trianglesOverlap2D(cutTriangle, cellTriangle)
                            )
                        ) {
                            return true;
                        }
                    }
                }
            }

            return false;
        };
        const canUseShortcutInsideFootprint = (points: Vector2[]) => {
            if (shortcutRemovesProtectedFootprint(points)) {
                return false;
            }

            const startPoint = points[0];
            const endPoint = points[points.length - 1];
            for (const t of [0.2, 0.4, 0.6, 0.8]) {
                const x = startPoint.x + (endPoint.x - startPoint.x) * t;
                const y = startPoint.y + (endPoint.y - startPoint.y) * t;

                if (!pointInsideComponentFootprint(x, y)) {
                    return false;
                }
            }

            return true;
        };

        const loops = traceComponentLoops(componentCells, activePixels, width, height)
            .filter((loop) => loop.length >= 3)
            .sort((a, b) => Math.abs(ShapeUtils.area(b)) - Math.abs(ShapeUtils.area(a)));

        if (loops.length === 0) {
            await maybeYield();
            continue;
        }

        const exactOuter = loops[0].map((point) => point.clone());
        if (!ShapeUtils.isClockWise(exactOuter)) {
            exactOuter.reverse();
        }

        const exactHoles = loops.slice(1).map((loop) => {
            const normalized = loop.map((point) => point.clone());
            if (ShapeUtils.isClockWise(normalized)) {
                normalized.reverse();
            }
            return normalized;
        });

        const smoothOuter = smoothLoop(
            exactOuter,
            canCutCornerInsideFootprint,
            canUseShortcutInsideFootprint,
            allowPartialProtectedCuts
        );
        const smoothHoles = exactHoles.map((hole) =>
            smoothLoop(
                hole,
                canCutCornerInsideFootprint,
                canUseShortcutInsideFootprint,
                allowPartialProtectedCuts
            )
        );

        if (!ShapeUtils.isClockWise(smoothOuter)) {
            smoothOuter.reverse();
        }
        for (const hole of smoothHoles) {
            if (ShapeUtils.isClockWise(hole)) {
                hole.reverse();
            }
        }

        const smoothLoops = [smoothOuter, ...smoothHoles].filter((loop) => loop.length >= 3);
        const exactLoops = [exactOuter, ...exactHoles].filter((loop) => loop.length >= 3);
        let topLoops = smoothLoops;
        if (topLoops.length === 0) {
            await maybeYield();
            continue;
        }

        let { faces } = triangulateLoops(topLoops);

        if (faces.length === 0 || hasDegenerateCapFaces(topLoops, faces, pixelSize)) {
            topLoops = exactLoops;
            faces = triangulateLoops(topLoops).faces;
        }

        if (faces.length === 0 || hasDegenerateCapFaces(topLoops, faces, pixelSize)) {
            return generateGreedyMesh(
                activePixels,
                width,
                height,
                thickness,
                zOffset,
                pixelSize,
                heightScale,
                options
            );
        }

        const topVertices = topLoops.flat();
        const topVertexCount = topVertices.length;
        const baseVert = positions.length / 3;

        for (const point of topVertices) {
            positions.push(point.x * pixelSize, point.y * pixelSize, zTop);
        }
        for (const point of topVertices) {
            positions.push(point.x * pixelSize, point.y * pixelSize, zBottom);
        }

        for (const [a, b, c] of faces) {
            indices.push(baseVert + a, baseVert + b, baseVert + c);
            indices.push(
                baseVert + topVertexCount + a,
                baseVert + topVertexCount + c,
                baseVert + topVertexCount + b
            );
        }

        let loopOffset = 0;
        for (let loopIndex = 0; loopIndex < topLoops.length; loopIndex++) {
            const loop = topLoops[loopIndex];
            addExtrudedLoopWalls(
                indices,
                baseVert,
                topVertexCount,
                loopOffset,
                loop,
                loopIndex > 0
            );
            loopOffset += loop.length;
        }

        await maybeYield();
    }

    return {
        positions: new Float32Array(positions),
        indices,
    };
}

interface MeshYieldOptions {
    yieldIntervalMs?: number;
    onYield?: () => Promise<void>;
    protectedPixels?: Uint8Array | Uint8ClampedArray | boolean[];
    protectedFootprint?: FootprintTriangle[];
    allowPartialProtectedCuts?: boolean;
}

/**
 * Generates an optimized 3D mesh for a layer of voxel-like pixels using Maximal Rectangle Greedy Meshing.
 * This approach minimizes the triangle count by merging active regions into large rectangles.
 *
 * T-Junction Prevention: Walls are generated in a separate global pass to ensure all wall
 * vertices align properly, preventing non-manifold edges that cause slicer artifacts.
 *
 * Coordinate system: X+ right, Y+ down (image coords), Z+ up
 * All faces use CCW winding when viewed from outside (right-hand rule for outward normals)
 *
 * @param activePixels Row-major array where >0 indicates presence of a pixel
 * @param width Width of the pixel grid
 * @param height Height of the pixel grid
 * @param thickness Thickness of the layer (Z height)
 * @param zOffset Base Z height of the layer
 * @param pixelSize XY scaling factor (usually mm per pixel)
 * @param heightScale Z scaling factor
 */
export async function generateGreedyMesh(
    activePixels: Uint8Array | Uint8ClampedArray | boolean[],
    width: number,
    height: number,
    thickness: number,
    zOffset: number,
    pixelSize: number,
    heightScale: number,
    options?: MeshYieldOptions
): Promise<MeshData> {
    const positions: number[] = [];
    const indices: number[] = [];
    let vertCount = 0;

    const yieldIntervalMs = options?.yieldIntervalMs ?? 8;
    const yieldControl =
        options?.onYield ??
        (() =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
            }));
    let lastYield = performance.now();
    const maybeYield = async () => {
        const now = performance.now();
        if (now - lastYield >= yieldIntervalMs) {
            await yieldControl();
            lastYield = performance.now();
        }
    };

    // Vertex welding maps: key = y * (width + 1) + x
    const topMap = new Map<number, number>();
    const bottomMap = new Map<number, number>();
    const stride = width + 1;

    const scaledThickness = thickness * heightScale;
    const scaledZOffset = zOffset * heightScale;
    const zBottom = scaledZOffset;
    const zTop = scaledZOffset + scaledThickness;

    // --- Helper: Vertex Welding ---
    const getOrAddVertex = (x: number, y: number, isTop: boolean): number => {
        const key = y * stride + x;
        const map = isTop ? topMap : bottomMap;
        let idx = map.get(key);
        if (idx !== undefined) return idx;

        idx = vertCount++;
        map.set(key, idx);
        positions.push(x * pixelSize, y * pixelSize, isTop ? zTop : zBottom);
        return idx;
    };

    // Add a quad with CCW winding (v0 -> v1 -> v2 -> v3 should be CCW when viewed from outside)
    const addQuadCCW = (v0: number, v1: number, v2: number, v3: number) => {
        // Two triangles: (v0, v1, v2) and (v0, v2, v3)
        indices.push(v0, v1, v2);
        indices.push(v0, v2, v3);
    };

    // --- Collect all greedy rectangles first ---
    interface Rect {
        x: number;
        y: number;
        w: number;
        h: number;
    }
    const rectangles: Rect[] = [];
    const visited = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (activePixels[idx] && !visited[idx]) {
                // 1. Find max width
                let w = 1;
                while (
                    x + w < width &&
                    activePixels[y * width + (x + w)] &&
                    !visited[y * width + (x + w)]
                ) {
                    w++;
                }

                // 2. Find max height for this width
                let h = 1;
                let canExpand = true;
                while (y + h < height && canExpand) {
                    for (let k = 0; k < w; k++) {
                        const nextIdx = (y + h) * width + (x + k);
                        if (!activePixels[nextIdx] || visited[nextIdx]) {
                            canExpand = false;
                            break;
                        }
                    }
                    if (canExpand) h++;
                }

                // 3. Mark visited
                for (let dy = 0; dy < h; dy++) {
                    const rowOff = (y + dy) * width;
                    for (let dx = 0; dx < w; dx++) {
                        visited[rowOff + x + dx] = 1;
                    }
                }

                rectangles.push({ x, y, w, h });
            }
        }
        await maybeYield();
    }

    // --- Build global vertex requirement sets for walls ---
    // These track all x-coordinates needed at each y for horizontal edges
    // and all y-coordinates needed at each x for vertical edges
    // This ensures walls are subdivided at T-junction points

    // For north/south walls: verticesAtY[y] = Set of x-coordinates where vertices exist
    const verticesAtY = new Map<number, Set<number>>();
    // For west/east walls: verticesAtX[x] = Set of y-coordinates where vertices exist
    const verticesAtX = new Map<number, Set<number>>();

    // First pass: collect all rectangle corner vertices
    for (const rect of rectangles) {
        const { x, y, w, h } = rect;

        // Add vertices at all four corners for each y-coordinate
        for (const yCoord of [y, y + h]) {
            if (!verticesAtY.has(yCoord)) verticesAtY.set(yCoord, new Set());
            verticesAtY.get(yCoord)!.add(x);
            verticesAtY.get(yCoord)!.add(x + w);
        }

        // Add vertices at all four corners for each x-coordinate
        for (const xCoord of [x, x + w]) {
            if (!verticesAtX.has(xCoord)) verticesAtX.set(xCoord, new Set());
            verticesAtX.get(xCoord)!.add(y);
            verticesAtX.get(xCoord)!.add(y + h);
        }

        await maybeYield();
    }

    // --- Generate Top and Bottom Faces for each rectangle ---

    // Pre-sort vertices for fast range queries
    const sortedVerticesAtY = new Map<number, number[]>();
    for (const [y, set] of verticesAtY) {
        sortedVerticesAtY.set(
            y,
            Array.from(set).sort((a, b) => a - b)
        );
        await maybeYield();
    }
    const sortedVerticesAtX = new Map<number, number[]>();
    for (const [x, set] of verticesAtX) {
        sortedVerticesAtX.set(
            x,
            Array.from(set).sort((a, b) => a - b)
        );
        await maybeYield();
    }

    const lowerBound = (arr: number[], target: number) => {
        let lo = 0;
        let hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };

    const upperBound = (arr: number[], target: number) => {
        let lo = 0;
        let hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };

    for (const rect of rectangles) {
        const { x, y, w, h } = rect;

        const topLine = sortedVerticesAtY.get(y)!;
        const rightLine = sortedVerticesAtX.get(x + w)!;
        const bottomLine = sortedVerticesAtY.get(y + h)!;
        const leftLine = sortedVerticesAtX.get(x)!;

        const topLo = lowerBound(topLine, x);
        const topHi = upperBound(topLine, x + w);
        const rightLo = lowerBound(rightLine, y);
        const rightHi = upperBound(rightLine, y + h);
        const bottomLo = lowerBound(bottomLine, x);
        const bottomHi = upperBound(bottomLine, x + w);
        const leftLo = lowerBound(leftLine, y);
        const leftHi = upperBound(leftLine, y + h);

        const boundary: Array<[number, number]> = [];

        // Top edge: x -> x+w (exclude last point)
        for (let i = topLo; i < topHi - 1; i++) {
            boundary.push([topLine[i], y]);
        }
        // Right edge: y -> y+h (exclude last point)
        for (let i = rightLo; i < rightHi - 1; i++) {
            boundary.push([x + w, rightLine[i]]);
        }
        // Bottom edge: x+w -> x (exclude last point)
        for (let i = bottomHi - 1; i > bottomLo; i--) {
            boundary.push([bottomLine[i], y + h]);
        }
        // Left edge: y+h -> y (exclude last point)
        for (let i = leftHi - 1; i > leftLo; i--) {
            boundary.push([x, leftLine[i]]);
        }

        if (boundary.length < 3) continue;

        const topLoop: number[] = new Array(boundary.length);
        const bottomLoop: number[] = new Array(boundary.length);
        for (let i = 0; i < boundary.length; i++) {
            const [vx, vy] = boundary[i];
            topLoop[i] = getOrAddVertex(vx, vy, true);
            bottomLoop[i] = getOrAddVertex(vx, vy, false);
        }

        const facePoints = boundary.map(([vx, vy]) => new Vector2(vx, vy));
        const faces = ShapeUtils.triangulateShape(facePoints, []);

        for (const [a, b, c] of faces) {
            indices.push(topLoop[a], topLoop[b], topLoop[c]);
            indices.push(bottomLoop[a], bottomLoop[c], bottomLoop[b]);
        }

        await maybeYield();
    }

    // --- Global Wall Generation ---
    // Collect all wall segments at pixel granularity, then merge respecting all vertices

    // North walls (facing -Y): edges at y where pixel[y] is active but pixel[y-1] is not
    // Map: y -> sorted list of x-coordinates needing north walls
    const northWalls = new Map<number, number[]>();
    // South walls (facing +Y): edges at y where pixel[y-1] is active but pixel[y] is not
    const southWalls = new Map<number, number[]>();
    // West walls (facing -X): edges at x where pixel[x] is active but pixel[x-1] is not
    const westWalls = new Map<number, number[]>();
    // East walls (facing +X): edges at x where pixel[x-1] is active but pixel[x] is not
    const eastWalls = new Map<number, number[]>();

    // Scan for all wall edges
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!activePixels[y * width + x]) continue;

            // North wall needed if no neighbor above
            if (y === 0 || !activePixels[(y - 1) * width + x]) {
                if (!northWalls.has(y)) northWalls.set(y, []);
                northWalls.get(y)!.push(x);
            }

            // South wall needed if no neighbor below
            if (y === height - 1 || !activePixels[(y + 1) * width + x]) {
                const wallY = y + 1;
                if (!southWalls.has(wallY)) southWalls.set(wallY, []);
                southWalls.get(wallY)!.push(x);
            }

            // West wall needed if no neighbor to the left
            if (x === 0 || !activePixels[y * width + (x - 1)]) {
                if (!westWalls.has(x)) westWalls.set(x, []);
                westWalls.get(x)!.push(y);
            }

            // East wall needed if no neighbor to the right
            if (x === width - 1 || !activePixels[y * width + (x + 1)]) {
                const wallX = x + 1;
                if (!eastWalls.has(wallX)) eastWalls.set(wallX, []);
                eastWalls.get(wallX)!.push(y);
            }
        }

        await maybeYield();
    }

    // Helper: merge wall segments respecting vertex positions
    const mergeAndEmitHorizontalWalls = (
        wallMap: Map<number, number[]>,
        yCoord: number,
        isSouth: boolean
    ) => {
        const xCoords = wallMap.get(yCoord);
        if (!xCoords || xCoords.length === 0) return;

        xCoords.sort((a, b) => a - b);

        // Get all x-coordinates where we must have vertices at this y
        const requiredVertices = verticesAtY.get(yCoord) || new Set<number>();

        let runStart = xCoords[0];
        let runEnd = runStart + 1;

        for (let i = 1; i <= xCoords.length; i++) {
            const nextX = i < xCoords.length ? xCoords[i] : -1;
            const isContiguous = nextX === runEnd;
            const mustSplit = requiredVertices.has(runEnd) && isContiguous;

            if (!isContiguous || mustSplit || i === xCoords.length) {
                // Emit wall segment from runStart to runEnd
                if (isSouth) {
                    // South wall (facing +Y)
                    const wTL = getOrAddVertex(runStart, yCoord, true);
                    const wTR = getOrAddVertex(runEnd, yCoord, true);
                    const wBR = getOrAddVertex(runEnd, yCoord, false);
                    const wBL = getOrAddVertex(runStart, yCoord, false);
                    addQuadCCW(wBL, wTL, wTR, wBR);
                } else {
                    // North wall (facing -Y)
                    const wTL = getOrAddVertex(runStart, yCoord, true);
                    const wTR = getOrAddVertex(runEnd, yCoord, true);
                    const wBR = getOrAddVertex(runEnd, yCoord, false);
                    const wBL = getOrAddVertex(runStart, yCoord, false);
                    addQuadCCW(wBR, wTR, wTL, wBL);
                }

                if (mustSplit && isContiguous) {
                    // Continue from the split point
                    runStart = runEnd;
                    runEnd = runStart + 1;
                } else if (i < xCoords.length) {
                    runStart = nextX;
                    runEnd = runStart + 1;
                }
            } else {
                runEnd = nextX + 1;
            }
        }
    };

    const mergeAndEmitVerticalWalls = (
        wallMap: Map<number, number[]>,
        xCoord: number,
        isEast: boolean
    ) => {
        const yCoords = wallMap.get(xCoord);
        if (!yCoords || yCoords.length === 0) return;

        yCoords.sort((a, b) => a - b);

        // Get all y-coordinates where we must have vertices at this x
        const requiredVertices = verticesAtX.get(xCoord) || new Set<number>();

        let runStart = yCoords[0];
        let runEnd = runStart + 1;

        for (let i = 1; i <= yCoords.length; i++) {
            const nextY = i < yCoords.length ? yCoords[i] : -1;
            const isContiguous = nextY === runEnd;
            const mustSplit = requiredVertices.has(runEnd) && isContiguous;

            if (!isContiguous || mustSplit || i === yCoords.length) {
                // Emit wall segment from runStart to runEnd
                if (isEast) {
                    // East wall (facing +X)
                    const wTL = getOrAddVertex(xCoord, runStart, true);
                    const wTR = getOrAddVertex(xCoord, runEnd, true);
                    const wBR = getOrAddVertex(xCoord, runEnd, false);
                    const wBL = getOrAddVertex(xCoord, runStart, false);
                    addQuadCCW(wBR, wTR, wTL, wBL);
                } else {
                    // West wall (facing -X)
                    const wTL = getOrAddVertex(xCoord, runStart, true);
                    const wTR = getOrAddVertex(xCoord, runEnd, true);
                    const wBR = getOrAddVertex(xCoord, runEnd, false);
                    const wBL = getOrAddVertex(xCoord, runStart, false);
                    addQuadCCW(wBL, wTL, wTR, wBR);
                }

                if (mustSplit && isContiguous) {
                    // Continue from the split point
                    runStart = runEnd;
                    runEnd = runStart + 1;
                } else if (i < yCoords.length) {
                    runStart = nextY;
                    runEnd = runStart + 1;
                }
            } else {
                runEnd = nextY + 1;
            }
        }
    };

    // Emit all walls
    for (const [y] of northWalls) {
        mergeAndEmitHorizontalWalls(northWalls, y, false);
        await maybeYield();
    }
    for (const [y] of southWalls) {
        mergeAndEmitHorizontalWalls(southWalls, y, true);
        await maybeYield();
    }
    for (const [x] of westWalls) {
        mergeAndEmitVerticalWalls(westWalls, x, false);
        await maybeYield();
    }
    for (const [x] of eastWalls) {
        mergeAndEmitVerticalWalls(eastWalls, x, true);
        await maybeYield();
    }

    return {
        positions: new Float32Array(positions),
        indices: indices,
    };
}
