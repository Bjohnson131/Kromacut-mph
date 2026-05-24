import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { generateGreedyMesh, generateSmoothMesh, type MeshData } from '../src/lib/meshing.ts';
import {
    largeIssueFixturePath,
    logoFixturePath,
    maskFromJpegLuminance,
    maskFromPngAlpha,
    type RasterMask,
} from './imageFixtures.ts';
import { inspectMeshIntegrity, type MeshIntegrityReport } from './meshDiagnostics.ts';

type MeshGenerator = typeof generateGreedyMesh;

interface RoundedExportTopologyReport {
    boundaryEdgeCount: number;
    overusedEdgeCount: number;
    skippedTriangleCount: number;
}

const noYieldOptions = {
    yieldIntervalMs: Infinity,
    onYield: async () => undefined,
};

const meshers: Array<{ name: string; generate: MeshGenerator }> = [
    { name: 'greedy', generate: generateGreedyMesh },
    { name: 'smooth', generate: generateSmoothMesh },
];

function maskFromRows(rows: string[]): RasterMask {
    const width = rows[0].length;
    const height = rows.length;
    const activePixels = new Uint8Array(width * height);
    let activeCount = 0;

    for (let y = 0; y < height; y++) {
        assert.equal(rows[y].length, width, 'All mask rows must be the same width');

        for (let x = 0; x < width; x++) {
            if (rows[y][x] === '#') {
                activePixels[y * width + x] = 1;
                activeCount++;
            }
        }
    }

    return { activePixels, width, height, activeCount };
}

function reportForMessage(report: MeshIntegrityReport) {
    return JSON.stringify(
        {
            vertexCount: report.vertexCount,
            triangleCount: report.triangleCount,
            invalidPositionCount: report.invalidPositionCount,
            invalidIndexCount: report.invalidIndexCount,
            degenerateTriangleCount: report.degenerateTriangleCount,
            duplicateTriangleCount: report.duplicateTriangleCount,
            boundaryEdgeCount: report.boundaryEdgeCount,
            nonManifoldEdgeCount: report.nonManifoldEdgeCount,
            inconsistentWindingEdgeCount: report.inconsistentWindingEdgeCount,
            signedVolume: report.signedVolume,
            bounds: report.bounds,
        },
        null,
        2
    );
}

function assertHealthyMesh(label: string, mesh: MeshData) {
    const report = inspectMeshIntegrity(mesh);

    assert.ok(report.vertexCount > 0, `${label} should contain vertices`);
    assert.ok(report.triangleCount > 0, `${label} should contain triangles`);
    assert.equal(report.isValid, true, `${label} integrity failed:\n${reportForMessage(report)}`);

    return report;
}

function inspectRoundedExportTopology(mesh: MeshData): RoundedExportTopologyReport {
    const vertexMap = new Map<string, number>();
    const exportVertices: Array<[number, number, number]> = [];
    const edges = new Map<string, number>();
    let skippedTriangleCount = 0;

    const getExportVertex = (sourceIndex: number) => {
        const offset = sourceIndex * 3;
        const point = [
            Math.round(mesh.positions[offset] * 100000) / 100000,
            Math.round(mesh.positions[offset + 1] * 100000) / 100000,
            Math.round(mesh.positions[offset + 2] * 100000) / 100000,
        ] as [number, number, number];
        const key = point.join(',');
        const existing = vertexMap.get(key);

        if (existing !== undefined) {
            return existing;
        }

        const index = exportVertices.length;
        vertexMap.set(key, index);
        exportVertices.push(point);
        return index;
    };

    const addEdge = (a: number, b: number) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
    };

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const a = getExportVertex(mesh.indices[i]);
        const b = getExportVertex(mesh.indices[i + 1]);
        const c = getExportVertex(mesh.indices[i + 2]);
        const pointA = exportVertices[a];
        const pointB = exportVertices[b];
        const pointC = exportVertices[c];
        const abx = pointB[0] - pointA[0];
        const aby = pointB[1] - pointA[1];
        const abz = pointB[2] - pointA[2];
        const acx = pointC[0] - pointA[0];
        const acy = pointC[1] - pointA[1];
        const acz = pointC[2] - pointA[2];
        const crossX = aby * acz - abz * acy;
        const crossY = abz * acx - abx * acz;
        const crossZ = abx * acy - aby * acx;

        if (a === b || b === c || a === c || (crossX === 0 && crossY === 0 && crossZ === 0)) {
            skippedTriangleCount++;
            continue;
        }

        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
    }

    let boundaryEdgeCount = 0;
    let overusedEdgeCount = 0;

    for (const count of edges.values()) {
        if (count === 1) {
            boundaryEdgeCount++;
        } else if (count > 2) {
            overusedEdgeCount++;
        }
    }

    return {
        boundaryEdgeCount,
        overusedEdgeCount,
        skippedTriangleCount,
    };
}

