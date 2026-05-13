import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampProgress,
    deditherRowProgress,
    exportMeshProgress,
    exportZipProgress,
    layeredBuildLayerProgress,
    layeredBuildScanProgress,
    progressInSpan,
    quantizeAlgorithmProgress,
    quantizePostProgress,
    quantizeSwatchProgress,
} from '../src/lib/progress.ts';

function assertNonDecreasingProgress(samples: number[], label: string) {
    assert.ok(samples.length > 0, `${label} should include samples`);

    for (let i = 0; i < samples.length; i++) {
        assert.ok(Number.isFinite(samples[i]), `${label} sample ${i} should be finite`);
        assert.ok(samples[i] >= 0, `${label} sample ${i} should be >= 0`);
        assert.ok(samples[i] <= 1, `${label} sample ${i} should be <= 1`);

        if (i > 0) {
            assert.ok(
                samples[i] >= samples[i - 1],
                `${label} sample ${i} went backwards from ${samples[i - 1]} to ${samples[i]}`
            );
        }
    }
}

test('progress values clamp to the visible 0..1 range', () => {
    assert.equal(clampProgress(-0.25), 0);
    assert.equal(clampProgress(0.42), 0.42);
    assert.equal(clampProgress(1.25), 1);
    assert.equal(clampProgress(Number.NaN), 0);
});

test('progress spans map phase-local work into a stable global range', () => {
    assert.equal(progressInSpan(0.2, 0.3, 0), 0.2);
    assert.equal(progressInSpan(0.2, 0.3, 0.5), 0.35);
    assert.equal(progressInSpan(0.2, 0.3, 1), 0.5);
    assert.equal(progressInSpan(0.2, 0.3, 2), 0.5);
    assert.equal(progressInSpan(0.2, -0.3, 1), 0.2);
});

test('export progress advances through mesh and zip stages', () => {
    const samples: number[] = [];
    const meshCount = 3;

    for (let mesh = 0; mesh < meshCount; mesh++) {
        for (const fraction of [0, 0.42, 0.68, 1]) {
            samples.push(exportMeshProgress(mesh, meshCount, fraction));
        }
    }
    for (const fraction of [0, 0.5, 1]) {
        samples.push(exportZipProgress(fraction));
    }

    assertNonDecreasingProgress(samples, 'export progress');
    assert.equal(samples[samples.length - 1], 1);
});

test('quantize progress advances through load, algorithm, post, and swatch stages', () => {
    const samples = [
        0.01,
        0.02,
        0.04,
        0.06,
        0.1,
        quantizeAlgorithmProgress(0),
        quantizeAlgorithmProgress(0.5),
        quantizeAlgorithmProgress(1),
        0.68,
        quantizePostProgress(0),
        quantizePostProgress(0.5),
        quantizePostProgress(1),
        0.88,
        quantizeSwatchProgress(0, 100),
        quantizeSwatchProgress(50, 100),
        quantizeSwatchProgress(100, 100),
        1,
    ];

    assertNonDecreasingProgress(samples, 'quantize progress');
});

test('dedither progress advances through setup, row processing, and output stages', () => {
    const totalRows = 24;
    const samples = [0.01, 0.06, 0.1];

    for (let row = 1; row <= totalRows; row++) {
        samples.push(deditherRowProgress(row, totalRows));
    }
    samples.push(0.95, 1);

    assertNonDecreasingProgress(samples, 'dedither progress');
});

test('layered 3D build progress advances through scan and layer stages', () => {
    const samples: number[] = [];
    const rowCount = 64;
    const layerCount = 6;

    for (let row = 0; row < rowCount; row++) {
        samples.push(layeredBuildScanProgress(row, rowCount, layerCount));
    }

    for (let layer = 0; layer < layerCount; layer++) {
        for (let row = 0; row < rowCount; row++) {
            samples.push(layeredBuildLayerProgress(layer, row, rowCount, layerCount));
        }
    }

    assertNonDecreasingProgress(samples, '3D build progress');
    assert.equal(samples[samples.length - 1], 1);
});
