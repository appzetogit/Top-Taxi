import mongoose from 'mongoose';
import { Seller } from '../models/seller.model.js';
import { Zone } from '../../admin/models/zone.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { isPointInPolygon, toFiniteNumber, findZoneForPoint } from '../../shared/zoneServiceability.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Single-channel collapse (see admin/models/product.model.js and
 * seller/models/seller.model.js for the full rationale): warehouses had a
 * per-channel seller approval (apply / approve / reject) for Quick and Shop
 * independently. Gogo runs quick-commerce as its own separate vertical, so
 * only the Shop workflow survives here, and it no longer takes a `channel`
 * argument -- there is only one. `shopChannel` is the field this reads and
 * writes (it used to be `channels.shop`).
 */

const sellerPoint = (seller) => {
    const loc = seller?.location || {};
    const coords = Array.isArray(loc.coordinates) && loc.coordinates.length === 2 ? loc.coordinates : null;
    const lat = toFiniteNumber(loc.latitude ?? coords?.[1]);
    const lng = toFiniteNumber(loc.longitude ?? coords?.[0]);
    return lat !== null && lng !== null ? { lat, lng } : null;
};

export const sellerPincode = (seller) => String(seller?.location?.pincode || seller?.pincode || '').trim();

const hasPickupAddress = (seller) => {
    const loc = seller?.location || {};
    return Boolean(
        String(loc.addressLine1 || loc.address || loc.formattedAddress || seller?.addressLine1 || '').trim(),
    );
};

/** What a seller lacks to sell, as sentences. Empty = ready. */
export async function channelRequirementsMissing(seller) {
    const missing = [];
    if (!hasPickupAddress(seller)) missing.push('a pickup address');
    if (!/^\d{6}$/.test(sellerPincode(seller))) missing.push('a 6-digit pincode on the pickup address');
    return missing;
}

async function assertRequirements(seller) {
    const missing = await channelRequirementsMissing(seller);
    if (missing.length) {
        throw new ValidationError(`Selling needs ${missing.join(' and ')}`, { missing });
    }
}

const REQUIREMENT_FIELDS = 'zoneId location addressLine1 pincode status shopChannel sellerName profileImage';

/** POST /seller/channel/apply — none/rejected -> pending. */
export async function applyForChannel(sellerId) {
    const seller = await Seller.findById(sellerId).select(REQUIREMENT_FIELDS).lean();
    if (!seller) throw new NotFoundError('Store not found');

    const current = seller.shopChannel?.status || 'none';
    if (current === 'approved') throw new ValidationError('Your store is already approved to sell');
    if (current === 'pending') return { channel: 'shop', shopChannel: seller.shopChannel };

    await assertRequirements(seller);

    const now = new Date();
    const updated = await Seller.findOneAndUpdate(
        { _id: seller._id, 'shopChannel.status': { $in: ['none', 'rejected', null] } },
        {
            $set: {
                'shopChannel.status': 'pending',
                'shopChannel.appliedAt': now,
                'shopChannel.decidedAt': null,
                'shopChannel.rejectionReason': null,
            },
        },
        { new: true, runValidators: false },
    ).select('shopChannel sellerName').lean();
    const result = updated || (await Seller.findById(seller._id).select('shopChannel sellerName').lean());

    if (updated) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Store join request',
                body: `"${updated.sellerName}" wants to start selling.`,
                data: { type: 'channel_request', subType: 'seller', channel: 'shop', id: String(updated._id) },
            });
        } catch (err) {
            logger.warn(`channel request notification failed: ${err?.message || err}`);
        }
    }
    return { channel: 'shop', shopChannel: result?.shopChannel };
}

/** PATCH /admin/sellers/:id/channel — { action: 'approve'|'reject', reason? }. */
export async function decideSellerChannel(sellerId, body = {}) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) throw new ValidationError('Invalid seller id');
    const action = String(body?.action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(action)) throw new ValidationError("action must be 'approve' or 'reject'");
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (action === 'reject' && !reason) throw new ValidationError('A reason is required to reject a request');

    const seller = await Seller.findById(sellerId).select(REQUIREMENT_FIELDS).lean();
    if (!seller) throw new NotFoundError('Seller not found');
    if (action === 'approve') await assertRequirements(seller);

    const now = new Date();
    const updated = await Seller.findByIdAndUpdate(
        seller._id,
        {
            $set: {
                'shopChannel.status': action === 'approve' ? 'approved' : 'rejected',
                'shopChannel.decidedAt': now,
                'shopChannel.rejectionReason': action === 'approve' ? null : reason.slice(0, 500),
                ...(seller.shopChannel?.appliedAt ? {} : { 'shopChannel.appliedAt': now }),
            },
        },
        { new: true, runValidators: false },
    )
        .select('-__v')
        .populate('zoneId', 'name zoneName serviceLocation isActive')
        .lean();

    try {
        const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnersSafely(
            [{ ownerType: 'SELLER', ownerId: updated._id }],
            {
                title: action === 'approve' ? 'Approved to sell' : 'Request not approved',
                body: action === 'approve'
                    ? `"${updated.sellerName}" can now sell on the platform.`
                    : `Your request for "${updated.sellerName}" was rejected. Reason: ${reason}.`,
                data: {
                    type: action === 'approve' ? 'channel_approved' : 'channel_rejected',
                    channel: 'shop',
                    sellerId: String(updated._id),
                },
            },
        );
    } catch (err) {
        logger.warn(`channel decision notification failed: ${err?.message || err}`);
    }

    return updated;
}

