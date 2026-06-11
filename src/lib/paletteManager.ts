import type { CustomPalette } from '../types';

export const CURRENT_PALETTE_VERSION = 1;

const PALETTES_STORAGE_KEY = 'kromacut.palettes';
const LAST_PALETTE_KEY = 'kromacut.palettes.lastId';
const SELECTED_PALETTE_KEY = 'kromacut.palettes.selected';

/* ---------------------------------------------------------------------------
 * localStorage helpers
 * --------------------------------------------------------------------------- */

export function loadCustomPalettes(): CustomPalette[] {
    try {
        const raw = localStorage.getItem(PALETTES_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as CustomPalette[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (p) => typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.colors)
        );
    } catch {
        return [];
    }
}

export function saveCustomPalettes(palettes: CustomPalette[]) {
    try {
        localStorage.setItem(PALETTES_STORAGE_KEY, JSON.stringify(palettes));
    } catch {
        // ignore storage errors
    }
}

export function loadLastCustomPaletteId(): string | null {
    try {
        return localStorage.getItem(LAST_PALETTE_KEY);
    } catch {
        return null;
    }
}

export function saveLastCustomPaletteId(id: string | null) {
    try {
        if (id) {
            localStorage.setItem(LAST_PALETTE_KEY, id);
        } else {
            localStorage.removeItem(LAST_PALETTE_KEY);
        }
    } catch {
        // ignore
    }
}

export function loadSelectedPalette(): string | null {
    try {
        return localStorage.getItem(SELECTED_PALETTE_KEY);
    } catch {
        return null;
    }
}

export function saveSelectedPalette(id: string) {
    try {
        localStorage.setItem(SELECTED_PALETTE_KEY, id);
    } catch {
        // ignore
    }
}

/* ---------------------------------------------------------------------------
 * CRUD
 * --------------------------------------------------------------------------- */

export function createCustomPalette(name: string, colors: string[]): CustomPalette {
    const now = Date.now();
    return {
        id: crypto.randomUUID(),
        name: name.trim(),
        version: CURRENT_PALETTE_VERSION,
        colors: [...colors],
        createdAt: now,
        updatedAt: now,
    };
}

export function updateCustomPalette(
    palettes: CustomPalette[],
    id: string,
    patch: { name?: string; colors?: string[] }
): CustomPalette[] {
    return palettes.map((p) =>
        p.id === id
            ? {
                  ...p,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.colors !== undefined ? { colors: [...patch.colors] } : {}),
                  updatedAt: Date.now(),
              }
            : p
    );
}

export function deleteCustomPalette(palettes: CustomPalette[], id: string): CustomPalette[] {
    return palettes.filter((p) => p.id !== id);
}

/* ---------------------------------------------------------------------------
 * Import / export
 * --------------------------------------------------------------------------- */

/** Check if two color arrays are identical (order-sensitive). */
function colorsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());
}

/** Derive a unique name by appending a numeric suffix if it already exists. */
function deduplicateName(name: string, existing: CustomPalette[]): string {
    const names = new Set(existing.map((p) => p.name));
    if (!names.has(name)) return name;
    let suffix = 2;
    while (names.has(`${name} (${suffix})`)) suffix++;
    return `${name} (${suffix})`;
}

export interface ImportPaletteResult {
    palettes: CustomPalette[];
    imported: CustomPalette[];
    skipped: string[];
    overwritten: string[];
    renamed: string[];
}

/**
 * Import palettes with duplicate prevention:
 * - ID match: overwrite
 * - Content match (same colors): skip
 * - Name match (different content): rename with numeric suffix
 */
export function importCustomPalettes(
    existing: CustomPalette[],
    incoming: CustomPalette[]
): ImportPaletteResult {
    const result: ImportPaletteResult = {
        palettes: [...existing],
        imported: [],
        skipped: [],
        overwritten: [],
        renamed: [],
    };

    for (const raw of incoming) {
        if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.colors)) continue;

        const validColors = raw.colors.filter((c) => typeof c === 'string');

        const now = Date.now();
        const palette: CustomPalette = {
            id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
            name: raw.name,
            version: typeof raw.version === 'number' ? raw.version : CURRENT_PALETTE_VERSION,
            colors: validColors,
            createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
            updatedAt: now,
        };

        // 1. ID match → overwrite
        const idMatch = result.palettes.findIndex((p) => p.id === palette.id);
        if (idMatch !== -1) {
            result.palettes[idMatch] = { ...palette, updatedAt: now };
            result.overwritten.push(palette.name);
            result.imported.push(result.palettes[idMatch]);
            continue;
        }

        // 2. Content match (same colors) → skip
        const contentMatch = result.palettes.find((p) => colorsEqual(p.colors, validColors));
        if (contentMatch) {
            result.skipped.push(`${palette.name} (matches "${contentMatch.name}")`);
            continue;
        }

        // 3. Name match → rename
        const nameMatch = result.palettes.some((p) => p.name === palette.name);
        if (nameMatch) {
            palette.name = deduplicateName(palette.name, result.palettes);
            result.renamed.push(palette.name);
        }

        result.palettes.push(palette);
        result.imported.push(palette);
    }

    return result;
}

/**
 * Parse a JSON string into an array of custom palettes.
 * Accepts a single palette object or an array.
 */
export function parseCustomPaletteFile(json: string): CustomPalette[] | null {
    try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.colors)) {
            return [parsed as CustomPalette];
        }
        return null;
    } catch {
        return null;
    }
}

/** Build an export blob for a custom palette. */
export function exportCustomPaletteBlob(palette: CustomPalette): Blob {
    return new Blob([JSON.stringify(palette, null, 2)], {
        type: 'application/json',
    });
}

/** Sanitize a name for use as a filename. */
export function customPaletteFileName(name: string): string {
    return `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.kpal`;
}
