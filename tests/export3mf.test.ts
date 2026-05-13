import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import * as THREE from 'three';
import { createServer } from 'vite';
import { generateSmoothMesh, type MeshData } from '../src/lib/meshing.ts';
import {
    largeIssueFixturePath,
    logoFixturePath,
    maskFromJpegLuminance,
    maskFromPngAlpha,
} from './imageFixtures.ts';

type Export3mfModule = typeof import('../src/lib/export3mf.ts');
type Export3MFOptions = Parameters<Export3mfModule['exportObjectTo3MFBlob']>[1];

interface ExportedMeshObject {
    id: string;
    name: string;
    vertexCount: number;
    triangleCount: number;
    topology: RawTopologyReport;
}

interface RawTopologyReport {
    boundaryEdgeCount: number;
    overusedEdgeCount: number;
    badEdgeCount: number;
}

interface RasterMask {
    activePixels: Uint8Array;
    width: number;
    height: number;
}

let export3mfModule: Promise<Export3mfModule> | null = null;

class NodeFileReader {
    error: Error | null = null;
    onerror: ((event: { target: NodeFileReader }) => void) | null = null;
    onload: ((event: { target: NodeFileReader }) => void) | null = null;
    result: ArrayBuffer | null = null;

    readAsArrayBuffer(blob: Blob) {
        void blob
            .arrayBuffer()
            .then((buffer) => {
                this.result = buffer;
                this.onload?.({ target: this });
            })
            .catch((error: unknown) => {
                this.error = error instanceof Error ? error : new Error(String(error));
                this.onerror?.({ target: this });
            });
    }
}

function installFileReaderPolyfill() {
    if (typeof globalThis.FileReader === 'undefined') {
        globalThis.FileReader = NodeFileReader as unknown as typeof FileReader;
    }
}

async function loadExport3mfModule(): Promise<Export3mfModule> {
    export3mfModule ??= (async () => {
        const server = await createServer({
            appType: 'custom',
            cacheDir: 'dist/.vite-test-cache',
            configFile: false,
            logLevel: 'error',
            optimizeDeps: {
                noDiscovery: true,
            },
            root: process.cwd(),
            server: {
                hmr: false,
                middlewareMode: true,
            },
        });

        try {
            return (await server.ssrLoadModule('/src/lib/export3mf.ts')) as Export3mfModule;
        } finally {
            await server.close();
        }
    })();

    return export3mfModule;
}

function createSharedCubeGeometry() {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
            [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
            3
        )
    );

    geometry.setIndex([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
        0, 4, 3, 4, 7,
    ]);

    return geometry;
}

function createLayerMesh(geometry: THREE.BufferGeometry, color: number) {
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
}

function createMeshDataLayer(mesh: MeshData, color: number) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices);

    return createLayerMesh(geometry, color);
}

function maskFromRows(rows: string[]): RasterMask {
    const width = rows[0]?.length ?? 0;
    const height = rows.length;
    const activePixels = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rows[y][x] === '#') {
                activePixels[y * width + x] = 1;
            }
        }
    }

    return { activePixels, width, height };
}

async function buildSmoothLayer(
    mask: RasterMask,
    thickness: number,
    zOffset: number,
    pixelSize: number
) {
    return await generateSmoothMesh(
        mask.activePixels,
        mask.width,
        mask.height,
        thickness,
        zOffset,
        pixelSize,
        1,
        { yieldIntervalMs: Infinity, onYield: async () => undefined }
    );
}

function getAttribute(source: string, name: string) {
    const match = new RegExp(`${name}="([^"]*)"`).exec(source);
    return match?.[1] ?? '';
}

function addEdge(edges: Map<string, number>, a: number, b: number) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
}

function inspectRawTopology(triangles: Array<[number, number, number]>): RawTopologyReport {
    const edges = new Map<string, number>();

    for (const [a, b, c] of triangles) {
        addEdge(edges, a, b);
        addEdge(edges, b, c);
        addEdge(edges, c, a);
    }

    let boundaryEdgeCount = 0;
    let overusedEdgeCount = 0;
    let badEdgeCount = 0;

    for (const count of edges.values()) {
        if (count !== 2) {
            badEdgeCount++;
        }
        if (count === 1) {
            boundaryEdgeCount++;
        } else if (count > 2) {
            overusedEdgeCount++;
        }
    }

    return {
        boundaryEdgeCount,
        overusedEdgeCount,
        badEdgeCount,
    };
}

function parseMeshObjects(modelXml: string): ExportedMeshObject[] {
    const objects: ExportedMeshObject[] = [];
    const objectPattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;

    for (const match of modelXml.matchAll(objectPattern)) {
        const attributes = match[1];
        const body = match[2];

        if (!body.includes('<mesh>')) {
            continue;
        }

        const triangles: Array<[number, number, number]> = [];
        const trianglePattern = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)" \/>/g;

        for (const triangleMatch of body.matchAll(trianglePattern)) {
            triangles.push([
                Number(triangleMatch[1]),
                Number(triangleMatch[2]),
                Number(triangleMatch[3]),
            ]);
        }

        objects.push({
            id: getAttribute(attributes, 'id'),
            name: getAttribute(attributes, 'name'),
            vertexCount: Array.from(body.matchAll(/<vertex /g)).length,
            triangleCount: triangles.length,
            topology: inspectRawTopology(triangles),
        });
    }

    return objects;
}

