import { useLocation } from "react-router-dom"

/**
 * This module is mounted once, at /admin/ecommerce, as Gogo's own single
 * "shop" (courier-shipped) commerce vertical -- quick-commerce (rider
 * delivery) is a separate vertical there (modules/quickCommerce), not a
 * second panel inside this one the way warehouses originally had it. The
 * :panel route segment below is kept only because ~170 routes are nested
 * under it; it now ever takes the one value "shop".
 */
export const ADMIN_PANELS = {
  shop: { key: "shop", label: "Shop", fulfilmentMode: "standard" },
}

export const DEFAULT_ADMIN_PANEL = "shop"

const ADMIN_BASE = "/admin/ecommerce"
const PANEL_PATH = /^\/admin\/ecommerce\/(shop)(?=\/|$)/

export function getAdminPanelFromPath(pathname = "") {
  const match = String(pathname).match(PANEL_PATH)
  return match ? match[1] : DEFAULT_ADMIN_PANEL
}

/** Path inside the panel, e.g. "/admin/ecommerce/shop/orders/all" -> "/orders/all" ("" for the dashboard). */
export function getAdminSubPath(pathname = "") {
  return String(pathname).replace(PANEL_PATH, "").replace(/\/+$/, "")
}

export function useAdminPanel() {
  const { pathname } = useLocation()
  const panel = getAdminPanelFromPath(pathname)
  return { panel, channel: panel, fulfilmentMode: ADMIN_PANELS[panel].fulfilmentMode, label: ADMIN_PANELS[panel].label }
}

/** "/admin/ecommerce/shop"; append sub-paths to it. */
export function useAdminBase() {
  return `${ADMIN_BASE}/${useAdminPanel().panel}`
}

/**
 * Re-roots an admin path onto the (one) panel. Paths built elsewhere (the
 * backend's global search, older notifications) still say /admin/store/...
 * or /admin/quick/... from before the channel collapse.
 */
export function toPanelPath(path, panel = DEFAULT_ADMIN_PANEL) {
  const value = String(path || "")
  if (!value.startsWith("/admin")) return value
  return value.replace(/^\/admin\/(ecommerce\/)?(store|food|quick|shop)(?=\/|\?|#|$)/, `${ADMIN_BASE}/${panel}`)
}
