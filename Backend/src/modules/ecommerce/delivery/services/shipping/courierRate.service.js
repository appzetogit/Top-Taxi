import { getShippingProvider } from './index.js';
import { logger } from '../../../../../utils/logger.js';

/**
 * What the customer pays for courier delivery, taken from the courier's own rate for the
 * parcel (weight, from-pincode, to-pincode) plus the admin's margin and limits.
 *
 *   fee = courier rate x (1 + markupPercent / 100) + markupFlat, kept within minFee..maxFee
 *   and 0 when the order's items total reaches freeAboveSubtotal.
 *
 * Only with a real courier connected; with none (or when the courier cannot answer) the
 * caller keeps the admin's fixed fee / distance ranges, so an order is never blocked by it.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // route+weight -> { at, quote }

export const clearCourierRateCache = () => cache.clear();

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
// 100 g steps: the courier prices by weight slab, so a nearby weight reuses the same quote.
const bucket = (grams) => Math.max(1, Math.ceil((Number(grams) || 500) / 100));

export const isLiveCourierRate = (feeSettings = {}) => String(feeSettings?.courierRate?.mode || 'fixed') === 'live';

/** The courier's rate, cached for a while so a cart refresh does not call the courier every time. */
const courierQuote = async (provider, { originPincode, destPincode, weightGrams }) => {
    const key = `${originPincode}|${destPincode}|${bucket(weightGrams)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.quote;
    const quote = await provider.calculateRate({ originPincode, destPincode, weightGrams: bucket(weightGrams) * 100, cod: false });
    cache.set(key, { at: Date.now(), quote });
    return quote;
};

/** The admin's margin and limits applied to the courier's rate. Pure, for tests. */
export function feeFromCourierRate(rate, policy = {}, { subtotal = 0 } = {}) {
    const freeAbove = Number(policy.freeAboveSubtotal) || 0;
    if (freeAbove > 0 && Number(subtotal) >= freeAbove) return 0;
    let fee = Number(rate) * (1 + (Number(policy.markupPercent) || 0) / 100) + (Number(policy.markupFlat) || 0);
    const min = Number(policy.minFee) || 0;
    const max = Number(policy.maxFee) || 0;
    if (min > 0) fee = Math.max(fee, min);
    if (max > 0) fee = Math.min(fee, max);
    return round2(Math.max(0, fee));
}

/**
 * { ok: true, fee, courierRate, courierName, estimatedDays } or { ok: false, reason }.
 * ok:false means "use the admin's fixed fee instead".
 */
export async function quoteCourierDeliveryFee({ feeSettings, originPincode, destPincode, weightGrams, subtotal }) {
    if (!isLiveCourierRate(feeSettings)) return { ok: false, reason: 'fixed' };
    const provider = getShippingProvider();
    if (!provider || provider.name !== 'shiprocket') return { ok: false, reason: 'no_courier' };
    const from = String(originPincode || '').replace(/\D/g, '');
    const to = String(destPincode || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return { ok: false, reason: 'no_pincode' };
    try {
        const quote = await courierQuote(provider, { originPincode: from, destPincode: to, weightGrams });
        return {
            ok: true,
            fee: feeFromCourierRate(quote.rate, feeSettings.courierRate, { subtotal }),
            courierRate: round2(quote.rate),
            courierName: quote.courierName || '',
            estimatedDays: quote.estimatedDays || null,
        };
    } catch (error) {
        logger.warn(`Courier rate ${from}->${to} unavailable, using the fixed delivery fee: ${error.message}`);
        return { ok: false, reason: 'courier_error' };
    }
}
