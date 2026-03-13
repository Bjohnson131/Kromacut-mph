import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, Wand2, FlaskConical, BadgeCheck } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Filament } from '../types';
import { estimateTDFromColor } from '../lib/colorUtils';
import { computeProfileConfidence, getConfidenceLabel, getConfidenceColor } from '../lib/calibration';

interface FilamentRowProps {
    filament: Filament;
    onUpdate: (id: string, updates: Partial<Omit<Filament, 'id'>>) => void;
    onRemove: (id: string) => void;
    onCalibrate?: (id: string) => void; // Optional calibration callback
}

const FilamentRow = React.memo(function FilamentRow({
    filament,
    onUpdate,
    onRemove,
    onCalibrate,
}: FilamentRowProps) {
    // Local state for the input value to allow free typing
    const [localTd, setLocalTd] = useState<string>(filament.td.toString());
    // Local state for color to allow smooth dragging without frequent parent updates
    const [localColor, setLocalColor] = useState<string>(filament.color);

    // Calculate confidence for this filament
    const calibrationMatchesTd =
        !!filament.calibration && Math.abs(filament.td - filament.calibration.tdSingleValue) < 0.05;
    const activeCalibration = calibrationMatchesTd ? filament.calibration : undefined;

    const confidence = computeProfileConfidence({
        calibration: activeCalibration,
        transmissionDistance: filament.td,
    });
    const confidenceLabel = getConfidenceLabel(confidence);
    const confidenceColorClass = getConfidenceColor(confidence);
    const isCalibrated = !!activeCalibration;

    // Sync local TD state if prop changes externally
    useEffect(() => {
        setLocalTd(filament.td.toString());
    }, [filament.td]);

    // Sync local color state if prop changes externally
    useEffect(() => {
        setLocalColor(filament.color);
    }, [filament.color]);

    // Debounced update for color
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localColor !== filament.color) {
                onUpdate(filament.id, { color: localColor });
            }
        }, 200);
        return () => clearTimeout(timer);
    }, [localColor, filament.id, filament.color, onUpdate]);

    const handleBlur = () => {
        let val = parseFloat(localTd);
        if (isNaN(val)) {
            setLocalTd(filament.td.toString());
            return;
        }
        val = Math.min(100, Math.max(0.1, val));
        onUpdate(filament.id, { td: val, calibration: undefined });
        setLocalTd(val.toString());
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleBlur();
            (e.target as HTMLInputElement).blur();
        }
    };

    return (
        <div className="flex items-center gap-2 p-2 rounded-md border border-border/40 bg-card hover:border-border/80 transition-colors">
            {/* Color Picker Popover */}
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="w-8 h-8 rounded-full border-2 border-border shadow-sm flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-transform hover:scale-105 cursor-pointer"
                        style={{ backgroundColor: localColor }}
                        title="Change filament color"
                    />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3" align="start">
                    <div className="space-y-3">
                        <h4 className="font-medium text-sm">Pick Color</h4>
                        <HexColorPicker color={localColor} onChange={setLocalColor} />
                        <div className="flex gap-2 items-center">
                            <span className="text-xs text-muted-foreground">Hex</span>
                            <Input
                                value={localColor}
                                onChange={(e) => setLocalColor(e.target.value)}
                                className="h-7 text-xs font-mono"
                            />
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Transmission Distance Input */}
            <div className="flex-1 min-w-0">
                <div className="relative">
                    <Input
                        type="number"
                        min={0.1}
                        max={100}
                        step={0.1}
                        value={localTd}
                        onChange={(e) => setLocalTd(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="h-8 text-sm pr-8"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                        TD
                    </div>
                </div>
            </div>

            {/* Auto-compute TD Button */}
            <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                    const estimatedTd = estimateTDFromColor(localColor);
                    setLocalTd(estimatedTd.toString());
                    onUpdate(filament.id, { td: estimatedTd, calibration: undefined });
                }}
                className="h-8 w-8 text-muted-foreground hover:text-amber-600 hover:bg-amber-600/10 cursor-pointer"
                title="Auto-estimate TD from color"
            >
                <Wand2 className="w-4 h-4" />
            </Button>

            {/* Calibration Button & Badge */}
            {onCalibrate && (
                <div className="flex items-center gap-1">
                    {isCalibrated && (
                        <div
                            className={`flex h-8 items-center gap-1 px-2 rounded-md bg-muted/50 ${confidenceColorClass}`}
                            title={`Confidence: ${confidenceLabel} (${(confidence * 100).toFixed(0)}%)`}
                        >
                            <BadgeCheck className="w-3 h-3" />
                            <span className="text-[10px] font-medium">{confidenceLabel}</span>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onCalibrate(filament.id)}
                        className={`h-8 w-8 cursor-pointer ${
                            isCalibrated
                                ? 'text-muted-foreground hover:text-blue-600 hover:bg-blue-600/10'
                                : 'text-muted-foreground hover:text-purple-600 hover:bg-purple-600/10'
                        }`}
                        title={isCalibrated ? 'Recalibrate filament' : 'Calibrate filament for accurate TD'}
                    >
                        <FlaskConical className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Delete Button */}
            <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(filament.id)}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                title="Remove filament"
            >
                <Trash2 className="w-4 h-4" />
            </Button>
        </div>
    );
});

export default FilamentRow;