import type { DocLinkTarget, DocRecord } from '@/types/docs';

function cleanDocSlug(value: string): string {
    return value
        .trim()
        .replace(/^\.?\//, '')
        .replace(/\.md$/i, '')
        .replace(/^docs\//, '');
}

function splitDocAndHeading(value: string): { docPart: string; headingPart?: string } {
    const [docPart, ...headingParts] = value.split('#');
    const headingPart = headingParts.join('#') || undefined;
    return { docPart, headingPart };
}

function safeDecodeURIComponent(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export function buildDocsHash(docSlug: string, headingSlug?: string): string {
    const encodedDoc = encodeURIComponent(docSlug);
    const encodedHeading = headingSlug ? `#${encodeURIComponent(headingSlug)}` : '';
    return `#docs/${encodedDoc}${encodedHeading}`;
}

export function parseDocsHash(hash: string): DocLinkTarget | null {
    const raw = hash.replace(/^#/, '');
    if (!raw.startsWith('docs/')) return null;

    const { docPart, headingPart } = splitDocAndHeading(raw.slice('docs/'.length));
    const decodedDocPart = safeDecodeURIComponent(docPart);
    if (decodedDocPart === null) return null;

    const decodedHeading = headingPart ? safeDecodeURIComponent(headingPart) : undefined;
    if (decodedHeading === null) return null;

    const docSlug = cleanDocSlug(decodedDocPart);
    if (!docSlug) return null;

    return {
        docSlug,
        headingSlug: decodedHeading,
    };
}

export function resolveDocHref(
    href: string,
    currentDocSlug: string,
    docs: DocRecord[]
): DocLinkTarget | null {
    const trimmed = href.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('#')) {
        const headingSlug = trimmed.slice(1);
        return headingSlug ? { docSlug: currentDocSlug, headingSlug } : { docSlug: currentDocSlug };
    }

    const { docPart, headingPart } = splitDocAndHeading(trimmed);
    const docSlug = cleanDocSlug(docPart);
    if (!docSlug) return null;

    const found = docs.some((doc) => doc.meta.slug === docSlug);
    if (!found) return null;

    return {
        docSlug,
        headingSlug: headingPart,
    };
}

export function isSafeExternalHref(href: string): boolean {
    return /^(https?:|mailto:)/i.test(href.trim());
}