function hasFractionalXY(mesh: MeshData, pixelSize: number) {
    for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
        const x = mesh.positions[i] / pixelSize;
        const y = mesh.positions[i + 1] / pixelSize;

        if (Math.abs(x - Math.round(x)) > 1e-4 || Math.abs(y - Math.round(y)) > 1e-4) {
            return true;
        }
    }

    return false;
}

function pointInsideMask(mask: RasterMask, x: number, y: number) {
    const epsilon = 1e-5;
    const minX = Math.max(0, Math.floor(x - epsilon));
    const maxX = Math.min(mask.width - 1, Math.floor(x + epsilon));
    const minY = Math.max(0, Math.floor(y - epsilon));
    const maxY = Math.min(mask.height - 1, Math.floor(y + epsilon));

    for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
            if (mask.activePixels[yy * mask.width + xx]) {
                return true;
            }
        }
    }

    return false;
}

function countCapCentroidsOutsideMask(mesh: MeshData, mask: RasterMask, pixelSize: number) {
    let outsideCount = 0;

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        const a = mesh.indices[i] * 3;
        const b = mesh.indices[i + 1] * 3;
        const c = mesh.indices[i + 2] * 3;
        const az = mesh.positions[a + 2];
        const bz = mesh.positions[b + 2];
        const cz = mesh.positions[c + 2];

        if (Math.abs(az - bz) > 1e-6 || Math.abs(bz - cz) > 1e-6) {
            continue;
        }

        const cx =
            (mesh.positions[a] / pixelSize +
                mesh.positions[b] / pixelSize +
                mesh.positions[c] / pixelSize) /
            3;
        const cy =
            (mesh.positions[a + 1] / pixelSize +
                mesh.positions[b + 1] / pixelSize +
                mesh.positions[c + 1] / pixelSize) /
            3;

        if (!pointInsideMask(mask, cx, cy)) {
            outsideCount++;
        }
    }

    return outsideCount;
}

function assertZBounds(
    label: string,
    report: MeshIntegrityReport,
    thickness: number,
    zOffset: number,
    heightScale: number
) {
    const bounds = report.bounds;
    assert.ok(bounds, `${label} should have bounds`);

    const expectedMinZ = zOffset * heightScale;
    const expectedMaxZ = (zOffset + thickness) * heightScale;

    assert.ok(
        Math.abs(bounds.minZ - expectedMinZ) <= 1e-6,
        `${label} minZ expected ${expectedMinZ}, got ${bounds.minZ}`
    );
    assert.ok(
        Math.abs(bounds.maxZ - expectedMaxZ) <= 1e-6,
        `${label} maxZ expected ${expectedMaxZ}, got ${bounds.maxZ}`
    );
}

