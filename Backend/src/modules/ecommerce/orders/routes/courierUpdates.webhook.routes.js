import crypto from 'node:crypto';
import express from 'express';
import { Order } from '../models/order.model.js';
import { trackShipmentAdmin } from '../services/shipmentAdmin.service.js';
import { logger } from '../../../../utils/logger.js';

/*
 * The courier calls this when a parcel's status changes, so delivered / failed
 * delivery / return updates reach the order at once instead of at the next poll.
 *
 * Open access (the courier has no login), so it is guarded by a shared token the
 * courier sends in a header (x-api-key, or Authorization). The body is only used to
 * find the parcel by its AWB: the status itself is then read from the courier with
 * the same call the admin's Track button uses, so a forged or odd payload can never
 * set a status by itself.
 *
 * The path must not contain the courier's name (their webhook form refuses it).
 */
const router = express.Router();

const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest();

const tokenOk = (req) => {
    const expected = process.env.SHIPPING_WEBHOOK_TOKEN || '';
    if (!expected) return false;
    const sent = String(req.get('x-api-key') || req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    return crypto.timingSafeEqual(digest(sent), digest(expected));
};

// A burst of updates for one parcel is read once at a time.
const inFlight = new Set();

router.post('/courier-updates', async (req, res) => {
    if (!process.env.SHIPPING_WEBHOOK_TOKEN) return res.status(503).json({ success: false, message: 'Courier updates are not set up.' });
    if (!tokenOk(req)) return res.status(401).json({ success: false, message: 'Invalid token.' });

    // Answer at once: the courier retries a slow reply and floods us.
    res.status(200).json({ success: true });

    try {
        const body = req.body || {};
        if (body.is_return === 1 || body.is_return === '1' || body.is_return === true) return;
        const awb = String(body.awb || body.AWB || body.awb_code || '').trim();
        if (!awb || inFlight.has(awb)) return;
        const order = await Order.findOne({ 'shipment.awb': awb }).select('_id').lean();
        if (!order) return;
        inFlight.add(awb);
        try {
            await trackShipmentAdmin(String(order._id), null);
        } finally {
            inFlight.delete(awb);
        }
    } catch (err) {
        logger.warn(`Courier update could not be applied: ${err?.message || err}`);
    }
});

export default router;
