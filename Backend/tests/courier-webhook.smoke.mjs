// The courier's status callback: guarded by a token, finds the parcel by AWB, and reads the
// real status from the courier (it never trusts the body).
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.SHIPPING_WEBHOOK_TOKEN = 'test-token-123';
const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());

const { setShippingProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/index.js');
const { MockShippingProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/mockShipping.provider.js');
const { Order } = await import('../src/modules/ecommerce/orders/models/order.model.js');
const webhook = (await import('../src/modules/ecommerce/orders/routes/courierUpdates.webhook.routes.js')).default;

const provider = new MockShippingProvider();
setShippingProvider(provider);
const shipment = await provider.createShipment({ orderId: 'X' });

const orderId = new mongoose.Types.ObjectId();
await Order.collection.insertOne({
    _id: orderId, orderId: 'ORD-WH-1', fulfilmentMode: 'standard', orderStatus: 'ready_for_pickup',
    sellerId: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), customerName: 'B', customerPhone: '9425000002',
    deliveryAddress: { location: { type: 'Point', coordinates: [75.89, 22.75] }, street: 'Flat 4', city: 'Indore', state: 'MP', zipCode: '452010' },
    items: [{ itemId: 'p1', name: 'Mug', price: 100, quantity: 1 }], pricing: { subtotal: 100, total: 100 }, payment: { method: 'razorpay' },
    shipment: { awb: shipment.awb, status: 'manifested', lastTrackedAt: null }, createdAt: new Date(), updatedAt: new Date(),
});

const app = express();
app.use(express.json());
app.use('/webhooks', webhook);
const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}/webhooks/courier-updates`;
const post = (headers, body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

assert.equal((await post({}, { awb: shipment.awb })).status, 401, 'no token is refused');
assert.equal((await post({ 'x-api-key': 'wrong' }, { awb: shipment.awb })).status, 401, 'wrong token is refused');
assert.equal((await post({ 'x-api-key': 'test-token-123' }, {})).status, 200, 'a test call with no AWB is accepted');
assert.equal((await post({ 'x-api-key': 'test-token-123' }, { awb: 'NOPE' })).status, 200, 'an unknown AWB is accepted and ignored');
assert.equal((await post({ authorization: 'Bearer test-token-123' }, { awb: 'NOPE' })).status, 200, 'Authorization header works too');

assert.equal((await post({ 'x-api-key': 'test-token-123' }, { awb: shipment.awb, current_status: 'DELIVERED' })).status, 200);
for (let i = 0; i < 30; i++) {
    const o = await Order.collection.findOne({ _id: orderId });
    if (o.shipment?.lastTrackedAt) break;
    await new Promise((r) => setTimeout(r, 100));
}
const after = await Order.collection.findOne({ _id: orderId });
assert.ok(after.shipment.lastTrackedAt, 'the parcel was re-read from the courier');
assert.equal(after.shipment.awb, shipment.awb);

delete process.env.SHIPPING_WEBHOOK_TOKEN;
assert.equal((await post({ 'x-api-key': 'test-token-123' }, { awb: shipment.awb })).status, 503, 'not set up -> 503');

console.log('courier-webhook: ok');
server.close();
await mongoose.disconnect();
await mongod.stop();
