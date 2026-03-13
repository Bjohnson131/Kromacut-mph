/**
 * Filament Calibration Wizard
 *
 * Multi-step wizard for calibrating filament Transmission Distance (TD) values.
 * Guides users through printing test patches, measuring RGB values, and computing
 * TD with confidence scoring.
 */

import { useState, useCallback } from 'react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { X } from 'lucide-react';
import {
    calculateTDFromMeasurements,
    rgbToTransmission,
    getCalibrationInstructions,
    getRecommendedLayerCounts,
    canCalculateTD,
    getConfidenceLabel,
    getConfidenceColor,
    type CalibrationMeasurement,
    type CalibrationResult,
} from '@/lib/calibration';

type WizardStep = 'intro' | 'print' | 'measure' | 'results';

interface FilamentCalibrationWizardProps {
    open: boolean;
    onClose: () => void;
    onComplete: (result: CalibrationResult) => void;
    filamentColor: string;
    filamentName?: string;
    layerHeight: number;
    existingMeasurements?: CalibrationMeasurement[];
}

export function FilamentCalibrationWizard({
    open,
    onClose,
    onComplete,
    filamentColor,
    filamentName = 'Your filament',
    layerHeight,
    existingMeasurements = [],
}: FilamentCalibrationWizardProps) {
    const [step, setStep] = useState<WizardStep>('intro');
    const [measurements, setMeasurements] = useState<CalibrationMeasurement[]>(
        existingMeasurements
    );
    const [calibrationLayerHeight, setCalibrationLayerHeight] = useState(layerHeight);
    const [currentLayers, setCurrentLayers] = useState<string>('');
    const [currentRGB, setCurrentRGB] = useState({ r: '', g: '', b: '' });
    const [result, setResult] = useState<CalibrationResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const { recommended } = getRecommendedLayerCounts(measurements);

    const handleAddMeasurement = useCallback(() => {
        const layers = Math.max(1, Number.parseInt(currentLayers, 10) || 1);
        const r = Math.max(0, Math.min(255, Number.parseInt(currentRGB.r, 10) || 0));
        const g = Math.max(0, Math.min(255, Number.parseInt(currentRGB.g, 10) || 0));
        const b = Math.max(0, Math.min(255, Number.parseInt(currentRGB.b, 10) || 0));

        const rgb: [number, number, number] = [r, g, b];
        const transmission = rgbToTransmission(rgb);

        const newMeasurement: CalibrationMeasurement = {
            layers,
            rgb,
            transmission,
        };

        setMeasurements((prev) => [...prev, newMeasurement]);
        setCurrentLayers('');
        setCurrentRGB({ r: '', g: '', b: '' });
    }, [currentLayers, currentRGB]);

    const handleRemoveMeasurement = useCallback((index: number) => {
        setMeasurements((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleCalculate = useCallback(() => {
        const { ready, reason } = canCalculateTD(measurements);
        if (!ready) {
            setErrorMessage(reason || 'Cannot calculate TD yet.');
            return;
        }

        try {
            const { td, tdSingleValue, confidence } = calculateTDFromMeasurements(
                measurements,
                calibrationLayerHeight
            );

            const calibrationResult: CalibrationResult = {
                color: filamentColor,
                measurements,
                td,
                tdSingleValue,
                confidence,
                calibrationDate: new Date().toISOString(),
                notes: `Calibrated for ${filamentName}`,
            };

            setResult(calibrationResult);
            setStep('results');
            setErrorMessage(null);
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to calculate TD.');
        }
    }, [measurements, calibrationLayerHeight, filamentColor, filamentName]);

    const handleComplete = useCallback(() => {
        if (result) {
            onComplete(result);
            onClose();
            // Reset state
            setStep('intro');
            setMeasurements(existingMeasurements);
            setCalibrationLayerHeight(layerHeight);
            setResult(null);
            setErrorMessage(null);
        }
    }, [result, onComplete, onClose, existingMeasurements, layerHeight]);

    const handleCancel = useCallback(() => {
        onClose();
        // Reset state after a short delay to avoid visible state change before closing
        setTimeout(() => {
            setStep('intro');
            setMeasurements(existingMeasurements);
            setCalibrationLayerHeight(layerHeight);
            setCurrentLayers('');
            setCurrentRGB({ r: '', g: '', b: '' });
            setResult(null);
            setErrorMessage(null);
        }, 300);
    }, [onClose, existingMeasurements, layerHeight]);

    const renderIntro = () => (
        <>
            <AlertDialogHeader>
                <AlertDialogTitle>Calibrate Filament TD</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-2">
                <p>
                    Calibrating Transmission Distance (TD) will give you more accurate
                    auto-paint results.
                </p>
                <p className="font-semibold">You will need:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>{filamentName}</li>
                    <li>A 3D printer</li>
                    <li>A backlit white surface (phone screen works great)</li>
                    <li>A color picker tool (digital or app)</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-4">
                    This process takes about 15-20 minutes including print time.
                </p>
            </div>
            <AlertDialogFooter>
                <Button variant="outline" onClick={handleCancel}>
                    Cancel
                </Button>
                <Button onClick={() => setStep('print')}>Start Calibration</Button>
            </AlertDialogFooter>
        </>
    );

    const renderPrintInstructions = () => {
        const instructions = getCalibrationInstructions(calibrationLayerHeight);

        return (
            <>
                <AlertDialogHeader>
                    <AlertDialogTitle>Step 1: Print Test Patches</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                        <div className="space-y-2">
                            {instructions.map((instruction, i) => (
                                <p key={i} className="text-sm">
                                    {i === 0 ? '📋' : i === instructions.length - 1 ? '📊' : '🔧'}{' '}
                                    {instruction}
                                </p>
                            ))}
                        </div>

                        <Card className="p-4 bg-muted">
                            <p className="text-sm font-semibold mb-2">Print Settings:</p>
                            <ul className="text-sm space-y-1">
                                <li>
                                    <strong>Filament:</strong>{' '}
                                    <span
                                        className="inline-block w-4 h-4 rounded border"
                                        style={{ backgroundColor: filamentColor }}
                                    />{' '}
                                    {filamentName}
                                </li>
                                <li className="flex items-center gap-2">
                                    <strong>Layer Height:</strong>
                                    <Input
                                        type="number"
                                        value={calibrationLayerHeight}
                                        onChange={(e) => setCalibrationLayerHeight(Number(e.target.value))}
                                        step="0.01"
                                        min="0.05"
                                        max="0.4"
                                        className="w-20 h-7 text-xs"
                                    />
                                    <span className="text-xs">mm</span>
                                </li>
                                <li>
                                    <strong>Infill:</strong> 100%
                                </li>
                                <li>
                                    <strong>Patch Size:</strong> 20mm × 20mm (or larger)
                                </li>
                                <li>
                                    <strong>Layer Counts:</strong> {recommended.join(', ')} layers
                                </li>
                            </ul>
                        </Card>

                        <p className="text-xs text-muted-foreground">
                            💡 Tip: Label each patch with its layer count using a marker.
                        </p>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={() => setStep('intro')}>
                        Back
                    </Button>
                    <Button onClick={() => setStep('measure')}>Patches Printed</Button>
                </AlertDialogFooter>
            </>
        );
    };

    const renderMeasurement = () => {
        const { ready, reason } = canCalculateTD(measurements);

        return (
            <>
                <AlertDialogHeader>
                    <AlertDialogTitle>Step 2: Measure RGB Values</AlertDialogTitle>
                </AlertDialogHeader>
                <p className="text-sm mb-4">
                    Place each patch on a backlit white surface and use a color picker to
                    sample the RGB values from the center.
                </p>

                <div className="space-y-4 py-4">
                    {/* Existing measurements */}
                    {measurements.length > 0 && (
                        <div className="space-y-2">
                            <Label>Measurements ({measurements.length})</Label>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {measurements.map((m, i) => (
                                    <Card key={i} className="p-3 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium w-16">
                                                {m.layers} layers
                                            </span>
                                            <div
                                                className="w-6 h-6 rounded border"
                                                style={{
                                                    backgroundColor: `rgb(${m.rgb[0]}, ${m.rgb[1]}, ${m.rgb[2]})`,
                                                }}
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                RGB({m.rgb[0]}, {m.rgb[1]}, {m.rgb[2]})
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveMeasurement(i)}
                                        >
                                            Remove
                                        </Button>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Add new measurement */}
                    <div className="space-y-3">
                        <Label>Add Measurement</Label>
                        <div className="grid grid-cols-4 gap-2">
                            <div>
                                <Label htmlFor="layers" className="text-xs">
                                    Layers
                                </Label>
                                <Input
                                    id="layers"
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={currentLayers}
                                    onChange={(e) => setCurrentLayers(e.target.value)}
                                    placeholder="2"
                                />
                            </div>
                            <div>
                                <Label htmlFor="r" className="text-xs">
                                    R
                                </Label>
                                <Input
                                    id="r"
                                    type="number"
                                    min="0"
                                    max="255"
                                    value={currentRGB.r}
                                    onChange={(e) =>
                                        setCurrentRGB((prev) => ({ ...prev, r: e.target.value }))
                                    }
                                    placeholder="0-255"
                                />
                            </div>
                            <div>
                                <Label htmlFor="g" className="text-xs">
                                    G
                                </Label>
                                <Input
                                    id="g"
                                    type="number"
                                    min="0"
                                    max="255"
                                    value={currentRGB.g}
                                    onChange={(e) =>
                                        setCurrentRGB((prev) => ({ ...prev, g: e.target.value }))
                                    }
                                    placeholder="0-255"
                                />
                            </div>
                            <div>
                                <Label htmlFor="b" className="text-xs">
                                    B
                                </Label>
                                <Input
                                    id="b"
                                    type="number"
                                    min="0"
                                    max="255"
                                    value={currentRGB.b}
                                    onChange={(e) =>
                                        setCurrentRGB((prev) => ({ ...prev, b: e.target.value }))
                                    }
                                    placeholder="0-255"
                                />
                            </div>
                        </div>
                        <Button onClick={handleAddMeasurement} size="sm" className="w-full">
                            Add Measurement
                        </Button>
                    </div>

                    {!ready && reason && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400">{reason}</p>
                    )}

                    {errorMessage && (
                        <p className="text-xs text-destructive">{errorMessage}</p>
                    )}
                </div>

                <AlertDialogFooter>
                    <Button variant="outline" onClick={() => setStep('print')}>
                        Back
                    </Button>
                    <Button onClick={handleCalculate} disabled={!ready}>
                        Calculate TD
                    </Button>
                </AlertDialogFooter>
            </>
        );
    };

    const renderResults = () => {
        if (!result) return null;

        const confidenceLabel = getConfidenceLabel(result.confidence);
        const confidenceColor = getConfidenceColor(result.confidence);

        return (
            <>
                <AlertDialogHeader>
                    <AlertDialogTitle>Calibration Complete! 🎉</AlertDialogTitle>
                </AlertDialogHeader>
                <p className="text-sm mb-4">
                    Your filament has been calibrated successfully.
                </p>

                <div className="space-y-4 py-4">
                    <Card className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded border"
                                    style={{ backgroundColor: filamentColor }}
                                />
                                <div>
                                    <p className="font-semibold">{filamentName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {result.measurements.length} measurements
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-bold">
                                    {result.tdSingleValue.toFixed(2)}mm
                                </p>
                                <p className="text-xs text-muted-foreground">Transmission Distance</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="text-center p-2 bg-red-100 dark:bg-red-900/20 rounded">
                                <p className="font-semibold">R: {result.td[0].toFixed(2)}mm</p>
                            </div>
                            <div className="text-center p-2 bg-green-100 dark:bg-green-900/20 rounded">
                                <p className="font-semibold">G: {result.td[1].toFixed(2)}mm</p>
                            </div>
                            <div className="text-center p-2 bg-blue-100 dark:bg-blue-900/20 rounded">
                                <p className="font-semibold">B: {result.td[2].toFixed(2)}mm</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-sm">Confidence:</span>
                            <span className={`text-sm font-semibold ${confidenceColor}`}>
                                {confidenceLabel} ({(result.confidence * 100).toFixed(0)}%)
                            </span>
                        </div>
                    </Card>

                    <p className="text-xs text-muted-foreground">
                        💡 This calibration will be saved with your filament profile and improve
                        auto-paint accuracy.
                    </p>
                </div>

                <AlertDialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Discard
                    </Button>
                    <Button onClick={handleComplete}>Save Calibration</Button>
                </AlertDialogFooter>
            </>
        );
    };

    return (
        <AlertDialog open={open} onOpenChange={(isOpen) => {
            if (!isOpen) {
                onClose();
            }
        }}>
            <AlertDialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-2xl max-h-[90vh] overflow-y-auto z-50 flex flex-col gap-4 bg-background border border-border p-6 rounded-lg shadow-lg">
                <AlertDialogDescription className="sr-only">
                    Filament calibration wizard for measuring transmission distance (TD) values to improve auto-paint results
                </AlertDialogDescription>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCancel}
                    className="absolute right-3 top-3 h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="Close calibration wizard"
                >
                    <X className="h-4 w-4" />
                </Button>
                {step === 'intro' && renderIntro()}
                {step === 'print' && renderPrintInstructions()}
                {step === 'measure' && renderMeasurement()}
                {step === 'results' && renderResults()}
            </AlertDialogContent>
        </AlertDialog>
    );
}