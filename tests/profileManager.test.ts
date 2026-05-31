import test from 'node:test';
import assert from 'node:assert/strict';

import { profileFileName } from '../src/lib/profileManager.ts';

test('auto-paint profile exports use kfil filenames', () => {
    assert.equal(profileFileName('PLA Basic White'), 'PLA_Basic_White.kfil');
});
