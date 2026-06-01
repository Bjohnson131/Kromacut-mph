import type {
    MarkdownBlock,
    MarkdownInlineNode,
    MarkdownListItem,
    ParsedMarkdown,
    TocEntry,
} from '@/types/docs';
import { createSlugger } from './slug';

interface ParsedListLine {
    indent: number;
    ordered: boolean;
    content: string;
}

const headingPattern = /^(#{1,6})\s+(.+?)\s*#*$/;
const listPattern = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/;
const tableSeparatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function plainText(nodes: MarkdownInlineNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'text' || node.type === 'code') return node.value;
            if (node.type === 'image') return node.alt;
            return plainText(node.children);
        })
        .join('');
}

function findClosingParen(value: string, start: number): number {
    let escaped = false;
    for (let i = start; i < value.length; i++) {
        const char = value[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === ')') return i;
    }
    return -1;
}

function parseLinkDestination(raw: string): { href: string; title?: string } {
    const trimmed = raw.trim();
    const titleMatch = trimmed.match(/^(\S+)\s+["']([^"']+)["']$/);
    if (titleMatch) {
        return { href: titleMatch[1], title: titleMatch[2] };
    }
    return { href: trimmed };
}

export function parseInline(value: string): MarkdownInlineNode[] {
    const nodes: MarkdownInlineNode[] = [];
    let index = 0;

    const pushText = (text: string) => {
        if (!text) return;
        const last = nodes[nodes.length - 1];
        if (last?.type === 'text') {
            last.value += text;
        } else {
            nodes.push({ type: 'text', value: text });
        }
    };

    while (index < value.length) {
        if (value[index] === '\\' && index + 1 < value.length) {
            pushText(value[index + 1]);
            index += 2;
            continue;
        }

        if (value[index] === '`') {
            const end = value.indexOf('`', index + 1);
            if (end > index + 1) {
                nodes.push({ type: 'code', value: value.slice(index + 1, end) });
                index = end + 1;
                continue;
            }
        }

        if (value.startsWith('![', index)) {
            const labelEnd = value.indexOf(']', index + 2);
            if (labelEnd !== -1 && value[labelEnd + 1] === '(') {
                const hrefEnd = findClosingParen(value, labelEnd + 2);
                if (hrefEnd !== -1) {
                    const { href, title } = parseLinkDestination(
                        value.slice(labelEnd + 2, hrefEnd)
                    );
                    nodes.push({
                        type: 'image',
                        src: href,
                        alt: value.slice(index + 2, labelEnd),
                        title,
                    });
                    index = hrefEnd + 1;
                    continue;
                }
            }
        }

        if (value[index] === '[') {
            const labelEnd = value.indexOf(']', index + 1);
            if (labelEnd !== -1 && value[labelEnd + 1] === '(') {
                const hrefEnd = findClosingParen(value, labelEnd + 2);
                if (hrefEnd !== -1) {
                    const { href } = parseLinkDestination(value.slice(labelEnd + 2, hrefEnd));
                    nodes.push({
                        type: 'link',
                        href,
                        children: parseInline(value.slice(index + 1, labelEnd)),
                    });
                    index = hrefEnd + 1;
                    continue;
                }
            }
        }

        const strongMarker = value.startsWith('**', index)
            ? '**'
            : value.startsWith('__', index)
              ? '__'
              : undefined;
        if (strongMarker) {
            const end = value.indexOf(strongMarker, index + 2);
            if (end > index + 2) {
                nodes.push({
                    type: 'strong',
                    children: parseInline(value.slice(index + 2, end)),
                });
                index = end + 2;
                continue;
            }
        }

        const emphasisMarker =
            value[index] === '*' || value[index] === '_' ? value[index] : undefined;
        if (emphasisMarker) {
            const end = value.indexOf(emphasisMarker, index + 1);
            if (end > index + 1) {
                nodes.push({
                    type: 'emphasis',
                    children: parseInline(value.slice(index + 1, end)),
                });
                index = end + 1;
                continue;
            }
        }

        pushText(value[index]);
        index++;
    }

    return nodes;
}

function parseListLine(line: string): ParsedListLine | null {
    const match = line.match(listPattern);
    if (!match) return null;
    return {
        indent: match[1].replace(/\t/g, '    ').length,
        ordered: /^\d/.test(match[2]),
        content: match[3],
    };
}

