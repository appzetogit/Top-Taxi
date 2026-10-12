import { ValidationError } from '../../../../../core/auth/errors.js';

/**
 * What kind of shop a quick-commerce seller is.
 *
 * Kept pure so onboarding, the admin panel and the order path all get the same
 * answer. The types differ in catalogue and pooling, not in what they must
 * produce at onboarding.
 */

export const STORE_TYPES = Object.freeze([
    'grocery',
    'kirana',
    'supermarket',
    'pet',
    'electronics',
    'stationery',
    'general',
]);

export const DEFAULT_STORE_TYPE = 'grocery';

/** Labels for the admin panel, so the copy lives with the rule rather than in a screen. */
export const STORE_TYPE_LABELS = Object.freeze({
    grocery: 'Grocery',
    kirana: 'Kirana',
    supermarket: 'Supermarket',
    pet: 'Pet Supplies',
    electronics: 'Electronics',
    stationery: 'Stationery',
    general: 'General Store',
});

/** Returns undefined when the caller sent nothing, so a partial update leaves it alone. */
export const normalizeStoreTypeInput = (value) => {
    if (value === undefined) return undefined;
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return DEFAULT_STORE_TYPE;
    if (!STORE_TYPES.includes(raw)) {
        throw new ValidationError(`Store type must be one of: ${STORE_TYPES.join(', ')}`);
    }
    return raw;
};

/**
 * Merge a partial update over what is stored, so callers can validate the outcome
 * rather than the request. Only the fields this module owns.
 */
export const mergeStoreTypeUpdate = (existing = {}, updates = {}) => ({
    storeType: updates.storeType !== undefined ? updates.storeType : (existing.storeType || DEFAULT_STORE_TYPE),
});
