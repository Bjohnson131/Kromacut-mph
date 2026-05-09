import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import * as THREE from 'three';
import { createServer } from 'vite';

type Export3mfModule = typeof import('../src/lib/export3mf.ts');

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
            [
                -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
                -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
            ],
            3
        )
    );

    geometry.setIndex([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7,
        2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]);

    return geometry;
}

function createLayerMesh(geometry: THREE.BufferGeometry, color: number) {
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
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

async function exportMeshObjects(root: THREE.Object3D): Promise<ExportedMeshObject[]> {
    installFileReaderPolyfill();

    const { exportObjectTo3MFBlob } = await loadExport3mfModule();
    const blob = await exportObjectTo3MFBlob(root);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const model = zip.file('3D/3dmodel.model');

    assert.ok(model, '3MF archive should contain 3D/3dmodel.model');

    return parseMeshObjects(await model.async('string'));
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
