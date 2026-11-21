// A Shop order from cart to courier, with the money checked at every step.
//   node tests/shop-order-e2e.smoke.mjs                       (mock courier)
//   LIVE=1 SR_EMAIL=... SR_PASS=... node tests/shop-order-e2e.smoke.mjs   (real Shiprocket: books, then cancels)
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const live = process.env.LIVE === '1';
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(mongod.getUri());

const imp = (p) => import(`../src/modules/ecommerce/${p}`);
const { setShippingProvider } = await imp('delivery/services/shipping/index.js');
const { MockShippingProvider } = await imp('delivery/services/shipping/mockShipping.provider.js');
const { ShiprocketProvider } = await imp('delivery/services/shipping/shiprocket.provider.js');
const { clearCourierRateCache } = await imp('delivery/services/shipping/courierRate.service.js');
const { Seller } = await imp('seller/models/seller.model.js');
const { Product } = await imp('admin/models/product.model.js');
const { FeeSettings } = await imp('admin/models/feeSettings.model.js');
const { Order } = await imp('orders/models/order.model.js');
const warehouses = await imp('seller/services/sellerWarehouse.service.js');
const orders = await imp('orders/services/order.service.js');
const { FoodUser } = await import('../src/core/users/user.model.js');

const provider = live
    ? new ShiprocketProvider({ email: process.env.SR_EMAIL, password: process.env.SR_PASS, pickupLocation: 'GOGO-TEST-1', pickupPincode: '452001' })
    : new MockShippingProvider();
setShippingProvider(provider);

const money = (n) => Math.round(n * 100) / 100;
const step = (s) => console.log(`\n== ${s}`);

// ---------------------------------------------------------------- seed
const sellerId = new mongoose.Types.ObjectId();
await Seller.collection.insertOne({
    _id: sellerId, status: 'approved', sellerName: 'Indore Gifts', ownerName: 'Ravi', ownerEmail: process.env.SR_EMAIL || 's@example.com',
    ownerPhone: '9425000001', isActive: true, isAcceptingOrders: true, pincode: '452001',
    location: { type: 'Point', coordinates: [75.8577, 22.7196], latitude: 22.7196, longitude: 75.8577, pincode: '452001', city: 'Indore', state: 'Madhya Pradesh', formattedAddress: 'Palasia, Indore' },
    shopChannel: { status: 'approved' }, createdAt: new Date(), updatedAt: new Date(),
});
const productId = new mongoose.Types.ObjectId();
await Product.collection.insertOne({
    _id: productId, sellerId, name: 'Ceramic Mug', price: 100, mrp: 120, isAvailable: true, approvalStatus: 'approved', stock: 50,
    weightGrams: 350, lengthCm: 12, breadthCm: 12, heightCm: 10, gstRate: 0, images: [], variants: [], categoryName: 'Home', createdAt: new Date(), updatedAt: new Date(),
});
const userId = new mongoose.Types.ObjectId();
await FoodUser.collection.insertOne({ _id: userId, name: 'Test Buyer', phone: '9425000002', countryCode: '+91', isActive: true, createdAt: new Date(), updatedAt: new Date() });

await FeeSettings.create({
    deliveryFee: 30, platformFee: 5, gstRate: 5, isActive: true,
    courierRate: { mode: 'live', markupPercent: 10, markupFlat: 0, freeAboveSubtotal: 1000, minFee: 30, maxFee: 0 },
});

step('seller adds a warehouse (registered with the courier)');
const warehouse = await warehouses.createWarehouse(String(sellerId), {
    name: 'Indore main', contactName: 'Ravi Seller', contactPhone: '9425000001',
    address1: 'Plot 12, Road 3, Palasia Square', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001',
});
assert.equal(warehouse.isDefault, true);

const addressFor = (zip, city, state, lat, lng) => ({
    label: 'Home', fullName: 'Test Buyer', name: 'Test Buyer', phone: '9425000002', street: 'Flat 4, Road 5, Test Nagar',
    city, state, zipCode: zip, location: { type: 'Point', coordinates: [lng, lat] }, latitude: lat, longitude: lng,
});
const indore = addressFor('452010', 'Indore', 'Madhya Pradesh', 22.7533, 75.8937);
const delhi = addressFor('110001', 'New Delhi', 'Delhi', 28.6328, 77.2197);

const quote = async (address, qty = 2) => orders.calculateOrder(String(userId), {
    sellerId: String(sellerId), items: [{ itemId: String(productId), quantity: qty }], address, deliveryAddress: address,
});

// ---------------------------------------------------------------- pricing
step('pricing: the delivery fee follows the courier rate for the route');
clearCourierRateCache();
const near = (await quote(indore)).pricing;
const far = (await quote(delhi)).pricing;
console.log('Indore  ->', JSON.stringify({ subtotal: near.subtotal, fee: near.deliveryFee, feeGst: near.deliveryFeeGst, platform: near.platformFee, tax: near.tax, total: near.total, src: near.deliveryFeeBreakdown?.source, rate: near.deliveryFeeBreakdown?.courierRate }));
console.log('Delhi   ->', JSON.stringify({ subtotal: far.subtotal, fee: far.deliveryFee, feeGst: far.deliveryFeeGst, platform: far.platformFee, tax: far.tax, total: far.total, src: far.deliveryFeeBreakdown?.source, rate: far.deliveryFeeBreakdown?.courierRate }));
assert.equal(near.subtotal, 200);
for (const p of [near, far]) {
    assert.equal(money(p.subtotal + p.deliveryFee + p.deliveryFeeGst + p.platformFee + p.tax - p.discount + (p.packagingFee || 0)), p.total, 'the total adds up');
    assert.equal(p.deliveryFeeGst, money(p.deliveryFee * 0.18), 'GST on the delivery fee is 18%');
}
if (live) {
    assert.equal(near.deliveryFeeBreakdown.source, 'courier');
    assert.ok(far.deliveryFee > near.deliveryFee, 'a farther destination costs more to deliver');
    assert.equal(near.deliveryFee, Math.max(30, money(near.deliveryFeeBreakdown.courierRate * 1.1)), 'courier rate + 10%, never below the minimum');
}

