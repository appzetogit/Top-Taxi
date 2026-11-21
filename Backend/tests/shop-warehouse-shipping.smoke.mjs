// Seller warehouses and courier booking from them.
//   node tests/shop-warehouse-shipping.smoke.mjs            (mock courier)
//   LIVE=1 SR_EMAIL=... SR_PASS=... node tests/shop-warehouse-shipping.smoke.mjs
// LIVE registers a real pickup address and books + cancels a real shipment.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri());

const { setShippingProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/index.js');
const { MockShippingProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/mockShipping.provider.js');
const { ShiprocketProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/shiprocket.provider.js');
const wh = await import('../src/modules/ecommerce/seller/services/sellerWarehouse.service.js');
const { bookOrderShipment } = await import('../src/modules/ecommerce/orders/services/order.service.js');
const { Order } = await import('../src/modules/ecommerce/orders/models/order.model.js');
const { Seller } = await import('../src/modules/ecommerce/seller/models/seller.model.js');
const { Product } = await import('../src/modules/ecommerce/admin/models/product.model.js');

const live = process.env.LIVE === '1';
const provider = live
    ? new ShiprocketProvider({ email: process.env.SR_EMAIL, password: process.env.SR_PASS, pickupLocation: 'GOGO-TEST-1', pickupPincode: '452001' })
    : new MockShippingProvider();
setShippingProvider(provider);

const sellerId = new mongoose.Types.ObjectId();
await Seller.collection.insertOne({ _id: sellerId, ownerEmail: process.env.SR_EMAIL || 'seller@example.com' });
const productId = new mongoose.Types.ObjectId();
await Product.collection.insertOne({ _id: productId, name: 'Mug', weightGrams: 350, lengthCm: 12, breadthCm: 12, heightCm: 10 });

const form = {
    name: 'Indore main', contactName: 'Ravi Seller', contactPhone: '9425000001',
    address1: 'Plot 12, Road 3, Palasia Square', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001',
};

// validation
await assert.rejects(wh.createWarehouse(sellerId, { ...form, pincode: '12' }), /pincode/i);
await assert.rejects(wh.createWarehouse(sellerId, { ...form, contactPhone: '123' }), /mobile/i);
if (live) await assert.rejects(wh.createWarehouse(sellerId, { ...form, address1: 'Test Warehouse, Palasia' }), /courier did not accept/i);

// create: first one is the default
const first = await wh.createWarehouse(sellerId, form);
assert.equal(first.isDefault, true);
const second = await wh.createWarehouse(sellerId, { ...form, name: 'Second', address1: 'Shop 5, Road 8, Vijay Nagar', pincode: '452010' });
assert.equal(second.isDefault, false);
assert.equal((await wh.listWarehouses(sellerId)).length, 2);

// default switch, address edit (re-registers), delete (default moves on)
await wh.setDefaultWarehouse(sellerId, second.id);
assert.equal((await wh.listWarehouses(sellerId))[0].id, second.id);
const edited = await wh.updateWarehouse(sellerId, second.id, { address1: 'Shop 6, Road 9, Vijay Nagar' });
assert.equal(edited.address1, 'Shop 6, Road 9, Vijay Nagar');
await wh.deleteWarehouse(sellerId, second.id);
const left = await wh.listWarehouses(sellerId);
assert.equal(left.length, 1);
assert.equal(left[0].isDefault, true);
await assert.rejects(wh.updateWarehouse(new mongoose.Types.ObjectId(), first.id, {}), /not found/i);

// booking: no warehouse is refused by a real courier, allowed on the mock
const otherSeller = new mongoose.Types.ObjectId();
await Seller.collection.insertOne({ _id: otherSeller });
const orderDoc = (seller) => ({
    _id: new mongoose.Types.ObjectId(), orderId: `GOGO-WH-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, sellerId: seller,
    fulfilmentMode: 'standard', orderStatus: 'confirmed', customerName: 'Test Buyer', customerPhone: '9425000002',
    deliveryAddress: { location: { type: 'Point', coordinates: [75.89, 22.75] }, street: 'Flat 4, Road 5, Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', zipCode: '452010' },
    items: [{ itemId: String(productId), name: 'Mug', price: 100, quantity: 2 }],
    userId: new mongoose.Types.ObjectId(), pricing: { subtotal: 200, total: 200 }, payment: { method: 'razorpay' }, createdAt: new Date(), updatedAt: new Date(),
});
const noWh = orderDoc(otherSeller);
await Order.collection.insertOne(noWh);
if (live) {
    await assert.rejects(bookOrderShipment(await Order.findById(noWh._id)), /Add a warehouse/);
} else {
    await bookOrderShipment(await Order.findById(noWh._id));
}

const good = orderDoc(sellerId);
await Order.collection.insertOne(good);
const booked = await bookOrderShipment(await Order.findById(good._id));
assert.ok(booked.shipment.awb, 'an AWB is issued');
assert.equal(booked.shipment.pickupLocation, (await (await import('../src/modules/ecommerce/seller/models/sellerWarehouse.model.js')).SellerWarehouse.collection.findOne({ sellerId, active: true })).pickupNickname);
console.log('booked', booked.shipment.courierName, booked.shipment.awb, 'from', booked.shipment.pickupLocation);
if (live && booked.shipment.providerOrderId) console.log('cancel', await provider.cancelShipment(booked.shipment.providerOrderId));

console.log('shop-warehouse-shipping: ok');
await mongoose.disconnect();
await mongod.stop();
