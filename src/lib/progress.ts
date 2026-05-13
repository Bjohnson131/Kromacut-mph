export function clampProgress(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function progressInSpan(start: number, span: number, fraction: number): number {
    return clampProgress(start + Math.max(0, span) * clampProgress(fraction));
}

export function exportMeshProgress(
    meshIndex: number,
    meshCount: number,
    meshFraction: number
): number {
    const safeMeshCount = Math.max(1, Math.floor(meshCount));
    const boundedMeshIndex = Math.max(0, Math.min(safeMeshCount - 1, Math.floor(meshIndex)));
    return progressInSpan(0, 0.8, (boundedMeshIndex + clampProgress(meshFraction)) / safeMeshCount);
}

export function exportZipProgress(fraction: number): number {
    return progressInSpan(0.8, 0.2, fraction);
}

export function quantizeAlgorithmProgress(fraction: number): number {
    return progressInSpan(0.1, 0.55, fraction);
}

export function quantizePostProgress(fraction: number): number {
    return progressInSpan(0.68, 0.17, fraction);
}

export function quantizeSwatchProgress(pixelIndex: number, pixelCount: number): number {
    return progressInSpan(0.88, 0.1, Math.max(0, pixelIndex) / Math.max(1, pixelCount));
}

export function deditherRowProgress(processedRows: number, totalRows: number): number {
    return progressInSpan(0.1, 0.85, Math.max(0, processedRows) / Math.max(1, totalRows));
}

export function progressBarIndicatorClass(indeterminate = false): string {
    const baseClass = 'h-2 rounded-full bg-primary';
    return indeterminate ? `${baseClass} animate-pulse` : baseClass;
}

function progressRowFraction(rowIndex: number, rowCount: number): number {
    return clampProgress((Math.max(0, Math.floor(rowIndex)) + 1) / Math.max(1, rowCount));
}

export function layeredBuildScanProgress(
    rowIndex: number,
    rowCount: number,
    layerCount: number
): number {
    const stageCount = Math.max(1, Math.floor(layerCount) + 1);
    return progressInSpan(0, 1 / stageCount, progressRowFraction(rowIndex, rowCount));
}

export function layeredBuildLayerProgress(
    layerIndex: number,
    rowIndex: number,
    rowCount: number,
    layerCount: number
): number {
    const safeLayerCount = Math.max(1, Math.floor(layerCount));
    const stageCount = safeLayerCount + 1;
    const boundedLayerIndex = Math.max(
        0,
        Math.min(safeLayerCount - 1, Math.floor(layerIndex))
    );
    const stageStart = (boundedLayerIndex + 1) / stageCount;

    return progressInSpan(stageStart, 1 / stageCount, progressRowFraction(rowIndex, rowCount));
}
