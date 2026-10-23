/**
 * Auth API. Gogo mounts one shared auth router for every vertical at
 * /v1/auth/* (see Backend/src/routes/index.js) -- there is no per-vertical
 * /ecommerce/auth/*, so these paths are NOT prefixed with /ecommerce.
 *
 * SELLER_REQUEST_OTP/SELLER_VERIFY_OTP have no backend route: core auth only
 * mounts user/restaurant/delivery/admin (Backend/src/core/auth/auth.routes.js),
 * and the ecommerce Seller model has no portalPassword/web-login wiring the
 * way core/auth/sellerWebLogin.js gives restaurants (see
 * Backend/src/modules/ecommerce/seller/routes/seller.routes.js -- register,
 * onboarding-fee and reverify only, no login route at all). An ecommerce
 * seller cannot sign in until the backend adds one. Left pointed at the
 * restaurant-shaped path as the most likely eventual shape; this call will
 * 404 until that backend route exists -- flagged in the port report.
 */

import apiClient from "@food/api/axios";

const AUTH = {
  USER_REQUEST_OTP: "/auth/user/request-otp",
  USER_VERIFY_OTP: "/auth/user/verify-otp",
  USER_EMAIL_REQUEST_OTP: "/auth/user/email/request-otp",
  USER_EMAIL_VERIFY_OTP: "/auth/user/email/verify-otp",
  ADMIN_LOGIN: "/auth/admin/login",
  // shortcut: no backend seller auth route exists yet; see module comment above.
  SELLER_REQUEST_OTP: "/auth/seller/request-otp",
  SELLER_VERIFY_OTP: "/auth/seller/verify-otp",
  DELIVERY_REQUEST_OTP: "/auth/delivery/request-otp",
  DELIVERY_VERIFY_OTP: "/auth/delivery/verify-otp",
  REFRESH_TOKEN: "/auth/refresh-token",
  LOGOUT: "/auth/logout",
  ME: "/auth/me",
};

/**
 * Normalize phone to digits only (for backend 8–15 digits).
 * @param {string} phone - e.g. "+91 9876543210" or "9876543210"
 */
function normalizePhone(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  return digits.slice(-15);
}

/** User phone: exactly 10 digits, numeric only. */
const USER_PHONE_LENGTH = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Request OTP for user login.
 * Validation: phone required, numeric only, exactly 10 digits (last 10 if country code included).
 * @param {string} phone - Phone (with or without country code, e.g. "+91 9876543210")
 * @returns {Promise<{ data }>}
 */
export function requestUserOtp(phone) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return Promise.reject(new Error("Phone number is required"));
  }
  if (!/^\d+$/.test(digits)) {
    return Promise.reject(new Error("Phone must contain only digits"));
  }
  const normalized =
    digits.length > USER_PHONE_LENGTH
      ? digits.slice(-USER_PHONE_LENGTH)
      : digits;
  if (normalized.length !== USER_PHONE_LENGTH) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  return apiClient.post(AUTH.USER_REQUEST_OTP, { phone: normalized });
}

/**
 * Verify OTP and login (user).
 * Validation: phone 10 digits, OTP required, exactly 4 digits numeric.
 * Backend returns { accessToken, refreshToken, user }.
 * @param {string} phone - Same format as request
 * @param {string} otp - 4-digit OTP only
 */