test('meshers produce valid closed meshes for topology-heavy masks', async (t: TestContext) => {
    const cases = [
        {
            name: 'single pixel',
            mask: maskFromRows(['#']),
        },
        {
            name: 'stair-step T-junction regression',
            mask: maskFromRows(['#..', '##.', '.##', '..#']),
        },
        {
            name: 'ring with a hole',
            mask: maskFromRows(['#####', '#...#', '#...#', '#...#', '#####']),
        },
        {
            name: 'separate island and concave block',
            mask: maskFromRows(['##...##', '##...##', '.......', '..###..', '..#....', '..####.']),
        },
        {
            name: 'repeated diagonal islands',
            mask: maskFromRows(['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#']),
        },
    ];

    for (const { name: caseName, mask } of cases) {
        for (const { name: mesherName, generate } of meshers) {
            await t.test(`${mesherName}: ${caseName}`, async () => {
                const mesh = await generate(
                    mask.activePixels,
                    mask.width,
                    mask.height,
                    0.24,
                    0,
                    0.5,
                    1,
                    noYieldOptions
                );

                assertHealthyMesh(`${mesherName} ${caseName}`, mesh);
            });
        }
    }
});

test('1024px logo fixture mask stays slicer-safe across meshers and layer settings', async (t: TestContext) => {
    const logoMask = maskFromPngAlpha(logoFixturePath, 96);
    assert.ok(logoMask.activeCount > 0, 'default logo mask should contain active pixels');

    const settings = [
        { thickness: 0.08, zOffset: 0, pixelSize: 0.18, heightScale: 1 },
        { thickness: 0.28, zOffset: 0.2, pixelSize: 0.42, heightScale: 1.5 },
    ];

    for (const setting of settings) {
        for (const { name: mesherName, generate } of meshers) {
            await t.test(`${mesherName}: ${JSON.stringify(setting)}`, async () => {
                const mesh = await generate(
                    logoMask.activePixels,
                    logoMask.width,
                    logoMask.height,
                    setting.thickness,
                    setting.zOffset,
                    setting.pixelSize,
                    setting.heightScale,
                    noYieldOptions
                );
                const report = assertHealthyMesh(`${mesherName} logo`, mesh);

                assertZBounds(
                    `${mesherName} logo`,
                    report,
                    setting.thickness,
                    setting.zOffset,
                    setting.heightScale
                );
            });
        }
    }
});

test('large issue JPG fixture masks stay slicer-safe across meshers', async (t: TestContext) => {
    const fixtureMasks = [
        { name: 'midtone threshold', mask: maskFromJpegLuminance(largeIssueFixturePath, 128, 144) },
        {
            name: 'upper-midtone threshold',
            mask: maskFromJpegLuminance(largeIssueFixturePath, 128, 176),
        },
        {
            name: 'highlight threshold',
            mask: maskFromJpegLuminance(largeIssueFixturePath, 128, 192),
        },
    ];

    for (const { name: fixtureName, mask } of fixtureMasks) {
        assert.ok(mask.activeCount > 0, `${fixtureName} should contain active pixels`);
        assert.ok(
            mask.activeCount < mask.width * mask.height,
            `${fixtureName} should not collapse to a full mask`
        );

        for (const { name: mesherName, generate } of meshers) {
            await t.test(`${mesherName}: ${fixtureName}`, async () => {
                const mesh = await generate(
                    mask.activePixels,
                    mask.width,
                    mask.height,
                    0.12,
                    0.04,
                    0.32,
                    1,
                    noYieldOptions
                );
                const report = assertHealthyMesh(`${mesherName} large JPG ${fixtureName}`, mesh);

                assertZBounds(`${mesherName} large JPG ${fixtureName}`, report, 0.12, 0.04, 1);
                assert.ok(
                    report.triangleCount < 200_000,
                    `${mesherName} large JPG ${fixtureName} should stay within a practical test mesh size`
                );
            });
        }
    }
});

test('smooth 1024px logo stays slicer-safe after 3MF export rounding', async () => {
    const logoMask = maskFromPngAlpha(logoFixturePath, 128);
    const mesh = await generateSmoothMesh(
        logoMask.activePixels,
        logoMask.width,
        logoMask.height,
        0.08,
        0,
        0.4,
        1,
        noYieldOptions
    );

    assertHealthyMesh('smooth export-rounded logo source mesh', mesh);
    assert.equal(hasFractionalXY(mesh, 0.4), true, 'smooth logo should contain smoothed vertices');

    const report = inspectRoundedExportTopology(mesh);
    assert.deepEqual(report, {
        boundaryEdgeCount: 0,
        overusedEdgeCount: 0,
        skippedTriangleCount: 0,
    });
});

