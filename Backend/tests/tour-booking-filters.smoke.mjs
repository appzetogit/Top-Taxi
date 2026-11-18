/**
 * Admin Tour Bookings: search, booking status, payment status and date filters.
 *
 * Run: node tests/tour-booking-filters.smoke.mjs
 *
 * The page could only filter by package and payment status; there was no way to
 * find a customer, to see completed vs cancelled bookings, or to pick a date.
 */
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
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
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const main = async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'tour_filters' });

  const { listTourBookings } = await import('../src/modules/taxi/admin/services/adminService.js');
  const { TourBooking } = await import('../src/modules/taxi/user/models/TourBooking.js');

  const goa = oid();
  const manali = oid();
  const base = {
    userId: oid(), personCount: 2, pricePerPerson: 1000, totalAmount: 2000, upfrontRequiredAmount: 400,
    departureId: oid(), departureSnapshot: { startDate: daysAgo(-10), endDate: daysAgo(-14) },
  };
  const docs = [
    { ...base, packageId: goa, bookingCode: 'TB-AAA111', customerName: 'Asha Nair', customerPhone: '9000000001', packageSnapshot: { destination: 'Goa' }, status: 'confirmed', paymentStatus: 'partial', payment: { status: 'paid', amount: 400 }, balanceAmount: 1600, createdAt: daysAgo(1) },
    { ...base, packageId: goa, bookingCode: 'TB-BBB222', customerName: 'Ravi Kumar', customerPhone: '9000000002', packageSnapshot: { destination: 'Goa' }, status: 'completed', paymentStatus: 'paid', payment: { status: 'paid', amount: 2000 }, balanceAmount: 0, createdAt: daysAgo(8) },
    { ...base, packageId: manali, bookingCode: 'TB-CCC333', customerName: 'Meena Rao', customerPhone: '9000000003', packageSnapshot: { destination: 'Manali' }, status: 'cancelled', paymentStatus: 'failed', balanceAmount: 0, createdAt: daysAgo(20) },
    { ...base, packageId: manali, bookingCode: 'TB-DDD444', customerName: 'Kiran Das', customerPhone: '9000000004', packageSnapshot: { destination: 'Manali' }, status: 'pending_payment', paymentStatus: 'pending', balanceAmount: 0, createdAt: daysAgo(0.1) },
  ];
  for (const doc of docs) await TourBooking.collection.insertOne({ _id: oid(), updatedAt: new Date(), ...doc });

  const codes = async (params) => (await listTourBookings(params)).bookings.map((b) => b.bookingCode).sort();

  await check('no filter lists every booking', async () => {
    assert.deepEqual(await codes({}), ['TB-AAA111', 'TB-BBB222', 'TB-CCC333', 'TB-DDD444']);
  });

  await check('search by code, customer name, phone and destination', async () => {
    assert.deepEqual(await codes({ search: 'bbb222' }), ['TB-BBB222']);
    assert.deepEqual(await codes({ search: 'meena' }), ['TB-CCC333']);
    assert.deepEqual(await codes({ search: '9000000004' }), ['TB-DDD444']);
    assert.deepEqual(await codes({ search: 'goa' }), ['TB-AAA111', 'TB-BBB222']);
    assert.deepEqual(await codes({ search: '.*' }), []); // not a regex
  });

  await check('booking status and payment status filters', async () => {
    assert.deepEqual(await codes({ bookingStatus: 'completed' }), ['TB-BBB222']);
    assert.deepEqual(await codes({ bookingStatus: 'cancelled' }), ['TB-CCC333']);
    assert.deepEqual(await codes({ status: 'partial' }), ['TB-AAA111']);
    assert.deepEqual(await codes({ bookingStatus: 'confirmed', status: 'paid' }), []);
  });

  await check('package filter still works and combines with search', async () => {
    assert.deepEqual(await codes({ packageId: String(goa) }), ['TB-AAA111', 'TB-BBB222']);
    assert.deepEqual(await codes({ packageId: String(goa), search: 'ravi' }), ['TB-BBB222']);
  });

  await check('booking date range (IST calendar days, inclusive)', async () => {
    const day = (d) => new Date(Date.now() + 5.5 * 3600000 - d * 86400000).toISOString().slice(0, 10);
    assert.deepEqual(await codes({ from: day(10), to: day(0) }), ['TB-AAA111', 'TB-BBB222', 'TB-DDD444']);
    assert.deepEqual(await codes({ from: day(30), to: day(15) }), ['TB-CCC333']);
    assert.deepEqual(await codes({ from: day(2) }), ['TB-AAA111', 'TB-DDD444']);
    assert.deepEqual(await codes({ from: 'garbage' }), ['TB-AAA111', 'TB-BBB222', 'TB-CCC333', 'TB-DDD444']); // bad date is ignored
  });

  await check('the summary follows the filters', async () => {
    const res = await listTourBookings({ packageId: String(goa) });
    assert.equal(res.summary.totalBookings, 2);
    assert.equal(res.summary.totalOutstanding, 1600);
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll tour booking filter checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
