/**
 * Generates a binary STL blob containing a row of flat square test patches,
 * one per layer count. Each patch is 20×20mm with height = layerCount × layerHeight.
 * Patches are arranged along the X axis with 5mm gaps.
 *
 * No Three.js dependency — writes binary STL directly.
 */

const PATCH_SIZE = 20; // mm

/** Write a float32 little-endian at byte offset */
function setF32(view: DataView, offset: number, value: number) {
    view.setFloat32(offset, value, true);
}

/** Write one STL triangle (50 bytes) */
function writeTriangle(
    view: DataView,
    offset: number,
    nx: number, ny: number, nz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
) {
    setF32(view, offset,      nx); setF32(view, offset + 4,  ny); setF32(view, offset + 8,  nz);
    setF32(view, offset + 12, ax); setF32(view, offset + 16, ay); setF32(view, offset + 20, az);
    setF32(view, offset + 24, bx); setF32(view, offset + 28, by); setF32(view, offset + 32, bz);
    setF32(view, offset + 36, cx); setF32(view, offset + 40, cy); setF32(view, offset + 44, cz);
    view.setUint16(offset + 48, 0, true);
}

/**
 * Write all 12 triangles for a box.
 * Corner at (x0, 0, z0), size (w, d, h). Z is the build direction.
 */
function writeBox(view: DataView, offset: number, x0: number, w: number, h: number, d: number, z0 = 0): number {
    const x1 = x0 + w, y1 = d, z1 = z0 + h;

    // Bottom (Z=z0, normal -Z)
    offset = writeFace(view, offset,  0,  0, -1,   x0,0,z0,  x1,y1,z0, x1,0,z0);
    offset = writeFace(view, offset,  0,  0, -1,   x0,0,z0,  x0,y1,z0, x1,y1,z0);
    // Top (Z=z1, normal +Z)
    offset = writeFace(view, offset,  0,  0,  1,   x0,0,z1,  x1,0,z1,  x1,y1,z1);
    offset = writeFace(view, offset,  0,  0,  1,   x0,0,z1,  x1,y1,z1, x0,y1,z1);
    // Front (Y=0, normal -Y)
    offset = writeFace(view, offset,  0, -1,  0,   x0,0,z0,  x1,0,z0,  x1,0,z1);
    offset = writeFace(view, offset,  0, -1,  0,   x0,0,z0,  x1,0,z1,  x0,0,z1);
    // Back (Y=d, normal +Y)
    offset = writeFace(view, offset,  0,  1,  0,   x0,y1,z0, x1,y1,z1, x1,y1,z0);
    offset = writeFace(view, offset,  0,  1,  0,   x0,y1,z0, x0,y1,z1, x1,y1,z1);
    // Left (X=x0, normal -X)
    offset = writeFace(view, offset, -1,  0,  0,   x0,0,z0,  x0,0,z1,  x0,y1,z1);
    offset = writeFace(view, offset, -1,  0,  0,   x0,0,z0,  x0,y1,z1, x0,y1,z0);
    // Right (X=x1, normal +X)
    offset = writeFace(view, offset,  1,  0,  0,   x1,0,z0,  x1,y1,z0, x1,y1,z1);
    offset = writeFace(view, offset,  1,  0,  0,   x1,0,z0,  x1,y1,z1, x1,0,z1);

    return offset;
}

function writeFace(
    view: DataView, offset: number,
    nx: number, ny: number, nz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
): number {
    writeTriangle(view, offset, nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz);
    return offset + 50;
}

export function generateCalibrationPatchesStl(
    layerCounts: number[],
    layerHeight: number,
): Blob {
    const TRIS_PER_BOX = 12;
    const totalTris = layerCounts.length * TRIS_PER_BOX;
    const buffer = new ArrayBuffer(80 + 4 + totalTris * 50);
    const view = new DataView(buffer);

    const header = 'Kromacut Calibration Patches';
    for (let i = 0; i < header.length && i < 80; i++) view.setUint8(i, header.charCodeAt(i));
    view.setUint32(80, totalTris, true);

    let offset = 84;
    layerCounts.forEach((count, i) => {
        const x0 = i * PATCH_SIZE;
        const patchHeight = count * layerHeight;
        offset = writeBox(view, offset, x0, PATCH_SIZE, patchHeight, PATCH_SIZE);
    });

    return new Blob([buffer], { type: 'model/stl' });
}