test('smooth caps do not create overhangs outside the source footprint', async () => {
    const mask = maskFromRows(['######', '#....#', '#.##.#', '#.##.#', '#....#', '######']);
    const mesh = await generateSmoothMesh(
        mask.activePixels,
        mask.width,
        mask.height,
        0.08,
        0,
        0.4,
        1,
        noYieldOptions
    );

    assertHealthyMesh('smooth concave footprint mesh', mesh);
    assert.equal(hasFractionalXY(mesh, 0.4), true, 'concave footprint should still be smoothed');
    assert.equal(countCapCentroidsOutsideMask(mesh, mask, 0.4), 0);
});

test('smooth metrics report exact-loop fallback state', async () => {
    const smoothMask = maskFromRows(['##', '##']);
    const smoothMesh = await generateSmoothMesh(
        smoothMask.activePixels,
        smoothMask.width,
        smoothMask.height,
        0.08,
        0,
        0.4,
        1,
        noYieldOptions
    );

    assert.equal(smoothMesh.metrics?.mesher, 'smooth');
    assert.equal(smoothMesh.metrics?.exactLoopFallbackCount, 0);
    assert.equal(smoothMesh.metrics?.smoothFallbackReason, undefined);

    const exportRoundedMesh = await generateSmoothMesh(
        smoothMask.activePixels,
        smoothMask.width,
        smoothMask.height,
        0.08,
        0,
        0.00005,
        1,
        noYieldOptions
    );

    assert.equal(exportRoundedMesh.metrics?.mesher, 'smooth');
    assert.equal(exportRoundedMesh.metrics?.exactLoopFallbackCount, 1);
    assert.equal(exportRoundedMesh.metrics?.smoothFallbackReason, undefined);
});

test('smooth metrics report greedy fallback reason', async () => {
    const mask = maskFromRows(['##', '##']);
    const mesh = await generateSmoothMesh(
        mask.activePixels,
        mask.width,
        mask.height,
        0.08,
        0,
        0.000001,
        1,
        noYieldOptions
    );

    assert.equal(mesh.metrics?.mesher, 'greedy');
    assert.equal(mesh.metrics?.exactLoopFallbackCount, 1);
    assert.equal(mesh.metrics?.smoothFallbackReason, 'degenerate-exact-cap-faces');
});

test('yield options do not compromise mesh integrity', async () => {
    const mask = maskFromRows(['####.', '#..#.', '####.', '..###', '..#.#', '..###']);
    let yieldCount = 0;

    const mesh = await generateGreedyMesh(
        mask.activePixels,
        mask.width,
        mask.height,
        0.2,
        0,
        0.35,
        1,
        {
            yieldIntervalMs: -1,
            onYield: async () => {
                yieldCount++;
            },
        }
    );

    assert.ok(yieldCount > 0, 'expected the mesher to call the provided yield hook');
    assertHealthyMesh('yielding greedy mesh', mesh);
});

test('mesh diagnostics detect inverted winding', async () => {
    const mask = maskFromRows(['##', '##']);
    const mesh = await generateGreedyMesh(
        mask.activePixels,
        mask.width,
        mask.height,
        0.2,
        0,
        1,
        1,
        noYieldOptions
    );

    const inverted: MeshData = {
        positions: mesh.positions,
        indices: [],
    };

    for (let i = 0; i < mesh.indices.length; i += 3) {
        inverted.indices.push(mesh.indices[i], mesh.indices[i + 2], mesh.indices[i + 1]);
    }

    const report = inspectMeshIntegrity(inverted);
    assert.equal(report.isWatertight, true, reportForMessage(report));
    assert.equal(report.isConsistentlyOriented, true, reportForMessage(report));
    assert.equal(report.isOutwardFacing, false, reportForMessage(report));
    assert.ok(report.signedVolume < 0, reportForMessage(report));
});
