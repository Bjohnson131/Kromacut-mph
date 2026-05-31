import type { DocMeta, DocRecord } from '@/types/docs';
import { parseMarkdown } from './markdown';
import { slugifyHeading } from './slug';

interface FrontmatterResult {
    attributes: Record<string, string>;
    body: string;
}

function parseFrontmatter(raw: string): FrontmatterResult {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return { attributes: {}, body: normalized.trim() };
    }

    const end = normalized.indexOf('\n---', 4);
    if (end === -1) {
        return { attributes: {}, body: normalized.trim() };
    }

    const attributes: Record<string, string> = {};
    const frontmatter = normalized.slice(4, end).split('\n');
    frontmatter.forEach((line) => {
        const separator = line.indexOf(':');
        if (separator === -1) return;
        const key = line.slice(0, separator).trim();
        const value = line
            .slice(separator + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
        if (key) attributes[key] = value;
    });

    return {
        attributes,
        body: normalized.slice(end + 4).trim(),
    };
}

function firstHeadingTitle(body: string): string | undefined {
    const match = body.match(/^#\s+(.+)$/m);
    return match?.[1].trim();
}

export function createDocRecord(sourcePath: string, raw: string): DocRecord {
    const { attributes, body } = parseFrontmatter(raw);
    const title = attributes.title || firstHeadingTitle(body) || 'Untitled';
    const slug = attributes.slug || slugifyHeading(title);
    const order = Number.parseInt(attributes.order ?? '999', 10);
    const parsed = parseMarkdown(body);

    const meta: DocMeta = {
        slug,
        title,
        description: attributes.description,
        order: Number.isFinite(order) ? order : 999,
        sourcePath,
    };

    return {
        meta,
        content: body,
        blocks: parsed.blocks,
        toc: parsed.toc,
    };
}
