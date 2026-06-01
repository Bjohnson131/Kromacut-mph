import type { DocRecord } from '@/types/docs';
import { createDocRecord } from '@/lib/docs/metadata';

const modules = import.meta.glob('./*.md', {
    eager: true,
    query: '?raw',
    import: 'default',
});

export const docs: DocRecord[] = Object.entries(modules)
    .map(([sourcePath, content]) => createDocRecord(sourcePath, String(content)))
    .sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));

export const defaultDocSlug = docs[0]?.meta.slug ?? 'overview';
