/**
 * Branding constants this module needs that Gogo's own config/env.js has no
 * equivalent for (no `config.brand` namespace exists anywhere in Gogo --
 * see modules/taxi/services/smsService.js for the same pattern, a local
 * `DEFAULT_BRAND_NAME` constant rather than a shared config field).
 *
 * Warehouses' original read these off its own `config.brand.*`; this module
 * reads them from its own env vars instead; set in .env.example.
 */
export const BRAND_NAME = process.env.ECOMMERCE_BRAND_NAME || 'Gogo';
export const BRAND_SUPPORT_EMAIL = process.env.ECOMMERCE_SUPPORT_EMAIL || 'support@example.com';
/** Fallback image for a push notification that has none of its own. */
export const BRAND_NOTIFICATION_IMAGE = process.env.ECOMMERCE_NOTIFICATION_IMAGE || '';
