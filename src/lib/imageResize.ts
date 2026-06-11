export const MIN_IMAGE_RESIZE_PERCENT = 1;
export const MAX_IMAGE_RESIZE_PERCENT = 100;
export const DEFAULT_IMAGE_RESIZE_PERCENT = 50;

export interface ImageResizeDimensions {
    width: number;
    height: number;
    percent: number;
}

export function clampImageResizePercent(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_IMAGE_RESIZE_PERCENT;
    return Math.max(
        MIN_IMAGE_RESIZE_PERCENT,
        Math.min(MAX_IMAGE_RESIZE_PERCENT, Math.round(value))
    );
}

export function calculateImageResizeDimensions(
    sourceWidth: number,
    sourceHeight: number,
    percent: number
): ImageResizeDimensions {
    const clampedPercent = clampImageResizePercent(percent);
    const scale = clampedPercent / 100;

    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
        percent: clampedPercent,
    };
}
