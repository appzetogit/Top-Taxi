import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One rider, three rider records: the Shop (ecommerce) counterpart of
 * qcRiderLink.js, and built the same way.
 *
 * The ecommerce module keeps its own rider pool (ecom_delivery_partners) and
 * its own dispatcher, but the delivery app only ever signs in, goes online and
 * sends its location through the FOOD side. Nothing ever put an ecommerce
 * rider online, so a rider-delivered Shop order (fulfilmentMode 'quick') was
 * never offered to anyone.
 *
 * This links a Food rider to an ecommerce rider record of the same person
 * (same unified driver, or same phone), created on first use, so that:
 *   - the Food rider's online status and position are copied across, which is
 *     all ecommerce dispatch needs to find them -- it reads its own pool;
 *   - Shop offers reach the rider where the app listens (Food socket + push);
 *   - the Food rider endpoints can act on a Shop order as the linked rider.
 *
 * Every delivery-capable rider is enrolled; there is no separate capability.
 */

const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

const cache = new Map(); // key -> { value, at }
const TTL_MS = 60 * 1000;
const cached = async (key, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await load();
  if (value) cache.set(key, { value, at: Date.now() });
  return value;
};

const models = async () => {
  const [{ FoodDeliveryPartner: FoodRider }, { DeliveryPartner: EcomRider }] = await Promise.all([
    import('../../modules/food/delivery/models/deliveryPartner.model.js'),
    import('../../modules/ecommerce/delivery/models/deliveryPartner.model.js'),
  ]);
  return { FoodRider, EcomRider };
};

const ecomOrderModel = async () =>
  (await import('../../modules/ecommerce/orders/models/order.model.js')).Order;

/**
 * The ecommerce rider record for a Food rider, created when missing (same
 * name, phone and approval). Returns its id as a string, or null.
 *
 * The vehicle number is deliberately not copied: it is unique in the
 * ecommerce pool, and a standalone ecommerce rider may already hold it.
 */
export async function ecomRiderIdForFoodRider(foodRiderId) {
  if (!foodRiderId || !mongoose.Types.ObjectId.isValid(String(foodRiderId))) return null;
  return cached(`f2e:${foodRiderId}`, async () => {
    try {
      const { FoodRider, EcomRider } = await models();
      const food = await FoodRider.findById(foodRiderId)
        .select('name phone countryCode email vehicleType vehicleName status driverId')
        .lean();
      if (!food) return null;
      const phone = last10(food.phone);
      let ecom = null;
      if (food.driverId) ecom = await EcomRider.findOne({ driverId: food.driverId }).select('_id').lean();
      if (!ecom && phone) ecom = await EcomRider.findOne({ phone: { $regex: `${phone}$` } }).select('_id').lean();
      if (!ecom) {
        const created = await EcomRider.create({
          name: food.name || 'Rider',
          phone: food.phone,
          countryCode: food.countryCode || '+91',
          ...(food.email ? { email: food.email } : {}),
          vehicleType: food.vehicleType || '',
          vehicleName: food.vehicleName || '',
          status: food.status === 'approved' ? 'approved' : 'pending',
          ...(food.driverId ? { driverId: food.driverId } : {}),
        });
        ecom = { _id: created._id };
        logger.info(`[ecomRiderLink] created Shop rider ${created._id} for Food rider ${foodRiderId}`);
      }
      return String(ecom._id);
    } catch (err) {
      logger.warn(`[ecomRiderLink] link failed for Food rider ${foodRiderId}: ${err.message}`);
      return null;
    }
  });
}

/** The Food rider record for an ecommerce rider (same driver or phone), or null. */
export async function foodRiderIdForEcomRider(ecomRiderId) {
  if (!ecomRiderId || !mongoose.Types.ObjectId.isValid(String(ecomRiderId))) return null;
  return cached(`e2f:${ecomRiderId}`, async () => {
    try {
      const { FoodRider, EcomRider } = await models();
      const ecom = await EcomRider.findById(ecomRiderId).select('phone driverId').lean();
      if (!ecom) return null;
      let food = null;
      if (ecom.driverId) food = await FoodRider.findOne({ driverId: ecom.driverId }).select('_id').lean();
      const phone = last10(ecom.phone);
      if (!food && phone) food = await FoodRider.findOne({ phone: { $regex: `${phone}$` } }).select('_id').lean();
      return food ? String(food._id) : null;
    } catch (err) {
      logger.warn(`[ecomRiderLink] reverse link failed for Shop rider ${ecomRiderId}: ${err.message}`);
      return null;
    }
  });
}

/**
 * Whether an order id (mongo id or display id) is a Shop order. Callers check
 * Food and Quick first; ids are unique across collections, so this only has to
 * look in its own.
 */
export async function isEcomOrderId(orderId) {
  const raw = String(orderId || '').trim();
  if (!raw) return false;
  const Order = await ecomOrderModel();
  const filter = mongoose.Types.ObjectId.isValid(raw)
    ? { _id: new mongoose.Types.ObjectId(raw) }
    : { $or: [{ order_id: raw }, { orderId: raw }] };
  return Boolean(await Order.exists(filter));
}

