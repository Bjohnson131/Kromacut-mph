import { Card } from '@/components/ui/card';
import { NumberInput } from '@/components/ui/input';
import { RotateCcw } from 'lucide-react';

interface PrintSettingsCardProps {
    layerHeight: number;
    slicerFirstLayerHeight: number;
    pixelSize: number;
    onLayerHeightChange: (v: number) => void;
    onSlicerFirstLayerHeightChange: (v: number) => void;
    onPixelSizeChange: (v: number) => void;
    onReset: () => void;
    allDefault?: boolean;
}

export default function PrintSettingsCard({
    layerHeight,
    slicerFirstLayerHeight,
    pixelSize,
    onLayerHeightChange,
    onSlicerFirstLayerHeightChange,
    onPixelSizeChange,
    onReset,
    allDefault = false,
}: PrintSettingsCardProps) {
    // Validation helpers
    const pixelSizeError =
        pixelSize < 0.01 ? 'Minimum value is 0.01' : pixelSize > 10 ? 'Maximum value is 10' : '';
    const layerHeightError =
        layerHeight < 0.01
            ? 'Minimum value is 0.01'
            : layerHeight > 10
              ? 'Maximum value is 10'
              : '';
    const firstLayerHeightError =
        slicerFirstLayerHeight < 0
            ? 'Minimum value is 0'
            : slicerFirstLayerHeight > 10
              ? 'Maximum value is 10'
              : '';

    return (
        <Card className="p-4 border border-border/50">
            <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">3D Print Settings</h3>
                    <p className="text-xs text-muted-foreground">
                        Configure your printing parameters
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onReset}
                    disabled={allDefault}
                    title="Reset print settings to default"
                    aria-label="Reset print settings"
                    className="h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-amber-600 hover:bg-amber-600/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground select-none cursor-pointer"
                >
                    <RotateCcw className="w-4 h-4" />
                </button>
            </div>
            <div className="h-px bg-border/50 my-4" />
            <div className="space-y-4">
                {/* Pixel size (XY scaling) */}
                <div className="space-y-3">
                    <label className="block space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-foreground">Pixel Size (XY)</span>
                            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                                mm/pixel
                            </span>
                        </div>
                        <NumberInput
                            min={0.01}
                            max={10}
                            step={0.01}
                            value={Number.isNaN(pixelSize) || pixelSize === 0 ? '' : pixelSize}
                            className={pixelSizeError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                            onChange={(e) => {
                                const v = e.target.valueAsNumber;
                                onPixelSizeChange(Number.isNaN(v) ? 0 : v);
                            }}
                            onBlur={() => {
                                onPixelSizeChange(Math.max(0.01, Math.min(10, pixelSize || 0.01)));
                            }}
                        />
                        {pixelSizeError && (
                            <span className="text-xs text-red-500">{pixelSizeError}</span>
                        )}
                    </label>
                </div>

                {/* Layer height */}
                <div className="space-y-3">
                    <label className="block space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-foreground">Layer Height</span>
                            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                                mm
                            </span>
                        </div>
                        <NumberInput
                            min={0.01}
                            max={10}
                            step={0.01}
                            value={Number.isNaN(layerHeight) || layerHeight === 0 ? '' : layerHeight}
                            className={layerHeightError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                            onChange={(e) => {
                                const v = e.target.valueAsNumber;
                                onLayerHeightChange(Number.isNaN(v) ? 0 : v);
                            }}
                            onBlur={() => {
                                onLayerHeightChange(Math.max(0.01, Math.min(10, layerHeight || 0.01)));
                            }}
                        />
                        {layerHeightError && (
                            <span className="text-xs text-red-500">{layerHeightError}</span>
                        )}
                    </label>
                </div>

                {/* Slicer first layer height */}
                <div className="space-y-3">
                    <label className="block space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-foreground">
                                First Layer Height
                            </span>
                            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                                mm
                            </span>
                        </div>
                        <NumberInput
                            min={0}
                            max={10}
                            step={0.01}
                            value={Number.isNaN(slicerFirstLayerHeight) ? '' : slicerFirstLayerHeight}
                            className={firstLayerHeightError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                            onChange={(e) => {
                                const v = e.target.valueAsNumber;
                                onSlicerFirstLayerHeightChange(Number.isNaN(v) ? 0 : v);
                            }}
                            onBlur={() => {
                                onSlicerFirstLayerHeightChange(Math.max(0, Math.min(10, slicerFirstLayerHeight || 0)));
                            }}
                        />
                        {firstLayerHeightError && (
                            <span className="text-xs text-red-500">{firstLayerHeightError}</span>
                        )}
                    </label>
                </div>
            </div>
        </Card>
    );
}