if (live) {
    step('free delivery above the admin threshold');
    const big = (await quote(indore, 11)).pricing; // 1100 >= 1000
    assert.equal(big.deliveryFee, 0);
    assert.equal(big.deliveryFeeGst, 0);
} else {
    assert.equal(near.deliveryFeeBreakdown.source, 'default_unmatched_range', 'with no real courier the fixed fee applies');
    assert.equal(near.deliveryFee, 30);
}

// ---------------------------------------------------------------- order (cash on delivery)
step('customer places a cash-on-delivery order');
const placed = await orders.createOrder(String(userId), {
    sellerId: String(sellerId), items: [{ itemId: String(productId), quantity: 2 }], address: delhi,
    paymentMethod: 'cash', customerName: 'Test Buyer', customerPhone: '9425000002', fulfilmentMode: 'standard',
});
const orderDoc = placed.order || placed;
const orderId = String(orderDoc._id || orderDoc.id);
let order = await Order.findById(orderId);
console.log('order', order.orderId, order.orderStatus, 'total', order.pricing.total, 'payment', order.payment.method, order.payment.status, 'due', order.payment.amountDue);
assert.equal(order.pricing.total, far.total, 'the charged total equals the quoted total');
assert.equal(order.payment.status, 'cod_pending');
assert.equal(order.payment.amountDue, far.total);

step('seller accepts and books the courier from their warehouse');
await orders.updateOrderStatusSeller(orderId, String(sellerId), 'confirmed');
const booked = await orders.createOrderShipmentSeller(orderId, String(sellerId));
order = await Order.findById(orderId);
console.log('booked', order.shipment.courierName, order.shipment.awb, 'from', order.shipment.pickupLocation, '| status', order.orderStatus);
assert.ok(order.shipment.awb);
assert.equal(order.shipment.warehouseId, warehouse.id);
assert.equal(order.orderStatus, 'ready_for_pickup');

if (live) {
    step('the booked courier is the one the fee was quoted from');
    console.log('quoted:', far.deliveryFeeBreakdown.courierName, far.deliveryFeeBreakdown.courierRate, '| booked:', order.shipment.courierName);
    assert.equal(String(order.shipment.courierName).trim().toLowerCase(), String(far.deliveryFeeBreakdown.courierName).trim().toLowerCase(), 'the cheapest quoted courier is booked');

    step('the courier is told to collect the order total');
    const token = await provider.authToken();
    const shown = (await (await fetch(`https://apiv2.shiprocket.in/v1/external/orders/show/${order.shipment.providerOrderId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
    console.log('courier collects', shown.total, '| payment', shown.payment_method);
    assert.equal(shown.payment_method, 'cod');
    assert.equal(money(Number(shown.total)), order.pricing.total, 'courier collects exactly what the customer owes');

    step('tracking from the courier');
    const tracking = await provider.trackShipment(order.shipment.awb);
    console.log('courier status:', tracking.currentStatus);
}

// ---------------------------------------------------------------- delivered + money
step('delivered: the order closes and the COD money is expected from the courier');
await Order.updateOne({ _id: order._id }, { $set: { 'shipment.status': 'delivered' } });
await orders.markOrderDeliveredAdmin(orderId, null, 'Courier reports delivered', { source: 'courier' });
order = await Order.findById(orderId);
console.log('after delivery:', order.orderStatus, '| payment', order.payment.status);
assert.equal(order.orderStatus, 'delivered');

const courierOps = await imp('orders/services/courierOps.service.js');
const outstanding = await courierOps.listCodOutstanding({});
const row = outstanding.rows.find((r) => r.orderId === (order.order_id || order.orderId));
assert.ok(row, 'the delivered COD order is listed as owed by the courier');
assert.equal(row.expected, order.pricing.total, 'the courier owes the full order total');

step('courier remits the money');
const remit = await courierOps.createRemittance({ courier: 'Test Courier', reference: `UTR-${Date.now()}`, date: new Date(), lines: [{ awb: order.shipment.awb, amount: order.pricing.total }] }, null);
console.log('remittance lines:', JSON.stringify((remit.remittance || remit).lines?.map((l) => [l.awb, l.status]) ?? remit));
order = await Order.findById(orderId);
assert.equal(order.shipment.codRemittance?.status, 'matched', 'the remittance matches the order exactly');
assert.equal((await courierOps.listCodOutstanding({})).rows.some((r) => r.orderId === (order.order_id || order.orderId)), false);

// ---------------------------------------------------------------- cleanup
if (live) {
    step('cleanup: cancel the real shipment');
    console.log(await provider.cancelShipment(order.shipment.providerOrderId));
}

console.log('\nshop-order-e2e: ok');
await mongoose.disconnect();
await mongod.stop();
process.exit(0);
