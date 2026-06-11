import test from 'node:test';
import assert from 'node:assert/strict';

import {
    profileFileName,
    renameProfile,
    type AutoPaintProfile,
} from '../src/lib/profileManager.ts';

test('auto-paint profile exports use kfil filenames', () => {
    assert.equal(profileFileName('PLA Basic White'), 'PLA_Basic_White.kfil');
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
