import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
    enforcePaletteSizeAsync,
    kmeansImageData,
    mapImageToPalette,
    medianCutImageData,
    octreeImageData,
    posterizeImageData,
    wuImageData,
    type AlgoOptions,
} from '../src/lib/algorithms.ts';

type ImageAlgorithm = (data: ImageData, opts: AlgoOptions) => Promise<ImageData>;

function createPatternImageData(width = 96, height = 96): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const paletteIndex = (x * 7 + y * 11) % 48;
            const offset = (y * width + x) * 4;

            data[offset] = (paletteIndex % 6) * 42;
            data[offset + 1] = (Math.floor(paletteIndex / 6) % 4) * 64;
            data[offset + 2] = (Math.floor(paletteIndex / 24) % 2) * 128;
            data[offset + 3] = 255;
        }
    }

    return { data, width, height } as ImageData;
}

function assertProgressSamples(samples: number[], label: string) {
    assert.ok(samples.length > 0, `${label} should report progress`);

    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        assert.ok(Number.isFinite(sample), `${label} sample ${i} should be finite`);
        assert.ok(sample >= 0, `${label} sample ${i} should be >= 0, got ${sample}`);
        assert.ok(sample <= 1, `${label} sample ${i} should be <= 1, got ${sample}`);

        if (i > 0) {
            assert.ok(
                sample >= samples[i - 1],
                `${label} sample ${i} went backwards from ${samples[i - 1]} to ${sample}`
            );
        }
    }

    assert.equal(samples[samples.length - 1], 1, `${label} should finish at 100%`);
}

test('image algorithm progress callbacks stay monotonic', async (t: TestContext) => {
    const algorithms: Array<{ name: string; run: ImageAlgorithm }> = [
        {
            name: 'posterize',
            run: (data, opts) => posterizeImageData(data, 8, opts),
        },
        {
            name: 'median cut',
            run: (data, opts) => medianCutImageData(data, 8, opts),
        },
        {
            name: 'k-means',
            run: (data, opts) => kmeansImageData(data, 8, opts),
        },
        {
            name: 'octree',
            run: (data, opts) => octreeImageData(data, 8, opts),
        },
        {
            name: 'wu',
            run: (data, opts) => wuImageData(data, 8, opts),
        },
        {
            name: 'enforce palette size',
            run: (data, opts) =>
                enforcePaletteSizeAsync(data, 8, (value) => opts.onProgress?.(value)),
        },
        {
            name: 'map image to palette',
            run: (data, opts) =>
                mapImageToPalette(data, ['#000000', '#ffffff', '#ff0000', '#00ff00'], opts),
        },
    ];

    for (const { name, run } of algorithms) {
        await t.test(name, async () => {
            const samples: number[] = [];

            await run(createPatternImageData(), {
                onProgress: (value) => samples.push(value),
            });

            assertProgressSamples(samples, `${name} progress`);
        });
    }
});
