const KEY = 'kromacut:3d-camera-mode';

export function loadCameraMode(): boolean {
    return localStorage.getItem(KEY) === 'orthographic';
}

export function saveCameraMode(isOrtho: boolean): void {
    localStorage.setItem(KEY, isOrtho ? 'orthographic' : 'perspective');
}
