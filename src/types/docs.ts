export interface DocMeta {
    slug: string;
    title: string;
    description?: string;
    order: number;
    sourcePath: string;
}

export interface TocEntry {
    id: string;
    title: string;
    depth: number;
}

export type MarkdownInlineNode =
    | { type: 'text'; value: string }
    | { type: 'strong'; children: MarkdownInlineNode[] }
    | { type: 'emphasis'; children: MarkdownInlineNode[] }
    | { type: 'code'; value: string }
    | { type: 'link'; href: string; children: MarkdownInlineNode[] }
    | { type: 'image'; src: string; alt: string; title?: string };

export interface MarkdownListItem {
    children: MarkdownInlineNode[];
    nested: MarkdownBlock[];
}

export type MarkdownBlock =
    | { type: 'heading'; depth: number; id: string; children: MarkdownInlineNode[]; text: string }
    | { type: 'paragraph'; children: MarkdownInlineNode[] }
    | { type: 'blockquote'; blocks: MarkdownBlock[] }
    | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
    | { type: 'code'; language?: string; value: string }
    | { type: 'table'; headers: MarkdownInlineNode[][]; rows: MarkdownInlineNode[][][] }
    | { type: 'hr' };

export interface ParsedMarkdown {
    blocks: MarkdownBlock[];
    toc: TocEntry[];
}

export interface DocRecord {
    meta: DocMeta;
    content: string;
    blocks: MarkdownBlock[];
    toc: TocEntry[];
}

export interface DocLinkTarget {
    docSlug: string;
    headingSlug?: string;
}

export interface MarkdownRendererProps {
    doc: DocRecord;
    docs: DocRecord[];
    activeHeading?: string;
    onNavigate: (target: DocLinkTarget) => void;
}
