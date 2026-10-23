import { useCallback, useMemo } from "react"

// Collapsed to single-channel "shop" storefront: the backend dropped the
// quick-commerce fulfilment mode for this module (Gogo runs quick-commerce
// as its own separate vertical). Kept as a hook/API so callers that destructure
// mode/isQuick/storePath do not need to change -- it just always resolves "shop".
// shortcut: quick mode permanently disabled here; remove this shim entirely
// and inline "shop" at call sites if nothing ever needs the other branch back.
export function getStoreModeFromPath() {
  return "shop"
}

export function fulfilmentModeFor() {
  return "standard"
}

export function cartStorageKeyFor() {
  return "cart"
}

export const CART_STORAGE_KEYS = ["cart"]

// Prefix a storefront path; shop mode never rewrites it.
export function storePathFor(_mode, path = "/") {
  return path.startsWith("/") ? path : `/${path}`
}

export function useStoreMode() {
  const storePath = useCallback((path) => storePathFor("shop", path), [])
  return useMemo(
    () => ({
      mode: "shop",
      isQuick: false,
      fulfilmentMode: "standard",
      basePath: "",
      storePath,
    }),
    [storePath],
  )
}
