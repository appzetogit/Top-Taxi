import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Single-channel collapse (see admin/models/product.model.js for the full
 * rationale): warehouses' storefront had two fulfilment modes -- "quick"
 * (rider) and "standard" (courier/shop) -- and every catalogue read took an
 * optional `fulfilmentMode` to pick which one. Gogo already runs
 * quick-commerce as its own separate vertical, so this module only ever
 * serves the "standard" (shop) storefront: there is nothing left to switch
 * on, so `fulfilmentMode` is accepted (for callers that still pass it) but
 * does not change which products or sellers are returned.
 */
export const FULFILMENT_MODES = ['standard'];

/** `undefined`/''/null -> null (no filter); 'standard' is accepted; anything else is a 400. */
export function parseFulfilmentMode(value) {
    if (value === undefined || value === null || value === '') return null;
    const mode = String(value).trim().toLowerCase();
    if (!FULFILMENT_MODES.includes(mode)) {
        throw new ValidationError(`fulfilmentMode must be one of: ${FULFILMENT_MODES.join(', ')}`);
    }
    return mode;
}

/**
 * Product filter for a storefront. Always null: with a single channel, every
 * approved, available product is already in it -- there is no `channels.<c>`
 * / `availableIn.<c>` map left to filter on.
 */
export function fulfilmentModeProductFilter(_mode) {
    return null;
}

/**
 * Seller filter for a storefront. Always null, for the same reason: a
 * seller's `status: 'approved'` already means approved for the one channel
 * this module serves.
 */
export function fulfilmentModeSellerFilter(_mode) {
    return null;
}
