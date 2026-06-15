import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGreedyMesh, generateSmoothMesh, type MeshData } from '../src/lib/meshing.ts';

// Re-applied during the develop rebase: the multi-head / per-colour-group build
// path passes skipBottomCap (stacked sub-meshes) and skipRepair (independent
// colour groups). These guard that wiring against future mesher refactors.

const noYield = { yieldIntervalMs: Infinity, onYield: async () => undefined };

function maskFromRows(rows: string[]): { activePixels: Uint8Array; width: number; height: number } {
    const width = rows[0].length;
    const height = rows.length;
    const activePixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rows[y][x] === '#') activePixels[y * width + x] = 1;
        }
    }
    return { activePixels, width, height };
}

// Count triangles whose geometric normal points downward (-Z) — i.e. bottom-cap faces.
function countDownwardFacingTriangles(mesh: MeshData): number {
    const { positions, indices } = mesh;
    let count = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const abx = positions[b] - positions[a];
        const aby = positions[b + 1] - positions[a + 1];
        const acx = positions[c] - positions[a];
        const acy = positions[c + 1] - positions[a + 1];
        const nz = abx * acy - aby * acx; // z-component of (B-A) x (C-A)
        if (nz < -1e-6) count++;
    }
    return count;
}

const meshers = [
    { name: 'greedy', generate: generateGreedyMesh },
    { name: 'smooth', generate: generateSmoothMesh },
];

for (const { name, generate } of meshers) {
    test(`${name}: skipBottomCap omits the downward-facing bottom cap`, async () => {
        const mask = maskFromRows(['###', '###', '###']);

        const withCap = await generate(mask.activePixels, mask.width, mask.height, 1, 0, 1, 1, {
            ...noYield,
        });
        const withoutCap = await generate(mask.activePixels, mask.width, mask.height, 1, 0, 1, 1, {
            ...noYield,
            skipBottomCap: true,
        });

        assert.ok(
            countDownwardFacingTriangles(withCap) > 0,
            'default build should emit bottom-cap (downward) faces'
        );
        assert.equal(
            countDownwardFacingTriangles(withoutCap),
            0,
            'skipBottomCap should emit no downward-facing faces'
        );
        assert.ok(
            withoutCap.indices.length < withCap.indices.length,
            'skipBottomCap should produce fewer triangles'
        );
    });
}

test('skipRepair leaves diagonal corner-contacts split (default merges them)', async () => {
    // An "X" of pixels that touch only at corners. repairBinaryCornerContacts
    // welds the contacts (fewer triangles); skipRepair leaves each pixel as its
    // own island (more triangles).
    const mask = maskFromRows(['#.#', '.#.', '#.#']);

    const repaired = await generateGreedyMesh(mask.activePixels, 3, 3, 1, 0, 1, 1, { ...noYield });
    const unrepaired = await generateGreedyMesh(mask.activePixels, 3, 3, 1, 0, 1, 1, {
        ...noYield,
        skipRepair: true,
    });

    assert.ok(
        unrepaired.indices.length > repaired.indices.length,
        'skipRepair should leave more (unwelded) geometry than the default repair pass'
    );
});
