/**
 * Master > Commission Overview: what the platform takes, from every partner.
 *
 * Run: node tests/commission-overview.smoke.mjs
 *
 * What this guards:
 *   - each seller's rate is the one its next order would be charged, through
 *     the services' own rate functions: a dated schedule shows over the
 *     standing rate;
 *   - a seller with no rate at all is counted, since it pays nothing;
 *   - last-30-day commission and the effective rate come from delivered
 *     orders only;
 *   - Taxi's rates come from each fare row, named by vehicle and city;
 *   - each admin sees only what their permissions cover.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack || err.message}`);
  }
};

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(mongod.getUri());
const db = mongoose.connection;
const { commissionOverview } = await import('../src/core/finance/commissionOverview.service.js');

const oid = () => new mongoose.Types.ObjectId();
const daysAgo = (d) => new Date(Date.now() - d * 24 * 3600 * 1000);

// --- Food: own rate, scheduled over, none.
const joy = oid();
const taj = oid();
const plain = oid();
await db.collection('food_restaurants').insertMany([
  { _id: joy, restaurantName: 'Joy', status: 'approved' },
  { _id: taj, restaurantName: 'Taj', status: 'approved' },
  { _id: plain, restaurantName: 'Plain Cafe', status: 'approved' },
]);
await db.collection('food_restaurant_commissions').insertMany([
  { restaurantId: joy, defaultCommission: { type: 'percentage', value: 15 }, status: true },
  { restaurantId: taj, defaultCommission: { type: 'percentage', value: 12 }, status: true },
]);
await db.collection('food_commission_schedules').insertOne({
  restaurantId: taj, label: 'Diwali', commission: { type: 'percentage', value: 5 },
  startsAt: daysAgo(1), endsAt: daysAgo(-3), status: true,
});
// Joy: two delivered orders in the window, one outside it, one cancelled.
const ledger = async (orders, txs, seller, status, at, base, commission) => {
  const orderId = oid();
  await db.collection(orders).insertOne({ _id: orderId, restaurantId: seller, orderStatus: status, createdAt: at, pricing: { subtotal: base } });
  await db.collection(txs).insertOne({ orderId, restaurantId: seller, amounts: { restaurantCommission: commission } });
};
await ledger('food_orders', 'food_transactions', joy, 'delivered', daysAgo(2), 400, 60);
await ledger('food_orders', 'food_transactions', joy, 'delivered', daysAgo(10), 200, 30);
await ledger('food_orders', 'food_transactions', joy, 'delivered', daysAgo(45), 999, 99);
await ledger('food_orders', 'food_transactions', joy, 'cancelled_by_user', daysAgo(3), 999, 99);

// --- Quick Commerce: store with a rate, store with no rate.
const grocer = oid();
const plainStore = oid();
await db.collection('qc_restaurants').insertMany([
  { _id: grocer, restaurantName: 'Daily Needs', status: 'approved', storeType: 'grocery' },
  { _id: plainStore, restaurantName: 'Plain Mart', status: 'approved', storeType: 'grocery' },
]);
await db.collection('qc_restaurant_commissions').insertMany([
  { restaurantId: grocer, defaultCommission: { type: 'percentage', value: 10 }, status: true },
]);

// --- Taxi fare rows.
const bike = oid();
const cab = oid();
const palampur = oid();
await db.collection('taxivehicles').insertMany([{ _id: bike, name: 'Bike' }, { _id: cab, name: 'Sedan' }]);
await db.collection('taxiservicelocations').insertOne({ _id: palampur, name: 'Palampur' });
await db.collection('taxisetprices').insertMany([
  { vehicle_type: bike, service_location_id: palampur, transport_type: 'taxi', admin_commission_type_from_driver: 1, admin_commission_from_driver: 12, active: true },
  { vehicle_type: cab, transport_type: 'taxi', admin_commission_type_from_driver: 0, admin_commission_from_driver: 25, active: true },
]);

const owner = { _id: oid(), role: 'ADMIN', adminLevel: 'platform_superadmin' };
const report = await commissionOverview(owner);
const svc = Object.fromEntries(report.services.map((s) => [s.key, s]));
const row = (key, name) => svc[key].rows.find((r) => r.name === name);

console.log('\nFood');
await check('a restaurant\'s own rate', async () => {
  assert.deepEqual(row('food', 'Joy').rate, { type: 'percentage', value: 15 });
  assert.equal(row('food', 'Joy').source, 'restaurant_default');
});
await check('a dated schedule shows over the standing rate, with its label', async () => {
  assert.deepEqual(row('food', 'Taj').rate, { type: 'percentage', value: 5 });
  assert.equal(row('food', 'Taj').label, 'Diwali');
  assert.match(row('food', 'Taj').source, /^schedule/);
});
await check('a restaurant with no rate pays nothing, and is counted', async () => {
  assert.equal(row('food', 'Plain Cafe').rate.value, 0);
  assert.equal(svc.food.summary.withoutRate, 1);
  assert.equal(svc.food.summary.withRate, 2);
});
await check('last 30 days: delivered orders only, with the effective rate', async () => {
  assert.deepEqual(row('food', 'Joy').last30, { orders: 2, commission: 90, effectivePct: 15 });
  assert.equal(svc.food.summary.commissionLast30, 90);
  assert.equal(svc.food.mode, 'commission');
});

console.log('\nQuick Commerce');
await check('a store\'s own rate', async () => {
  assert.deepEqual(row('quick', 'Daily Needs').rate, { type: 'percentage', value: 10 });
  assert.equal(row('quick', 'Daily Needs').kind, 'store');
});
await check('a store with no rate pays nothing, and is counted', async () => {
  assert.equal(row('quick', 'Plain Mart').rate.value, 0);
  assert.equal(row('quick', 'Plain Mart').source, 'none');
});

console.log('\nTaxi');
await check('Taxi rates come from each fare row, by vehicle and city', async () => {
  const by = Object.fromEntries(svc.taxi.rows.map((r) => [r.vehicle, r]));
  assert.deepEqual(by.Bike.rate, { type: 'percentage', value: 12 });
  assert.equal(by.Bike.where, 'Palampur');
  assert.deepEqual(by.Sedan.rate, { type: 'amount', value: 25 });
  assert.equal(by.Sedan.where, 'Every city');
});

console.log('\nWho sees what');
await check('a Food restaurants sub-admin sees only Food', async () => {
  const sub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['food'], permissions: ['restaurants.read'] };
  const r = await commissionOverview(sub);
  assert.deepEqual(r.services.map((s) => s.key), ['food']);
});
await check('no matching access is refused', async () => {
  const sub = { _id: oid(), role: 'ADMIN', adminLevel: 'subadmin', admin_type: 'subadmin', parentAdminId: owner._id, servicesAccess: ['food'], permissions: ['orders.read'] };
  await assert.rejects(() => commissionOverview(sub), /access to commission/);
});

await mongoose.disconnect();
await mongod.stop();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll commission overview checks passed');
process.exit(failed ? 1 : 0);
