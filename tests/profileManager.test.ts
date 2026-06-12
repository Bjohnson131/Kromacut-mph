import test from 'node:test';
import assert from 'node:assert/strict';

import {
    profileFileName,
    renameProfile,
    parseHueForgeCSV,
    type AutoPaintProfile,
} from '../src/lib/profileManager.ts';

test('auto-paint profile exports use kfil filenames', () => {
    assert.equal(profileFileName('PLA Basic White'), 'PLA_Basic_White.kfil');
});

const HUEFORGE_CSV = `Brand, Type, Color, Name, TD, Tags, Secondary_Type, Secondary_Color, Secondary_Strength, Owned, Uuid
Inland Basic,PLA,#bf9c81,Light Brown,1.7,,None,#0000ff,0,true,{631cbb3a-9db8-45b4-96cd-5d21a5f3b2e9}
Overture Basic,PLA,#033877,Blue,3.5,,None,#0000ff,0,true,{c8518afd-068e-4a5c-90d2-9981d4d7edde}`;

test('parseHueForgeCSV returns null for empty input', () => {
    assert.equal(parseHueForgeCSV(''), null);
    assert.equal(parseHueForgeCSV('Brand, Type, Color'), null);
});

test('parseHueForgeCSV returns null when no valid filament rows', () => {
    const csv = `Brand, Type, Color, Name, TD, Tags, Secondary_Type, Secondary_Color, Secondary_Strength, Owned, Uuid
Inland Basic,PLA,,Light Brown,,,,,,true,{631cbb3a-9db8-45b4-96cd-5d21a5f3b2e9}`;
    assert.equal(parseHueForgeCSV(csv), null);
});

test('parseHueForgeCSV parses filaments from HueForge CSV', () => {
    const profiles = parseHueForgeCSV(HUEFORGE_CSV, 'My Spools');
    assert.ok(profiles);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, 'My Spools');
    assert.equal(profiles[0].filaments.length, 2);
});

test('parseHueForgeCSV maps color and TD correctly', () => {
    const [profile] = parseHueForgeCSV(HUEFORGE_CSV)!;
    const [first] = profile.filaments;
    assert.equal(first.color, '#bf9c81');
    assert.equal(first.td, 1.7);
});

test('parseHueForgeCSV strips braces from UUIDs', () => {
    const [profile] = parseHueForgeCSV(HUEFORGE_CSV)!;
    assert.equal(profile.filaments[0].id, '631cbb3a-9db8-45b4-96cd-5d21a5f3b2e9');
    assert.equal(profile.filaments[1].id, 'c8518afd-068e-4a5c-90d2-9981d4d7edde');
});

test('parseHueForgeCSV formats names as <mfr>-<color-name>-<color-hex>', () => {
    const [profile] = parseHueForgeCSV(HUEFORGE_CSV)!;
    assert.equal(profile.filaments[0].name, 'Inland Basic-Light Brown-#bf9c81');
    assert.equal(profile.filaments[1].name, 'Overture Basic-Blue-#033877');
});

test('parseHueForgeCSV preserves brand field', () => {
    const [profile] = parseHueForgeCSV(HUEFORGE_CSV)!;
    assert.equal(profile.filaments[0].brand, 'Inland Basic');
    assert.equal(profile.filaments[1].brand, 'Overture Basic');
});

test('parseHueForgeCSV handles columns in non-standard order', () => {
    const csv = `TD, Name, Uuid, Color, Brand, Type
1.7,Light Brown,{631cbb3a-9db8-45b4-96cd-5d21a5f3b2e9},#bf9c81,Inland Basic,PLA`;
    const [profile] = parseHueForgeCSV(csv)!;
    const [f] = profile.filaments;
    assert.equal(f.color, '#bf9c81');
    assert.equal(f.td, 1.7);
    assert.equal(f.brand, 'Inland Basic');
    assert.equal(f.name, 'Inland Basic-Light Brown-#bf9c81');
    assert.equal(f.id, '631cbb3a-9db8-45b4-96cd-5d21a5f3b2e9');
});

test('auto-paint profiles can be renamed without changing filament data', () => {
    const profiles: AutoPaintProfile[] = [
        {
            id: 'profile-1',
            name: 'Original Name',
            version: 1,
            createdAt: 1,
            updatedAt: 1,
            filaments: [{ id: 'filament-1', color: '#ffffff', td: 2.5 }],
        },
    ];

    const renamed = renameProfile(profiles, 'profile-1', '  New Name  ');

    assert.equal(renamed[0].name, 'New Name');
    assert.deepEqual(renamed[0].filaments, profiles[0].filaments);
    assert.ok(renamed[0].updatedAt >= profiles[0].updatedAt);
});
