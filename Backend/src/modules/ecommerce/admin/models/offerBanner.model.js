import mongoose from 'mongoose';

/**
 * Offer banners on the customer storefront (admin -> Promotions). Can carry
 * a coupon code: tapping the banner copies the code. Without a code,
 * ctaLink is opened instead.
 *
 * Single-channel collapse (see admin/models/product.model.js for the full
 * rationale): warehouses' original let a banner show on Quick, Shop or
 * both, via a `channels` array. This module serves one storefront, so
 * every banner shows there and `channels` is gone.
 */
const offerBannerSchema = new mongoose.Schema(
    {
        imageUrl: { type: String, required: true },
        title: { type: String, default: '', trim: true },
        subtitle: { type: String, default: '', trim: true },
        /** Optional coupon this banner promotes (an existing Offer's couponCode). */
        couponCode: { type: String, default: '', trim: true, uppercase: true },
        /** Optional in-app path or URL opened on tap when there is no coupon. */
        ctaLink: { type: String, default: '', trim: true },
        startDate: { type: Date, default: null },
        endDate: { type: Date, default: null },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { collection: 'ecom_offer_banners', timestamps: true }
);

offerBannerSchema.index({ isActive: 1, sortOrder: 1 });

export const OfferBanner = mongoose.models.EcomOfferBanner || mongoose.model('EcomOfferBanner', offerBannerSchema);

/** Design size: a wide card, 3:1. */
export const OFFER_BANNER_SIZE = { width: 1200, height: 400 };
