/**
 * What a partner has to hand over before it can be approved, in one list.
 *
 * The /partner website, the partner app and the admin review page all show this
 * same list, and registration and approval enforce it, so the three can never
 * disagree about what is missing. Pure -- no database -- so it can be tested on
 * its own.
 *
 * Two partner types:
 *   restaurant  -- the food vertical, which has its own onboarding; listed here
 *                  only so /partner can route to it
 *   store       -- a quick-commerce seller (grocery, supermarket, ...)
 *
 * No list is enforced today. A store's list is shown as a checklist but not
 * refused on, because store sign-ups already in the field (and older app
 * builds) send less than this, and blocking them is not what anyone asked for.
 */
import { ValidationError } from '../../../../../core/auth/errors.js';

export const PARTNER_TYPES = Object.freeze(['restaurant', 'store']);

export const normalizePartnerType = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'quick' || raw === 'qc' || raw === 'grocery') return 'store';
    return PARTNER_TYPES.includes(raw) ? raw : null;
};

/** Which partner type an existing quick-commerce seller is. */
export const partnerTypeOfSeller = (_seller) => 'store';

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const has = (v) => text(v) !== '';

const BASIC = [
    { key: 'restaurantName', section: 'basic', label: 'Store name', done: (s) => has(s.restaurantName) },
    { key: 'ownerName', section: 'basic', label: 'Owner name', done: (s) => has(s.ownerName) },
    { key: 'ownerPhone', section: 'basic', label: 'Mobile number', done: (s) => has(s.ownerPhone) },
    { key: 'ownerEmail', section: 'basic', label: 'Email', optional: true, done: (s) => has(s.ownerEmail) },
    {
        key: 'address',
        section: 'basic',
        label: 'Store address',
        done: (s) => has(s.location?.addressLine1 || s.addressLine1 || s.location?.formattedAddress)
            && has(s.location?.city || s.city),
    },
    {
        key: 'location',
        section: 'basic',
        label: 'Location on map',
        done: (s) => {
            const c = s.location?.coordinates;
            return Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(Number(n)))
                && !(Number(c[0]) === 0 && Number(c[1]) === 0);
        },
    },
];

const BANK = [
    { key: 'accountHolderName', section: 'bank', label: 'Account holder name', done: (s) => has(s.accountHolderName) },
    { key: 'accountNumber', section: 'bank', label: 'Account number', done: (s) => has(s.accountNumber) },
    { key: 'ifscCode', section: 'bank', label: 'IFSC code', done: (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(text(s.ifscCode)) },
    { key: 'upiId', section: 'bank', label: 'UPI ID', optional: true, done: (s) => has(s.upiId) },
];

const PHOTOS = (frontRequired) => [
    { key: 'storePhotos.front', section: 'photos', label: 'Front / entrance photo', optional: !frontRequired, done: (s) => has(s.storePhotos?.front) },
    { key: 'storePhotos.inside', section: 'photos', label: 'Inside the store photo', optional: true, done: (s) => has(s.storePhotos?.inside) },
    { key: 'storePhotos.signboard', section: 'photos', label: 'Signboard photo', optional: true, done: (s) => has(s.storePhotos?.signboard) },
];

const STORE_DOCUMENTS = [
    { key: 'panNumber', section: 'documents', label: 'PAN number', optional: true, done: (s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(text(s.panNumber)) },
    { key: 'panImage', section: 'documents', label: 'PAN card photo', optional: true, done: (s) => has(s.panImage) },
    { key: 'fssaiImage', section: 'documents', label: 'FSSAI licence', optional: true, done: (s) => has(s.fssaiImage) },
    {
        key: 'gstImage',
        section: 'documents',
        label: 'GST certificate',
        optional: true,
        requiredWhen: (s) => s.gstRegistered === true,
        done: (s) => has(s.gstImage) && has(s.gstNumber),
    },
];

export const SECTION_LABELS = Object.freeze({
    basic: 'Basic details',
    documents: 'Documents',
    photos: 'Store photos',
    bank: 'Bank details',
});

const listFor = (type) => {
    if (type === 'store') return [...BASIC, ...STORE_DOCUMENTS, ...PHOTOS(false), ...BANK];
    return [];
};

/** Is this list enforced at registration and approval? No partner type's is today. */
export const isEnforced = (_type) => false;

/**
 * Every item on the list for this partner type, with whether it is done.
 * `missing` holds the labels of required items not yet done.
 */
export function evaluateApplication(type, seller = {}, now = new Date()) {
    const s = seller || {};
    const items = listFor(type).map((item) => {
        const required = item.requiredWhen ? item.requiredWhen(s) : !item.optional;
        return {
            key: item.key,
            section: item.section,
            label: item.label,
            required,
            done: Boolean(item.done(s, now)),
        };
    });
    const missing = items.filter((i) => i.required && !i.done).map((i) => i.label);
    return { type, items, missing, complete: missing.length === 0 };
}

/** Refuse an application missing something required. Names what is missing. */
export function assertApplicationComplete(type, seller, now = new Date()) {
    if (!isEnforced(type)) return;
    const { missing } = evaluateApplication(type, seller, now);
    if (missing.length === 0) return;
    const shown = missing.slice(0, 4).join(', ');
    const more = missing.length > 4 ? ` and ${missing.length - 4} more` : '';
    throw new ValidationError(`Still needed before this store can be approved: ${shown}${more}.`);
}

/**
 * Where a partner stands, for routing: `new` has no account, the rest follow
 * the seller's status.
 */
export function partnerStateOf(seller) {
    if (!seller) return 'new';
    const status = String(seller.status || 'pending');
    return ['pending', 'rejected', 'approved'].includes(status) ? status : 'pending';
}
