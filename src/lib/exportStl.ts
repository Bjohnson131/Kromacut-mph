// Binary STL exporter for three.js objects (Kromacut)
// Exports the object's geometry (respecting world transforms) into a binary STL Blob.
// Merges all Mesh descendants into a single STL file.
import * as THREE from 'three';

type ExportGeometrySource = {
    positions: ArrayLike<number>;
    indices?: ArrayLike<number>;
    itemSize?: number;
};

function getKromacutExportGeometry(geometry: THREE.BufferGeometry): ExportGeometrySource | null {
    const source = geometry.userData?.kromacutExportGeometry as ExportGeometrySource | undefined;
    if (!source?.positions || !source.indices) return null;
    return {
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
