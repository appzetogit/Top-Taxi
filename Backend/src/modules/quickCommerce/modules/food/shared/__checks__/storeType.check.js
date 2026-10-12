/**
 * Self-check for quick-commerce store types.
 * Run: node src/modules/quickCommerce/modules/food/shared/__checks__/storeType.check.js
 */
import assert from 'node:assert/strict';
import {
    DEFAULT_STORE_TYPE,
    STORE_TYPES,
    mergeStoreTypeUpdate,
    normalizeStoreTypeInput,
} from '../storeType.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

// --- store type normalization --------------------------------------------
assert.equal(normalizeStoreTypeInput(undefined), undefined);     // partial update untouched
assert.equal(normalizeStoreTypeInput(''), DEFAULT_STORE_TYPE);
assert.equal(normalizeStoreTypeInput(' GROCERY '), 'grocery');
assert.equal(normalizeStoreTypeInput('Kirana'), 'kirana');
throws(() => normalizeStoreTypeInput('hospital'), /Store type must be one of/);
assert.equal(STORE_TYPES.includes(DEFAULT_STORE_TYPE), true);

// --- merge -----------------------------------------------------------------
assert.equal(mergeStoreTypeUpdate({ storeType: 'kirana' }, {}).storeType, 'kirana');
assert.equal(mergeStoreTypeUpdate({ storeType: 'kirana' }, { storeType: 'pet' }).storeType, 'pet');
// Absent storeType on a fresh record falls back to the default.
assert.equal(mergeStoreTypeUpdate({}, {}).storeType, DEFAULT_STORE_TYPE);

console.log('All store-type checks passed.');
