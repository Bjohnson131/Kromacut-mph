/**
 * Update Checker Component
 * 
 * Checks for new app updates when running in Tauri desktop app.
 * Displays a notification when a new version is available.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, X } from 'lucide-react';

declare global {
    interface Window {
        __TAURI__?: {
            core: {
                invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
            };
        };
    }
}

interface VersionInfo {
    version: string;
    download_url?: string;
    release_notes?: string;
}

export function UpdateChecker() {
    const [updateAvailable, setUpdateAvailable] = useState<VersionInfo | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        // Only check for updates in Tauri environment
        if (!window.__TAURI__) return;

        const checkForUpdates = async () => {
            setChecking(true);
            try {
                const currentVersion = await window.__TAURI__!.core.invoke<string>('get_app_version');
                const updateInfo = await window.__TAURI__!.core.invoke<VersionInfo | null>(
                    'check_for_updates',
                    { currentVersion }
                );

                if (updateInfo) {
                    setUpdateAvailable(updateInfo);
                }
            } catch (error) {
                console.error('Failed to check for updates:', error);
            } finally {
                setChecking(false);
            }
        };

        // Check for updates on mount
        checkForUpdates();

        // Check periodically (every 4 hours)
        const interval = setInterval(checkForUpdates, 4 * 60 * 60 * 1000);

        return () => clearInterval(interval);
    }, []);

    if (!window.__TAURI__ || !updateAvailable || dismissed || checking) {
        return null;
    }

    const handleDownload = () => {
        if (updateAvailable.download_url) {
            window.open(updateAvailable.download_url, '_blank');
        } else {
            window.open('https://github.com/vycdev/Kromacut/releases', '_blank');
        }
    };

    return (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
            <Card className="p-4 shadow-lg border-primary/50 bg-gradient-to-br from-primary/5 to-primary/10 max-w-sm">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                            <Download className="w-5 h-5 text-primary" />
                        </div>
                    </div>
                    <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between">
                            <h4 className="font-semibold text-sm text-foreground">
                                Update Available
                            </h4>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDismissed(true)}
                                className="h-5 w-5 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Version <span className="font-mono font-semibold text-foreground">{updateAvailable.version}</span> is now available!
                        </p>
                        {updateAvailable.release_notes && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                                {updateAvailable.release_notes}
                            </p>
                        )}
                        <div className="flex gap-2 pt-1">
                            <Button
                                size="sm"
                                onClick={handleDownload}
                                className="h-7 text-xs bg-primary hover:bg-primary/90"
                            >
                                Download
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDismissed(true)}
                                className="h-7 text-xs"
                            >
                                Later
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