async function exportModelXml(root: THREE.Object3D, options?: Export3MFOptions): Promise<string> {
    installFileReaderPolyfill();

    const { exportObjectTo3MFBlob } = await loadExport3mfModule();
    const blob = await exportObjectTo3MFBlob(root, options);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const model = zip.file('3D/3dmodel.model');

    assert.ok(model, '3MF archive should contain 3D/3dmodel.model');

    return await model.async('string');
}

async function exportMeshObjects(
    root: THREE.Object3D,
    options?: Export3MFOptions
): Promise<ExportedMeshObject[]> {
    return parseMeshObjects(await exportModelXml(root, options));
}

function parseBaseMaterialColors(modelXml: string) {
    return Array.from(modelXml.matchAll(/<base\b[^>]*displaycolor="#([0-9A-Fa-f]{6})/g)).map(
        (match) => match[1].toUpperCase()
    );
}

test('3MF export keeps visible meshes as separate layer objects', async () => {
    const root = new THREE.Group();
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0xff0000));
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x00ff00));

    const objects = await exportMeshObjects(root);

    assert.deepEqual(
        objects.map((object) => object.name),
        ['Layer 1 (#FF0000)', 'Layer 2 (#00FF00)']
    );
});

test('3MF export preserves raw edge topology for indexed geometry', async () => {
    const root = new THREE.Group();
    root.add(createLayerMesh(createSharedCubeGeometry(), 0xff0000));

    const [object] = await exportMeshObjects(root);

    assert.equal(object.vertexCount, 8);
    assert.equal(object.triangleCount, 12);
    assert.equal(object.topology.badEdgeCount, 0);
    assert.equal(object.topology.boundaryEdgeCount, 0);
    assert.equal(object.topology.overusedEdgeCount, 0);
});

test('3MF export preserves raw edge topology for non-indexed layer geometry', async () => {
    const root = new THREE.Group();
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0xff0000));

    const [object] = await exportMeshObjects(root);

    assert.equal(object.triangleCount, 12);
    assert.equal(
        object.topology.badEdgeCount,
        0,
        'non-indexed preview geometry should export with shared 3MF vertex connectivity'
    );
    assert.equal(object.topology.boundaryEdgeCount, 0);
    assert.equal(object.topology.overusedEdgeCount, 0);
});

test('3MF export uses physical filament colors without virtual color explosion', async () => {
    const root = new THREE.Group();
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x223344));
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x445566));
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x667788));
    root.add(createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x8899aa));

    const modelXml = await exportModelXml(root, {
        layerFilamentColors: ['#ffffff', '#000000', '#ffffff', '#000000'],
    });
    const objects = parseMeshObjects(modelXml);

    assert.deepEqual(
        objects.map((object) => object.name),
        ['Layer 1 (#FFFFFF)', 'Layer 2 (#000000)', 'Layer 3 (#FFFFFF)', 'Layer 4 (#000000)']
    );
    assert.deepEqual(parseBaseMaterialColors(modelXml), ['FFFFFF', '000000']);
    for (const object of objects) {
        assert.equal(object.triangleCount, 12);
        assert.equal(object.topology.badEdgeCount, 0);
        assert.equal(object.topology.boundaryEdgeCount, 0);
        assert.equal(object.topology.overusedEdgeCount, 0);
    }
});

test('3MF export does not collapse meshes by legacy layer tags', async () => {
    const root = new THREE.Group();
    const first = createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0xff0000);
    const second = createLayerMesh(createSharedCubeGeometry().toNonIndexed(), 0x00ff00);
    first.userData.exportLayerIndex = 0;
    second.userData.exportLayerIndex = 0;
    root.add(first, second);

    const objects = await exportMeshObjects(root, {
        layerFilamentColors: ['#ffffff', '#000000'],
    });

    assert.deepEqual(
        objects.map((object) => object.name),
        ['Layer 1 (#FFFFFF)', 'Layer 2 (#000000)']
    );
});

test('3MF export keeps smooth stacks to one object per layer', async () => {
    const masks = [
        maskFromRows(['######', '######', '######', '######']),
        maskFromRows(['.#####', '######', '#####.', '.#####']),
        maskFromRows(['..####', '.#####', '#####.', '..###.']),
        maskFromRows(['...###', '..####', '.####.', '...##.']),
    ];
    const thickness = 0.08;
    const pixelSize = 0.4;
    const meshes: MeshData[] = new Array(masks.length);

    for (let layer = 0; layer < masks.length; layer++) {
        meshes[layer] = await buildSmoothLayer(
            masks[layer],
            thickness,
            layer * thickness,
            pixelSize
        );
    }

    const root = new THREE.Group();
    const previewColors = [0x00b8c4, 0x6300c5, 0xff00a1, 0xf7d000];
    for (let layer = 0; layer < meshes.length; layer++) {
        root.add(createMeshDataLayer(meshes[layer], previewColors[layer]));
    }

    const modelXml = await exportModelXml(root, {
        layerFilamentColors: ['#ffffff', '#000000', '#ffffff', '#000000'],
    });
    const objects = parseMeshObjects(modelXml);

    assert.equal(objects.length, masks.length, 'smooth stack should export one object per layer');
    assert.deepEqual(parseBaseMaterialColors(modelXml), ['FFFFFF', '000000']);

    for (const object of objects) {
        assert.equal(object.topology.badEdgeCount, 0, `${object.name} should be manifold`);
        assert.equal(object.topology.boundaryEdgeCount, 0, `${object.name} should be closed`);
        assert.equal(
            object.topology.overusedEdgeCount,
            0,
            `${object.name} should not overuse edges`
        );
    }
});

