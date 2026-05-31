const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugifyHeading(value: string): string {
    const normalized = value
        .normalize('NFKD')
        .replace(COMBINING_MARKS, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'section';
}

export function createSlugger() {
    const counts = new Map<string, number>();

    return (value: string) => {
        const base = slugifyHeading(value);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        return count === 0 ? base : `${base}-${count + 1}`;
    };
}