function isBlockStart(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return (
        headingPattern.test(trimmed) ||
        trimmed.startsWith('```') ||
        /^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed) ||
        trimmed.startsWith('>') ||
        parseListLine(line) !== null
    );
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; next: number } {
    const first = parseListLine(lines[start]);
    if (!first) {
        return { block: { type: 'list', ordered: false, items: [] }, next: start + 1 };
    }

    const items: MarkdownListItem[] = [];
    let index = start;

    while (index < lines.length) {
        const parsed = parseListLine(lines[index]);
        if (!parsed || parsed.indent < first.indent || parsed.ordered !== first.ordered) break;

        if (parsed.indent > first.indent) {
            if (items.length === 0) break;
            const nested = parseList(lines, index);
            items[items.length - 1].nested.push(nested.block);
            index = nested.next;
            continue;
        }

        const parts = [parsed.content.trim()];
        index++;

        while (index < lines.length) {
            if (!lines[index].trim()) {
                index++;
                if (!lines[index]?.trim()) break;
                continue;
            }

            const nextParsed = parseListLine(lines[index]);
            if (nextParsed) {
                if (nextParsed.indent > first.indent) {
                    break;
                }
                break;
            }

            const indent = lines[index].match(/^\s*/)?.[0].replace(/\t/g, '    ').length ?? 0;
            if (indent <= first.indent) break;
            parts.push(lines[index].trim());
            index++;
        }

        items.push({
            children: parseInline(parts.join(' ')),
            nested: [],
        });
    }

    return {
        block: { type: 'list', ordered: first.ordered, items },
        next: index,
    };
}

function splitTableRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function parseTable(lines: string[], start: number): { block: MarkdownBlock; next: number } {
    const headers = splitTableRow(lines[start]).map(parseInline);
    const rows: MarkdownInlineNode[][][] = [];
    let index = start + 2;

    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]).map(parseInline));
        index++;
    }

    return {
        block: { type: 'table', headers, rows },
        next: index,
    };
}

function parseBlocks(lines: string[], start = 0, stopOnBlockquoteEnd = false) {
    const slugger = createSlugger();
    const blocks: MarkdownBlock[] = [];
    const toc: TocEntry[] = [];
    let index = start;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            index++;
            continue;
        }

        if (stopOnBlockquoteEnd && !trimmed.startsWith('>')) break;

        if (trimmed.startsWith('```')) {
            const language = trimmed.slice(3).trim() || undefined;
            const codeLines: string[] = [];
            index++;
            while (index < lines.length && !lines[index].trim().startsWith('```')) {
                codeLines.push(lines[index]);
                index++;
            }
            if (index < lines.length) index++;
            blocks.push({ type: 'code', language, value: codeLines.join('\n') });
            continue;
        }

        const heading = trimmed.match(headingPattern);
        if (heading) {
            const depth = heading[1].length;
            const children = parseInline(heading[2].trim());
            const text = plainText(children);
            const id = slugger(text);
            blocks.push({ type: 'heading', depth, id, children, text });
            toc.push({ id, title: text, depth });
            index++;
            continue;
        }

        if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) {
            blocks.push({ type: 'hr' });
            index++;
            continue;
        }

        if (trimmed.startsWith('>')) {
            const quoteLines: string[] = [];
            while (index < lines.length && lines[index].trim().startsWith('>')) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
                index++;
            }
            blocks.push({ type: 'blockquote', blocks: parseBlocks(quoteLines).blocks });
            continue;
        }

        if (parseListLine(line)) {
            const list = parseList(lines, index);
            blocks.push(list.block);
            index = list.next;
            continue;
        }

        if (
            line.includes('|') &&
            lines[index + 1] &&
            tableSeparatorPattern.test(lines[index + 1])
        ) {
            const table = parseTable(lines, index);
            blocks.push(table.block);
            index = table.next;
            continue;
        }

        const paragraphLines = [trimmed];
        index++;
        while (index < lines.length && !isBlockStart(lines[index])) {
            if (
                lines[index].includes('|') &&
                lines[index + 1] &&
                tableSeparatorPattern.test(lines[index + 1])
            ) {
                break;
            }
            paragraphLines.push(lines[index].trim());
            index++;
        }
        blocks.push({ type: 'paragraph', children: parseInline(paragraphLines.join(' ')) });
    }

    return { blocks, toc, next: index };
}

export function parseMarkdown(markdown: string): ParsedMarkdown {
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parsed = parseBlocks(normalized.split('\n'));
    return {
        blocks: parsed.blocks,
        toc: parsed.toc,
    };
}