export function verifyUserOtp(
  phone,
  otp,
  ref,
  name = null,
  fcmToken = null,
  platform = "web",
) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return Promise.reject(new Error("Phone number is required"));
  }
  const normalized =
    digits.length > USER_PHONE_LENGTH
      ? digits.slice(-USER_PHONE_LENGTH)
      : digits;
  if (normalized.length !== USER_PHONE_LENGTH) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  const otpStr = String(otp ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  if (!otpStr) {
    return Promise.reject(new Error("OTP is required"));
  }
  if (otpStr.length !== 4) {
    return Promise.reject(new Error("OTP must be exactly 4 digits"));
  }
  const refValue = typeof ref === "string" ? ref.trim() : "";
  return apiClient.post(AUTH.USER_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(refValue ? { ref: refValue } : {}),
    ...(name ? { name } : {}),
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/** Lower-cased, trimmed email, or "" when it is not a valid address. */
function normalizeEmail(email) {
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  return EMAIL_REGEX.test(value) ? value : "";
}

/** Request a sign-in code by email (user). */
export function requestUserEmailOtp(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return Promise.reject(new Error("Please enter a valid email address"));
  }
  return apiClient.post(AUTH.USER_EMAIL_REQUEST_OTP, { email: normalized });
}

/**
 * Verify an emailed code and login (user). Same response as verifyUserOtp:
 * { accessToken, refreshToken, user, isNewUser }.
 */
export function verifyUserEmailOtp(
  email,
  otp,
  ref,
  name = null,
  fcmToken = null,
  platform = "web",
) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return Promise.reject(new Error("Please enter a valid email address"));
  }
  const otpStr = String(otp ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  if (otpStr.length !== 4) {
    return Promise.reject(new Error("OTP must be exactly 4 digits"));
  }
  const refValue = typeof ref === "string" ? ref.trim() : "";
  return apiClient.post(AUTH.USER_EMAIL_VERIFY_OTP, {
    email: normalized,
    otp: otpStr,
    ...(refValue ? { ref: refValue } : {}),
    ...(name ? { name } : {}),
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/**
 * Admin login (email + password).
 * Validation: email required and valid format, password required and min 6 characters.
 * Backend returns { accessToken, refreshToken, user } (key is "user" not "admin").
 */
export function adminLogin(email, password) {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!trimmedEmail) {
    return Promise.reject(new Error("Email is required"));
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return Promise.reject(new Error("Please enter a valid email address"));
  }
  const passwordStr = String(password ?? "");
  if (!passwordStr) {
    return Promise.reject(new Error("Password is required"));
  }
  if (passwordStr.length < 6) {
    return Promise.reject(new Error("Password must be at least 6 characters"));
  }
  return apiClient.post(AUTH.ADMIN_LOGIN, {
    email: trimmedEmail,
    password: passwordStr,
  });
}

/**
 * Refresh access token.
 * @param {string} refreshToken
 * @returns {Promise<{ data }>} data.accessToken
 */
export function refreshToken(refreshToken) {
  if (!refreshToken)
    return Promise.reject(new Error("Refresh token is required"));
  return apiClient.post(AUTH.REFRESH_TOKEN, { refreshToken });
}

/**
 * Logout (invalidate refresh token).
 * @param {string} refreshToken
 * @param {string} fcmToken
 * @param {string} platform
 */
export function logout(refreshToken, fcmToken = null, platform = "web") {
  if (!refreshToken) return Promise.resolve({ data: { success: true } });

  const payload = { refreshToken };
  if (fcmToken) {
    payload.fcmToken = fcmToken;
    payload.platform = platform;
  }

  return apiClient.post(AUTH.LOGOUT, payload);
}

/**
 * Get current profile (requires Bearer).
 * @param {string} [module] - "user" | "admin" | "seller" | "delivery" (which token to send; default "user")
 */
export function getMe(module = "user") {
  const m = String(module || "user");
  return apiClient.get(AUTH.ME, { contextModule: m });
}

/**
 * Seller OTP auth (backend: same phone format as user, 4-digit OTP e.g. 1234).
 */
export function requestSellerOtp(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return Promise.reject(new Error("Phone must be at least 8 digits"));
  }
  return apiClient.post(AUTH.SELLER_REQUEST_OTP, { phone: normalized });
}

export function verifySellerOtp(phone, otp, fcmToken = null, platform = "web") {
  const normalized = normalizePhone(phone);
  const otpStr = String(otp).replace(/\D/g, "").slice(0, 6);
  if (!normalized || otpStr.length < 4) {
    return Promise.reject(new Error("Phone and 4-digit OTP are required"));
  }
  return apiClient.post(AUTH.SELLER_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/**
 * Delivery partner OTP auth (backend: same phone + 4-digit OTP).
 */
export function requestDeliveryOtp(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return Promise.reject(new Error("Phone must be at least 8 digits"));
  }
  return apiClient.post(AUTH.DELIVERY_REQUEST_OTP, { phone: normalized });
}

export function verifyDeliveryOtp(phone, otp, fcmToken = null, platform = "web") {
  const normalized = normalizePhone(phone);
  const otpStr = String(otp).replace(/\D/g, "").slice(0, 6);
  if (!normalized || otpStr.length < 4) {
    return Promise.reject(new Error("Phone and 4-digit OTP are required"));
  }
  return apiClient.post(AUTH.DELIVERY_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}
