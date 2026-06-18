import logoImage from '@/assets/logo.png';
import tdTestImage from '@/assets/tdTest.png';
import diagramWindowRun from '@/assets/diagrams/01_window_run_diagram.svg';
import diagramNozzleSwap from '@/assets/diagrams/02_nozzle_swap_schedule.svg';
import diagramBeerLambert from '@/assets/diagrams/03_beer_lambert_blending.svg';
import diagramComboSearch from '@/assets/diagrams/05_combo_search_space.svg';

const DOC_ASSETS: Record<string, string> = {
    'kromacut-logo.png': logoImage,
    'td-test.png': tdTestImage,
    '01_window_run_diagram.svg': diagramWindowRun,
    '02_nozzle_swap_schedule.svg': diagramNozzleSwap,
    '03_beer_lambert_blending.svg': diagramBeerLambert,
    '05_combo_search_space.svg': diagramComboSearch,
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
