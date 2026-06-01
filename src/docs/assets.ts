import logoImage from '@/assets/logo.png';
import tdTestImage from '@/assets/tdTest.png';

const DOC_ASSETS: Record<string, string> = {
    'kromacut-logo.png': logoImage,
    'td-test.png': tdTestImage,
};

export function resolveDocAsset(src: string): string | undefined {
    const explicitMatch = Object.keys(DOC_ASSETS).find((key) => src.includes(key));
    if (explicitMatch) return DOC_ASSETS[explicitMatch];

    const clean = src
        .trim()
        .replace(/^\.?\//, '')
        .split(/\s+/)[0]
        .replace(/^["']|["']$/g, '');
    return DOC_ASSETS[clean];
}
