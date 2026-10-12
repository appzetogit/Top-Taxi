/**
 * Quick-commerce store types.
 *
 * Mirrors Backend/src/modules/quickCommerce/modules/food/shared/storeType.js. The
 * server is the authority -- it revalidates every write -- this exists so the admin
 * sees the right options.
 *
 * The food admin and the quick-commerce admin are the same screens on two routes,
 * so anything store-type related has to render only under /admin/quick-commerce.
 */

export const STORE_TYPES = [
  { value: 'grocery', label: 'Grocery' },
  { value: 'kirana', label: 'Kirana' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'pet', label: 'Pet Supplies' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'general', label: 'General Store' },
]

export const DEFAULT_STORE_TYPE = 'grocery'

export const storeTypeLabel = (value) =>
  STORE_TYPES.find((t) => t.value === value)?.label || value || ''

/**
 * True while the admin is in the quick-commerce vertical.
 *
 * Keyed on the browser path, the same signal the axios interceptor uses to swap
 * /v1/food/admin for /v1/qc/admin, so the UI and the API it talks to can never
 * disagree about which vertical is on screen.
 */
export const isQuickCommerceAdminPath = (pathname) =>
  String(pathname || (typeof window !== 'undefined' ? window.location.pathname : ''))
    .startsWith('/admin/quick-commerce')