/**
 * Send a Shop offer to the linked Food rider too: the Food socket room the
 * delivery app joins, and the Food rider's push tokens. Never throws.
 *
 * The push to the ecommerce rider id itself goes nowhere -- push tokens are
 * looked up on the Food rider model -- so this is the only push that lands.
 */
export async function mirrorEcomOfferToFoodRider(ecomRiderId, { event, payload, push } = {}) {
  try {
    const foodRiderId = await foodRiderIdForEcomRider(ecomRiderId);
    if (!foodRiderId) return false;
    const { getIO, rooms } = await import('../../config/socket.js');
    const io = getIO?.();
    // The app knows only its Food rider id: name the rider by that in the offer.
    const forApp = payload == null ? payload
      : JSON.parse(JSON.stringify(payload).split(String(ecomRiderId)).join(String(foodRiderId)));
    if (io && event) io.to(rooms.delivery(foodRiderId)).emit(event, forApp);
    if (push) {
      const { notifyOwnersActionableAlert } = await import('../notifications/firebase.service.js');
      const pushForApp = JSON.parse(JSON.stringify(push).split(String(ecomRiderId)).join(String(foodRiderId)));
      await notifyOwnersActionableAlert([{ ownerType: 'DELIVERY_PARTNER', ownerId: foodRiderId }], pushForApp);
    }
    return true;
  } catch (err) {
    logger.warn(`[ecomRiderLink] mirror offer to Food rider failed (${ecomRiderId}): ${err.message}`);
    return false;
  }
}

/**
 * Copy a Food rider's online status, position and approval to their Shop rider
 * record, so ecommerce dispatch (which only reads its own pool) can find them.
 * Called from syncQcRiderFromFood, i.e. on every go-online / heartbeat and on
 * every admin approve / reject / deactivate. Never throws.
 */
export async function syncEcomRiderFromFood(foodRiderId, { availabilityStatus, lat, lng, status } = {}) {
  try {
    const ecomId = await ecomRiderIdForFoodRider(foodRiderId);
    if (!ecomId) return false;
    const { EcomRider } = await models();
    const set = {};
    if (availabilityStatus) set.availabilityStatus = availabilityStatus;
    if (status) set.status = status;
    if (typeof lat === 'number' && typeof lng === 'number') {
      Object.assign(set, {
        lastLat: lat, lastLng: lng, lastLocationAt: new Date(),
        lastLocation: { type: 'Point', coordinates: [lng, lat] },
      });
    }
    if (Object.keys(set).length) await EcomRider.updateOne({ _id: ecomId }, { $set: set });
    return true;
  } catch (err) {
    logger.warn(`[ecomRiderLink] sync to Shop rider failed for ${foodRiderId}: ${err.message}`);
    return false;
  }
}

/*
 * One rider, one job across Food, Quick and Shop. Ecommerce dispatch's own
 * busy check only sees Shop orders, so a rider carrying a Food or Quick order
 * would otherwise be offered a Shop one too.
 */
const activeJobFilter = (partnerIds) => ({
  'dispatch.status': 'accepted',
  'dispatch.deliveryPartnerId': { $in: partnerIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
  orderStatus: { $nin: ['delivered', 'completed', 'rejected'], $not: /^cancel/ },
});

/** Of these Shop riders, the ids (strings) whose Food record is on a Food or Quick job. */
export async function ecomRidersOnOtherJobs(ecomRiderIds = []) {
  try {
    const pairs = (await Promise.all(ecomRiderIds.map(async (e) => [String(e), await foodRiderIdForEcomRider(e)])))
      .filter(([, f]) => f);
    if (!pairs.length) return new Set();
    const [{ FoodOrder }, { foodRidersOnQcJobs }] = await Promise.all([
      import('../../modules/food/orders/models/order.model.js'),
      import('./qcRiderLink.js'),
    ]);
    const foodIds = pairs.map(([, f]) => f);
    const rows = await FoodOrder.find(activeJobFilter(foodIds)).select('dispatch.deliveryPartnerId').lean();
    const busyFood = new Set(rows.map((r) => String(r.dispatch.deliveryPartnerId)));
    for (const f of await foodRidersOnQcJobs(foodIds)) busyFood.add(String(f));
    return new Set(pairs.filter(([, f]) => busyFood.has(f)).map(([e]) => e));
  } catch (err) {
    logger.warn(`[ecomRiderLink] busy check failed: ${err.message}`);
    return new Set();
  }
}

/** Whether this Food rider is carrying a Shop order. */
export async function foodRiderHasEcomJob(foodRiderId) {
  const ecomId = await ecomRiderIdForFoodRider(foodRiderId);
  if (!ecomId) return false;
  const Order = await ecomOrderModel();
  return Boolean(await Order.exists(activeJobFilter([ecomId])));
}
