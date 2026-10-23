/**
 * Safe seller logout — thin wrapper around shared module logout.
 * Keeps existing `@ecommerce/utils/sellerLogout` imports working.
 */

export { logoutSellerSession } from "@ecommerce/utils/moduleLogout";