const zoneLabel = (z) => (z ? String(z.name || z.zoneName || z.serviceLocation || 'Zone') : '');

/**
 * GET /admin/sellers/:id/zone-check — whether this store has a service zone
 * assigned and whether its map pin actually falls inside it.
 * `zoneForLocation` is the active zone that actually contains the store's map
 * pin (it may differ from the one assigned); `action` says what the admin can
 * do next:
 *   'none'         zone assignment is fine
 *   'assign_zone'  a zone covers the store; assign it
 *   'create_zone'  no zone covers the store's area yet
 *   'set_location' the store has no map location
 *
 * Zone assignment is not a selling gate in this single-channel module (that
 * was warehouses' Quick/rider concept -- Gogo's quick-commerce vertical has
 * its own); this just helps an admin keep a store's zone accurate for
 * delivery-estimate purposes (see catalog/services/deliveryEstimate.service.js).
 */
export async function zoneCheck(sellerId) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) throw new ValidationError('Invalid seller id');
    const seller = await Seller.findById(sellerId).select('zoneId location city area pincode sellerName').lean();
    if (!seller) throw new NotFoundError('Seller not found');

    const point = sellerPoint(seller);
    const loc = seller.location || {};
    const assignedId = seller.zoneId?._id || seller.zoneId;
    const assigned = assignedId && mongoose.Types.ObjectId.isValid(String(assignedId))
        ? await Zone.findById(assignedId).select('name zoneName serviceLocation coordinates isActive').lean()
        : null;
    const insideAssigned = Boolean(point && assigned && isPointInPolygon(point.lat, point.lng, assigned.coordinates || []));
    const covering = point ? await findZoneForPoint(point.lat, point.lng) : null;

    let action = 'none';
    if (!point) action = 'set_location';
    else if (!(assigned && assigned.isActive !== false && insideAssigned)) action = covering ? 'assign_zone' : 'create_zone';

    return {
        store: {
            area: loc.area || seller.area || '',
            city: loc.city || seller.city || '',
            pincode: sellerPincode(seller),
            latitude: point?.lat ?? null,
            longitude: point?.lng ?? null,
        },
        assignedZone: assigned ? { id: String(assigned._id), name: zoneLabel(assigned), isActive: assigned.isActive !== false } : null,
        insideAssigned,
        zoneForLocation: covering ? { id: String(covering._id), name: zoneLabel(covering) } : null,
        ready: action === 'none',
        action,
    };
}

/**
 * PATCH /admin/sellers/:id/zone { zoneId } — assigns the service zone. Only a
 * zone that contains the store's map pin is accepted, so an assignment can't
 * put a store where its riders can't reach.
 */
export async function assignSellerZone(sellerId, zoneId) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) throw new ValidationError('Invalid seller id');
    if (!zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) throw new ValidationError('Pick a zone');
    const seller = await Seller.findById(sellerId).select('zoneId location').lean();
    if (!seller) throw new NotFoundError('Seller not found');
    const zone = await Zone.findById(zoneId).select('name zoneName serviceLocation coordinates isActive').lean();
    if (!zone) throw new NotFoundError('Zone not found');
    if (zone.isActive === false) throw new ValidationError(`${zoneLabel(zone)} is switched off; turn it on first`);
    const point = sellerPoint(seller);
    if (!point) throw new ValidationError('Set the store location on the map first');
    if (!isPointInPolygon(point.lat, point.lng, zone.coordinates || [])) {
        throw new ValidationError(`The store is outside ${zoneLabel(zone)}. Pick the zone that covers it, or widen this zone.`);
    }
    await Seller.updateOne({ _id: seller._id }, { $set: { zoneId: zone._id } });
    return zoneCheck(sellerId);
}
