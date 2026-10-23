import apiClient, { RESTAURANT_VERTICAL_KEY } from "@food/api/axios"
import { setAuthData } from "@food/utils/auth"

/**
 * Partner sign-up API. Stores use /qc/partner; restaurants keep their own
 * sign-up under /food/restaurant.
 *
 * Ecommerce sellers (type === "ecommerce") are routed at /ecommerce/partner
 * by the `prefixFor` below -- the cleaner fix the port's own instructions
 * asked for, parameterizing one API object rather than duplicating it.
 *
 * BLOCKED: Backend/src/modules/ecommerce has no /partner/* router at all (no
 * request-otp, verify-otp, web-login or application endpoints -- see
 * Backend/src/modules/ecommerce/seller/routes/seller.routes.js, which only
 * has register/onboarding-fee/unregistered/reverify). Every ecommerce call
 * below will 404 until that backend route exists. Left pointed at the
 * QC-shaped path under /ecommerce/partner as the most likely eventual shape
 * (same request/response contract QC already proved out), rather than
 * guessed at some other shape; flagged for human review.
 *
 * The onboarding token is sent explicitly and the request carries its own
 * context module, so the shared client never attaches a customer or admin login
 * that happens to be stored in this browser.
 */
const prefixFor = (type) => (type === "ecommerce" ? "/ecommerce/partner" : "/qc/partner")

const ctx = (token) => ({
  contextModule: "partner",
  ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
})

const unwrap = (res) => res?.data?.data ?? res?.data ?? {}

export const partnerApi = {
  requestOtp: (phone, type) =>
    apiClient.post(`${prefixFor(type)}/request-otp`, { phone, type }, ctx()).then(unwrap),
  verifyOtp: (phone, otp, type) =>
    apiClient.post(`${prefixFor(type)}/verify-otp`, { phone, otp, type }, ctx()).then(unwrap),
  /** Web dashboard sign-in: owner email + password; the OTP goes to the phone on file. */
  webLoginRequestOtp: (email, password, type) =>
    apiClient.post(`${prefixFor(type)}/web-login/request-otp`, { email, password, type }, ctx()).then(unwrap),
  webLoginResendOtp: (ticket, email, type) =>
    apiClient.post(`${prefixFor(type)}/web-login/resend-otp`, { ticket, email }, ctx()).then(unwrap),
  webLoginVerifyOtp: (ticket, email, otp, type) =>
    apiClient.post(`${prefixFor(type)}/web-login/verify-otp`, { ticket, email, otp, type }, ctx()).then(unwrap),
  getApplication: (token, type) => apiClient.get(`${prefixFor(type)}/application`, ctx(token)).then(unwrap),
  submitApplication: (token, body, type) =>
    apiClient.post(`${prefixFor(type)}/application`, body, ctx(token)).then(unwrap),
  upload: (token, file, type) => {
    const form = new FormData()
    form.append("file", file)
    return apiClient.post(`${prefixFor(type)}/upload`, form, ctx(token)).then(unwrap)
  },
}

export const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback

/*
 * Kept for the tab, not longer: the onboarding token lasts a few hours, and a
 * phone check is a few seconds, so there is nothing worth keeping past it.
 */
const KEY = "partner_session"

export const partnerSession = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null")
    } catch {
      return null
    }
  },
  set(value) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      // Private mode: the flow still works within this page load.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      // nothing to clear
    }
  },
}

export const PARTNER_TYPES = {
  restaurant: {
    label: "Restaurant",
    blurb: "Cloud kitchens, cafés and restaurants delivering food.",
  },
  store: {
    label: "Store",
    blurb: "Grocery, kirana, supermarket and daily essentials.",
  },
  ecommerce: {
    label: "Ecommerce Seller",
    blurb: "List products for courier-shipped, nationwide delivery.",
  },
}

/**
 * Sign an approved store into the web dashboard.
 *
 * The restaurant dashboard serves them too, against quick commerce: the mark
 * set here sends its requests to /qc (see RESTAURANT_VERTICAL_KEY in axios.js).
 * Set after setAuthData, which clears it for an ordinary restaurant login.
 */
export const openSellerDashboard = (session, navigate) => {
  setAuthData("restaurant", session.accessToken, session.user || null, session.refreshToken || null)
  try {
    localStorage.setItem(RESTAURANT_VERTICAL_KEY, "qc")
  } catch {
    // Without storage there is no session to keep either.
  }
  navigate("/food/restaurant", { replace: true })
}

export const PARTNER_APP_URL = "https://play.google.com/store/apps/details?id=com.gogo.restaurant"

/**
 * Sign an approved ecommerce seller into their own, separately-ported seller
 * dashboard at /ecommerce/seller (NOT /food/restaurant -- unlike the QC store
 * type, the ecommerce seller UI is not a reuse of Food's restaurant screens;
 * it is modules/Ecommerce's own SellerRouter, ported from warehouses'
 * Store/components/seller/SellerRouter).
 *
 * BLOCKED on the backend: Backend/src/modules/ecommerce/seller/routes/seller.routes.js
 * has no login route at all (register/onboarding-fee/unregistered/reverify
 * only -- no request-otp, verify-otp, web-login or application endpoint), and
 * Backend/src/core/auth/auth.routes.js mounts user/restaurant/delivery/admin
 * OTP login but no seller. core/auth/sellerWebLogin.js (the generic
 * email+password-then-OTP helper restaurants and QC stores both use) is never
 * wired up for the ecommerce Seller model. So this function has no session to
 * create yet -- PartnerLogin/PartnerApply/PartnerStatus will reach
 * partnerApi.requestOtp('ecommerce', ...) etc. below and 404, because those
 * routes do not exist on this backend. Needs a backend seller-auth route
 * before this flow can work end-to-end; flagged for human review rather than
 * invented here.
 */
export const openEcommerceSellerDashboard = (session, navigate) => {
  setAuthData("ecommerce_seller", session.accessToken, session.user || null, session.refreshToken || null)
  navigate("/ecommerce/seller", { replace: true })
}
