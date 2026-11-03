/**
 * A rental booking is priced by the server and only "paid" when the money is real.
 *
 * Run: node tests/rental-booking-trust.smoke.mjs
 *
 * The booking endpoint used to save whatever totalCost, payableNow and
 * paymentStatus the app posted, and kept the payment object as sent, so a
 * modified client could book any vehicle as "paid" for any amount, or reuse one
 * small payment for many bookings. It now recomputes the total and the advance
 * from the vehicle and checks the wallet debit / Razorpay order behind the claim.
 *
 * Drives the real controllers against an in-memory MongoDB, with the Razorpay
 * orders API replaced by an in-process fake behind global fetch.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Pinned before anything imports env.js, so dotenv cannot fill in real keys.
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_smoke';
process.env.RAZORPAY_KEY_SECRET = 'smoke_secret';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.message}`);
  }
};
const oid = () => new mongoose.Types.ObjectId();
const sign = (orderId, paymentId) =>
  crypto.createHmac('sha256', 'smoke_secret').update(`${orderId}|${paymentId}`).digest('hex');

/* ---------------- fake Razorpay behind global fetch ---------------- */
const rzpOrders = new Map();
let seq = 0;
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = String(opts.method || 'GET').toUpperCase();
  if (u.hostname === 'api.razorpay.com') {
    const path = u.pathname.replace(/^\/v1/, '');
    if (method === 'POST' && path === '/orders') {
      const body = JSON.parse(opts.body);
      const order = { id: `order_${++seq}`, entity: 'order', created_at: Math.floor(Date.now() / 1000), ...body };
      rzpOrders.set(order.id, order);
      return json(200, order);
    }
    const m = /^\/orders\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      return rzpOrders.has(id) ? json(200, rzpOrders.get(id)) : json(400, { error: { description: 'no such order' } });
    }
  }
  throw new Error(`unmocked fetch ${method} ${url}`);
};

/** The customer completing checkout: returns what the app would post as payment. */
const payOrder = (orderId) => {
  const paymentId = `pay_${++seq}`;
  return { provider: 'razorpay', razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) };
};

const call = async (handler, { sub, body = {}, params = {}, query = {} }) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const req = { auth: { sub: String(sub) }, body, params, query, protocol: 'http', get: () => 'localhost:5000' };
  try {
    await handler(req, res);
    return { status: res.statusCode, body: res.body };
  } catch (error) {
    return { status: error.statusCode || 500, error: error.message };
  }
};

