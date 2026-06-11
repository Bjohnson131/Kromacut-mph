import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateImageResizeDimensions, clampImageResizePercent } from '../src/lib/imageResize.ts';

test('image resize percent clamps to downscale bounds', () => {
    assert.equal(clampImageResizePercent(0), 1);
    assert.equal(clampImageResizePercent(150), 100);
    assert.equal(clampImageResizePercent(Number.NaN), 50);
    assert.equal(clampImageResizePercent(33.4), 33);
});

test('image resize dimensions preserve aspect ratio with at least one pixel per axis', () => {
    assert.deepEqual(calculateImageResizeDimensions(1000, 800, 50), {
        width: 500,
        height: 400,
        percent: 50,
    });

    assert.deepEqual(calculateImageResizeDimensions(3, 2, 1), {
        width: 1,
        height: 1,
        percent: 1,
    });
});
