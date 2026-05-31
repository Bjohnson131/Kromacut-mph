import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docs, defaultDocSlug } from '@/docs';
import type { DocLinkTarget, DocRecord, TocEntry } from '@/types/docs';
import { buildDocsHash, parseDocsHash } from '@/lib/docs/navigation';
import MarkdownRenderer from './MarkdownRenderer';

function getInitialTarget(): DocLinkTarget {
    if (typeof window === 'undefined') return { docSlug: defaultDocSlug };
    return parseDocsHash(window.location.hash) ?? { docSlug: defaultDocSlug };
}

function findDoc(slug: string): DocRecord {
    const doc = docs.find((entry) => entry.meta.slug === slug) ?? docs[0];
    if (!doc) {
        throw new Error('No documentation files were bundled.');
    }
    return doc;
}

function tocIndent(entry: TocEntry) {
    return Math.max(0, entry.depth - 1) * 12;
}

export default function DocsPage() {
    const initialTarget = useMemo(getInitialTarget, []);
    const [activeDocSlug, setActiveDocSlug] = useState(initialTarget.docSlug);
    const [pendingHeading, setPendingHeading] = useState(initialTarget.headingSlug);
    const [activeHeading, setActiveHeading] = useState(initialTarget.headingSlug);
    const scrollRef = useRef<HTMLElement | null>(null);

    const activeDoc = findDoc(activeDocSlug);

    const navigate = useCallback((target: DocLinkTarget) => {
        const nextDoc = findDoc(target.docSlug);
        setActiveDocSlug(nextDoc.meta.slug);
        setPendingHeading(target.headingSlug);
        setActiveHeading(target.headingSlug);
        window.history.pushState(null, '', buildDocsHash(nextDoc.meta.slug, target.headingSlug));
    }, []);

    useEffect(() => {
        const onHashChange = () => {
            const target = parseDocsHash(window.location.hash);
            if (!target) return;
            const nextDoc = findDoc(target.docSlug);
            setActiveDocSlug(nextDoc.meta.slug);
            setPendingHeading(target.headingSlug);
            setActiveHeading(target.headingSlug);
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    useEffect(() => {
        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        window.setTimeout(() => {
            if (pendingHeading) {
                const heading = document.getElementById(pendingHeading);
                if (heading) {
                    heading.scrollIntoView({ block: 'start' });
                    return;
                }
            }
            scrollElement.scrollTo({ top: 0 });
        }, 0);
    }, [activeDoc.meta.slug, pendingHeading]);

    useEffect(() => {
        const root = scrollRef.current;
        if (!root || activeDoc.toc.length === 0) return;

        const headings = activeDoc.toc
            .map((entry) => document.getElementById(entry.id))
            .filter((element): element is HTMLElement => element !== null);
        if (headings.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]?.target.id) {
                    setActiveHeading(visible[0].target.id);
                }
            },
            {
                root,
                rootMargin: '0px 0px -65% 0px',
                threshold: [0, 1],
            }
        );

        headings.forEach((heading) => observer.observe(heading));
        return () => observer.disconnect();
    }, [activeDoc]);

    return (
        <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground lg:flex-row">
            <nav
                aria-label="Documentation"
                className="max-h-48 flex-shrink-0 overflow-y-auto border-b border-border bg-card/70 px-4 py-4 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r"
            >
                <div className="mb-3">
                    <h2 className="text-sm font-semibold text-foreground">Docs</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        User guide for turning images into printable color layers.
                    </p>
                </div>
                <div className="space-y-1">
                    {docs.map((doc) => {
                        const selected = doc.meta.slug === activeDoc.meta.slug;
                        return (
                            <a
                                key={doc.meta.slug}
                                href={buildDocsHash(doc.meta.slug)}
                                onClick={(event) => {
                                    event.preventDefault();
                                    navigate({ docSlug: doc.meta.slug });
                                }}
                                className={`block rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                                    selected
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-foreground hover:bg-muted'
                                }`}
                                aria-current={selected ? 'page' : undefined}
                            >
                                <span className="block text-sm font-semibold">
                                    {doc.meta.title}
                                </span>
                                {doc.meta.description && (
                                    <span
                                        className={`mt-1 block text-xs leading-5 ${
                                            selected
                                                ? 'text-primary-foreground/80'
                                                : 'text-muted-foreground'
                                        }`}
                                    >
                                        {doc.meta.description}
                                    </span>
                                )}
                            </a>
                        );
                    })}
                </div>
            </nav>

            <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
                <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
                    <MarkdownRenderer
                        doc={activeDoc}
                        docs={docs}
                        activeHeading={activeHeading}
                        onNavigate={navigate}
                    />
                </div>
            </main>

            <aside className="max-h-44 flex-shrink-0 overflow-y-auto border-t border-border bg-card/70 px-4 py-4 lg:max-h-none lg:w-64 lg:border-l lg:border-t-0">
                <nav aria-label="Current document headings">
                    <h2 className="text-sm font-semibold text-foreground">On This Page</h2>
                    <div className="mt-3 space-y-1">
                        {activeDoc.toc.map((entry) => {
                            const selected = entry.id === activeHeading;
                            return (
                                <a
                                    key={entry.id}
                                    href={buildDocsHash(activeDoc.meta.slug, entry.id)}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        navigate({
                                            docSlug: activeDoc.meta.slug,
                                            headingSlug: entry.id,
                                        });
                                    }}
                                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                                        selected
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                    }`}
                                    style={{ paddingLeft: `${8 + tocIndent(entry)}px` }}
                                    aria-current={selected ? 'location' : undefined}
                                >
                                    {entry.title}
                                </a>
                            );
                        })}
                    </div>
                </nav>
            </aside>
        </div>
    );
}
