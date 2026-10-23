// Ecommerce (standard/shop) module router.
//
// Mounted by master at /v1/ecommerce, so every path below is relative to
// that. This module was ported from a standalone ecommerce backend
// ("warehouses") and collapsed from its original dual quick/shop channel
// model down to a single "shop" (standard, courier-shipped) storefront --
// see admin/models/product.model.js for the full rationale. Gogo already
// runs quick-commerce as its own separate vertical (modules/quickCommerce),
// so this module does not reimplement it.
//
// Mount ORDER IS LOAD-BEARING, same discipline as modules/quickCommerce/routes/index.js:
//   - public GETs (storefront catalogue/landing reads) must stay reachable
//     without auth, and ahead of any authenticated block that would shadow them.
//   - the authenticated /admin block must come after its own public reads.
//   - a payments webhook (if any) must be mounted before a general /payments
//     prefix match, since router.use('/payments', authMiddleware, ...) would
//     otherwise 401 every provider callback -- see modules/quickCommerce's
//     own note on this. This module has no payments router of its own (see
//     below), so there is nothing to order here today, but the next payments
//     route added to this module must respect the same rule.
//
// Core reuse discipline (see modules/quickCommerce/FORK_COLLAPSE.md): this
// module imports Gogo's core/ directly by relative path. It does not fork
// auth, otp, payments or notifications into its own tree.

import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { requireServiceAccess } from '../../../core/roles/serviceAccess.middleware.js';
import { adminZoneScope } from '../../../core/admin/adminZoneScope.js';

import catalogRoutes from '../catalog/routes/catalog.routes.js';
import landingRoutes from '../landing/routes/landing.routes.js';
import shareLinksRoutes from '../landing/routes/shareLinks.routes.js';
import sellerRoutes from '../seller/routes/seller.routes.js';
import partnerRoutes from '../seller/routes/partner.routes.js';
import deliveryRoutes from '../delivery/routes/delivery.routes.js';
import userRoutes from '../user/routes/user.routes.js';
import orderUserRoutes from '../orders/routes/order.routes.user.js';
import chatRoutes from '../chat/routes/chat.routes.js';
import adminRoutes from '../admin/routes/admin.routes.js';

const router = express.Router();

router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'UP', message: 'Ecommerce module is healthy' });
});

// ─── Public storefront reads ───────────────────────────────────────────────
// Stores, products, categories, offers, search, delivery estimate: every
// read here is public (see catalog/routes/catalog.routes.js for the list).
router.use('/catalog', catalogRoutes);
// Landing content (hero banners, explore icons, etc.) and the share-link
// landing pages (Open Graph preview + deep link for a shared seller/product).
router.use('/', landingRoutes);
router.use('/', shareLinksRoutes);

// ─── Seller sign-up / sign-in ───────────────────────────────────────────────
// Phone+OTP covers both: a new number gets an onboarding token to apply with,
// an approved one gets a session. Web (email+password+OTP) login is for an
// already-approved seller's dashboard. Registration also still works directly
// at /seller/register below (multipart, used by the seller's own app).
router.use('/partner', partnerRoutes);

// ─── Seller (store) panel ──────────────────────────────────────────────────
// seller.routes.js applies its own authMiddleware + requireSeller per route
// (it also exposes a few public reads of its own, e.g. categories), so it is
// mounted bare rather than behind one router-wide auth gate.
router.use('/seller', sellerRoutes);

// ─── Delivery partner (courier) ────────────────────────────────────────────
// delivery.routes.js applies its own authMiddleware per route for the same
// reason as seller.routes.js (registration and a few public reads happen
// before a partner has a token).
router.use('/delivery', deliveryRoutes);

// ─── Customer account + cart ───────────────────────────────────────────────
router.use('/user', authMiddleware, requireRoles('USER'), userRoutes);

// ─── Orders (customer-facing) ──────────────────────────────────────────────
router.use('/orders', authMiddleware, requireRoles('USER'), orderUserRoutes);

// ─── Chat ───────────────────────────────────────────────────────────────────
// Order chat: customer <-> seller/delivery partner, and support threads with
// ADMIN. Every role that can appear on an order is admitted; the service
// itself refuses any pair that does not share one.
router.use('/chat', authMiddleware, requireRoles('USER', 'SELLER', 'DELIVERY_PARTNER', 'ADMIN'), chatRoutes);

// ─── Admin panel ────────────────────────────────────────────────────────────
// admin.routes.js mounts its own public GETs ahead of nothing -- the whole
// router is authenticated -- so the service-scoping chain below matches
// every other vertical's exact shape (modules/food/admin, modules/quickCommerce).
router.use(
    '/admin',
    authMiddleware,
    requireRoles('ADMIN'),
    requireServiceAccess('ecommerce'),
    adminZoneScope('ecommerce'),
    adminRoutes,
);

export default router;