test('3MF export keeps image fixture smooth meshes manifold', async () => {
    const fixtures = [
        {
            name: '1024px logo',
            mask: maskFromPngAlpha(logoFixturePath, 80),
            color: 0x00b8c4,
            filamentColor: '#00b8c4',
        },
        {
            name: 'large issue JPG',
            mask: maskFromJpegLuminance(largeIssueFixturePath, 80, 176),
            color: 0xff00a1,
            filamentColor: '#ff00a1',
        },
    ];
    const thickness = 0.08;
    const pixelSize = 0.4;
    const root = new THREE.Group();

    for (let layer = 0; layer < fixtures.length; layer++) {
        const fixture = fixtures[layer];
        assert.ok(fixture.mask.activeCount > 0, `${fixture.name} should contain active pixels`);
        assert.ok(
            fixture.mask.activeCount < fixture.mask.width * fixture.mask.height,
            `${fixture.name} should not collapse to a full mask`
        );

        const mesh = await buildSmoothLayer(fixture.mask, thickness, layer * thickness, pixelSize);
        root.add(createMeshDataLayer(mesh, fixture.color));
    }

    const modelXml = await exportModelXml(root, {
        layerFilamentColors: fixtures.map((fixture) => fixture.filamentColor),
    });
    const objects = parseMeshObjects(modelXml);

    assert.equal(objects.length, fixtures.length, 'image fixtures should export one object each');
    assert.deepEqual(parseBaseMaterialColors(modelXml), ['00B8C4', 'FF00A1']);

    for (const object of objects) {
        assert.equal(object.topology.badEdgeCount, 0, `${object.name} should be manifold`);
        assert.equal(object.topology.boundaryEdgeCount, 0, `${object.name} should be closed`);
        assert.equal(
            object.topology.overusedEdgeCount,
            0,
            `${object.name} should not overuse edges`
        );
    }
});

test('3MF export keeps many smooth layers bounded to layer count', async () => {
    const layerCount = 16;
    const width = 32;
    const height = 24;
    const thickness = 0.08;
    const pixelSize = 0.35;
    const masks = Array.from({ length: layerCount }, (_, layer) => {
        const activePixels = new Uint8Array(width * height);
        const left = Math.floor(layer * 0.45);
        const right = width - 1 - Math.floor(layer * 0.55);
        const top = Math.floor(layer * 0.25);
        const bottom = height - 1 - Math.floor(layer * 0.35);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const diagonalKeepsPixel = x + Math.floor(y / 2) >= left + Math.floor(layer / 3);
                const notchRemovesPixel = x > width - 8 && y < 4 + Math.floor(layer / 2);

                if (
                    x >= left &&
                    x <= right &&
                    y >= top &&
                    y <= bottom &&
                    diagonalKeepsPixel &&
                    !notchRemovesPixel
                ) {
                    activePixels[y * width + x] = 1;
                }
            }
        }

        return { activePixels, width, height };
    });

    const meshes: MeshData[] = new Array(masks.length);

    for (let layer = 0; layer < masks.length; layer++) {
        meshes[layer] = await buildSmoothLayer(
            masks[layer],
            thickness,
            layer * thickness,
            pixelSize
        );
    }

    const root = new THREE.Group();
    for (let layer = 0; layer < meshes.length; layer++) {
        root.add(createMeshDataLayer(meshes[layer], layer % 2 === 0 ? 0xff00a1 : 0x00b8c4));
    }

    const modelXml = await exportModelXml(root, {
        layerFilamentColors: Array.from({ length: layerCount }, (_, layer) =>
            layer % 2 === 0 ? '#ffffff' : '#000000'
        ),
    });
    const objects = parseMeshObjects(modelXml);

    assert.equal(objects.length, layerCount, 'smooth export should not create support sub-objects');
    assert.ok(objects.length < 100, 'smooth export should stay bounded to the layer count');
    assert.deepEqual(parseBaseMaterialColors(modelXml), ['FFFFFF', '000000']);

    for (const object of objects) {
        assert.equal(object.topology.badEdgeCount, 0, `${object.name} should be manifold`);
        assert.equal(object.topology.boundaryEdgeCount, 0, `${object.name} should be closed`);
        assert.equal(
            object.topology.overusedEdgeCount,
            0,
            `${object.name} should not overuse edges`
        );
    }
});