const main = async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'rental_trust' });

  const user = await import('../src/modules/taxi/user/controllers/userController.js');
  const { RentalVehicleType } = await import('../src/modules/taxi/admin/models/RentalVehicleType.js');
  const { RentalBookingRequest } = await import('../src/modules/taxi/admin/models/RentalBookingRequest.js');
  const { UserWallet } = await import('../src/modules/taxi/user/models/UserWallet.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  const alice = oid();
  const mallory = oid();
  for (const [id, phone] of [[alice, '9800000001'], [mallory, '9800000002']]) {
    await User.collection.insertOne({ _id: id, name: 'Renter', phone, isActive: true });
  }
  await UserWallet.create({ userId: alice, balance: 5000 });

  const pricing = [
    { id: 'p6', label: '6 Hours', durationHours: 6, price: 1000, extraHourPrice: 100, active: true },
    { id: 'old', label: 'Retired', durationHours: 6, price: 1, extraHourPrice: 1, active: false },
  ];
  const makeVehicle = (name, advancePayment) =>
    RentalVehicleType.create({ name, pricing, advancePayment, status: 'active', active: true });
  const free = await makeVehicle('No advance', { enabled: false, paymentMode: 'percentage', amount: 20 });
  const pct = await makeVehicle('20 percent', { enabled: true, paymentMode: 'percentage', amount: 20 });
  const full = await makeVehicle('Full upfront', { enabled: true, paymentMode: 'full', amount: 0 });
  const fixed = await makeVehicle('Flat 300', { enabled: true, paymentMode: 'fixed', amount: 300 });

  const pickup = new Date(Date.now() + 86400000).toISOString();
  const returnIn = (hours) => new Date(new Date(pickup).getTime() + hours * 3600000).toISOString();
  let ref = 0;
  const book = (sub, vehicle, extra = {}) =>
    call(user.createRentalBookingRequest, {
      sub,
      body: {
        bookingReference: `RNT-T${++ref}`,
        vehicleTypeId: String(vehicle._id),
        pickupDateTime: pickup,
        returnDateTime: returnIn(6),
        selectedPackage: { id: 'p6' },
        ...extra,
      },
    });
  const orderFor = async (sub, vehicle, amount, extra = {}) => {
    const res = await call(user.createRentalAdvancePaymentOrder, {
      sub,
      body: { amount, vehicleId: String(vehicle._id), vehicleName: vehicle.name, ...extra },
    });
    assert.equal(res.status, 201, res.error);
    return res.body.data;
  };

  await check('client-claimed total, advance and "paid" are ignored when no advance is due', async () => {
    const res = await book(alice, free, { totalCost: 1, payableNow: 1, paymentStatus: 'paid', payment: { provider: 'razorpay', status: 'paid', amount: 1 } });
    assert.equal(res.status, 201, res.error);
    assert.equal(res.body.data.totalCost, 1000);
    assert.equal(res.body.data.payableNow, 0);
    assert.equal(res.body.data.paymentStatus, 'not_required');
    assert.equal(res.body.data.payment.provider, 'manual');
  });

  await check('extra hours past the package are charged at the package rate (8.5h on a 6h pack = 1000 + 3 x 100)', async () => {
    const res = await book(alice, free, { returnDateTime: returnIn(8.5) });
    assert.equal(res.body.data.totalCost, 1300);
  });

  await check('a booking with no package, or a retired one, is refused', async () => {
    assert.equal((await book(alice, free, { selectedPackage: null })).status, 400);
    assert.equal((await book(alice, free, { selectedPackage: { id: 'old' } })).status, 400);
    assert.equal((await book(alice, free, { selectedPackage: { id: 'nope' } })).status, 400);
  });

  await check('advance due and nothing paid: 402, nothing saved', async () => {
    const before = await RentalBookingRequest.countDocuments();
    const res = await book(alice, pct, { paymentStatus: 'paid', payment: { provider: 'razorpay', status: 'paid', amount: 200 } });
    assert.equal(res.status, 402);
    assert.equal(await RentalBookingRequest.countDocuments(), before);
  });

  await check('a forged Razorpay signature is refused', async () => {
    const order = await orderFor(alice, pct, 200);
    const payment = payOrder(order.orderId);
    const res = await book(alice, pct, { payment: { ...payment, razorpay_signature: 'f'.repeat(64) } });
    assert.equal(res.status, 400);
  });

  await check('a payment smaller than the advance is refused', async () => {
    const order = await orderFor(alice, pct, 50);
    const res = await book(alice, pct, { payment: payOrder(order.orderId) });
    assert.equal(res.status, 402);
  });

  await check('an order created for something else, or by someone else, is refused', async () => {
    const foreign = { id: `order_${++seq}`, amount: 20000, currency: 'INR', notes: { purpose: 'ride_payment', userId: String(alice) } };
    rzpOrders.set(foreign.id, foreign);
    assert.equal((await book(alice, pct, { payment: payOrder(foreign.id) })).status, 403);

    const malloryOrder = await orderFor(mallory, pct, 200);
    assert.equal((await book(alice, pct, { payment: payOrder(malloryOrder.orderId) })).status, 403);
  });

  let paidBooking;
  let paidPayment;
  await check('a real payment of the right amount books it, with the server\'s numbers', async () => {
    const order = await orderFor(alice, pct, 200);
    paidPayment = payOrder(order.orderId);
    const res = await book(alice, pct, { totalCost: 5, payableNow: 5, payment: paidPayment });
    assert.equal(res.status, 201, res.error);
    paidBooking = res.body.data;
    assert.equal(paidBooking.totalCost, 1000);
    assert.equal(paidBooking.payableNow, 200);
    assert.equal(paidBooking.paymentStatus, 'paid');
    assert.equal(paidBooking.payment.amount, 200);
    assert.equal(paidBooking.payment.orderId, order.orderId);
  });

  await check('the same payment cannot buy a second booking', async () => {
    const res = await book(alice, pct, { payment: paidPayment });
    assert.equal(res.status, 409);
  });

  await check('posting the same booking again returns it unchanged instead of rewriting it', async () => {
    const res = await call(user.createRentalBookingRequest, {
      sub: alice,
      body: {
        bookingReference: paidBooking.bookingReference,
        vehicleTypeId: String(free._id),
        pickupDateTime: pickup,
        returnDateTime: returnIn(48),
        selectedPackage: { id: 'p6' },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, paidBooking.id);
    assert.equal(res.body.data.vehicleName, '20 percent');
    assert.equal(res.body.data.totalCost, 1000);
  });

  await check('full and flat advance modes follow the vehicle setting', async () => {
    const fullOrder = await orderFor(alice, full, 1000);
    const a = await book(alice, full, { payment: payOrder(fullOrder.orderId) });
    assert.equal(a.status, 201, a.error);
    assert.equal(a.body.data.payableNow, 1000);

    const fixedOrder = await orderFor(alice, fixed, 300);
    const b = await book(alice, fixed, { payment: payOrder(fixedOrder.orderId) });
    assert.equal(b.status, 201, b.error);
    assert.equal(b.body.data.payableNow, 300);
  });

  await check('wallet: a small debit does not unlock a booking, the right one does', async () => {
    const small = await call(user.payRentalAdvanceWithWallet, { sub: alice, body: { amount: 5, bookingReference: 'RNT-WALLET1' } });
    assert.equal(small.status, 201, small.error);
    const refused = await call(user.createRentalBookingRequest, {
      sub: alice,
      body: { bookingReference: 'RNT-WALLET1', vehicleTypeId: String(pct._id), pickupDateTime: pickup, returnDateTime: returnIn(6), selectedPackage: { id: 'p6' }, payment: { provider: 'wallet' } },
    });
    assert.equal(refused.status, 402);

    const right = await call(user.payRentalAdvanceWithWallet, { sub: alice, body: { amount: 200, bookingReference: 'RNT-WALLET2' } });
    assert.equal(right.status, 201, right.error);
    const ok = await call(user.createRentalBookingRequest, {
      sub: alice,
      body: { bookingReference: 'RNT-WALLET2', vehicleTypeId: String(pct._id), pickupDateTime: pickup, returnDateTime: returnIn(6), selectedPackage: { id: 'p6' }, payment: { provider: 'wallet' } },
    });
    assert.equal(ok.status, 201, ok.error);
    assert.equal(ok.body.data.paymentStatus, 'paid');
    assert.equal(ok.body.data.payment.provider, 'wallet');
  });

  await check('another user cannot claim a wallet debit they never made', async () => {
    const res = await call(user.createRentalBookingRequest, {
      sub: mallory,
      body: { bookingReference: 'RNT-WALLET2', vehicleTypeId: String(pct._id), pickupDateTime: pickup, returnDateTime: returnIn(6), selectedPackage: { id: 'p6' }, payment: { provider: 'wallet' } },
    });
    assert.equal(res.status, 402);
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll rental booking checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
