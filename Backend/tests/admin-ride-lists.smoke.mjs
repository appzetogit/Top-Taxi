/**
 * The admin Trips, Deliveries and Ongoing lists: paging, tab counts, filters,
 * search and the full ride details.
 *
 * Run: node tests/admin-ride-lists.smoke.mjs
 *
 * The lists used to load every ride, filter in memory and slice one page that
 * the page never moved off, so rides past the first `limit` were unreachable;
 * the payment column was hard-coded CASH and addresses were shown as lat/lng.
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
const pt = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const main = async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'admin_ride_lists' });

  const { listRideRequests, listDeliveries, listOngoingRides, getRideRequestDetails } = await import(
    '../src/modules/taxi/admin/services/adminService.js'
  );
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');

  const asha = oid();
  const ravi = oid();
  const drv = oid();
  await User.collection.insertOne({ _id: asha, name: 'Asha Rider', phone: '9100000001', email: 'asha@example.com' });
  await User.collection.insertOne({ _id: ravi, name: 'Ravi Sender', phone: '9100000002' });
  await Driver.collection.insertOne({
    _id: drv, name: 'Dev Driver', phone: '9200000001', email: 'dev@example.com', password: 'x', approve: true,
    vehicleType: 'sedan', vehicleNumber: 'KA01Z9999', vehicleMake: 'Honda', vehicleModel: 'City', rating: 4.6,
    wallet: { balance: 321 },
  });

  const mk = (over) => ({
    userId: asha, fare: 200, pickupLocation: pt(77.6, 12.97), dropLocation: pt(77.7, 13.1),
    pickupAddress: 'MG Road, Bengaluru', dropAddress: 'Airport Road', paymentMethod: 'cash',
    status: 'completed', liveStatus: 'completed', serviceType: 'ride', createdAt: daysAgo(1), updatedAt: new Date(), ...over,
  });
  const ids = {};
  const rides = {
    // 25 completed trips so a second page exists, alternating cash / online
    ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`done${i}`, mk({
      driverId: drv, paymentMethod: i % 2 ? 'online' : 'cash', createdAt: daysAgo(2 + i / 100),
      acceptedAt: daysAgo(2), startedAt: daysAgo(2), completedAt: daysAgo(2), baseFare: 150, distanceChargeAmount: 50,
    })])),
    cancelled: mk({ status: 'cancelled', liveStatus: 'cancelled', driverId: null, cancelled_by: 'rider', cancellation_reason: 'changed plan', cancellation_time: daysAgo(1) }),
    searching: mk({ status: 'searching', liveStatus: 'searching', driverId: null, pickupAddress: 'Koramangala Searching St' }),
    accepted: mk({ status: 'accepted', liveStatus: 'arriving', driverId: drv, paymentMethod: 'online' }),
    ongoing: mk({ status: 'ongoing', liveStatus: 'started', driverId: drv }),
    parcelDone: mk({ serviceType: 'parcel', userId: ravi, driverId: drv, parcel: { category: 'Documents', senderName: 'Sunil Sender', receiverName: 'Rekha Receiver', receiverMobile: '9333333333' }, pickupAddress: 'Indiranagar', dropAddress: 'Whitefield' }),
    parcelOngoing: mk({ serviceType: 'parcel', userId: ravi, status: 'ongoing', liveStatus: 'started', driverId: drv }),
    intercity: mk({ serviceType: 'intercity', status: 'searching', liveStatus: 'searching', driverId: null, intercity: { fromCity: 'Bengaluru', toCity: 'Mysuru' } }),
    hidden: mk({ adminHiddenAt: new Date(), driverId: drv }),
  };
  for (const [key, doc] of Object.entries(rides)) {
    ids[key] = oid();
    await Ride.collection.insertOne({ _id: ids[key], ...doc });
  }

  await check('trips: paging reaches every ride, not just the first page', async () => {
    const p1 = await listRideRequests({ page: 1, limit: 10 });
    const p3 = await listRideRequests({ page: 3, limit: 10 });
    assert.equal(p1.results.length, 10);
    assert.equal(p1.paginator.total, 29); // 25 done + cancelled + searching + accepted + ongoing; parcel, intercity and hidden excluded
    assert.equal(p1.paginator.last_page, 3);
    assert.equal(p3.results.length, 9);
    const seen = new Set((await Promise.all([1, 2, 3].map((page) => listRideRequests({ page, limit: 10 })))).flatMap((r) => r.results.map((x) => x.id)));
    assert.equal(seen.size, 29);
  });

  await check('trips: tab counts match the tabs', async () => {
    const res = await listRideRequests({ limit: 10 });
    assert.deepEqual(res.counts, { all: 29, completed: 25, cancelled: 1, upcoming: 1, on_trip: 2 });
    assert.equal((await listRideRequests({ tab: 'Completed' })).paginator.total, 25);
    assert.equal((await listRideRequests({ tab: 'On Trip' })).paginator.total, 2);
    assert.equal((await listRideRequests({ tab: 'cancelled' })).results[0].cancelled_by, 'rider');
  });

  await check('payment is the real method, not always CASH', async () => {
    const online = await listRideRequests({ payment: 'online', limit: 50 });
    assert.ok(online.results.length > 0 && online.results.every((r) => r.paymentOption === 'ONLINE'));
    const cash = await listRideRequests({ payment: 'cash', limit: 50 });
    assert.ok(cash.results.every((r) => r.paymentOption === 'CASH'));
    assert.equal(online.paginator.total + cash.paginator.total, 29);
  });

  await check('rows show the address, and carry full user and driver', async () => {
    const row = (await listRideRequests({ tab: 'upcoming' })).results[0];
    assert.equal(row.pickupLabel, 'Koramangala Searching St');
    assert.equal(row.statusLabel, 'Searching for driver');
    const done = (await listRideRequests({ tab: 'completed' })).results[0];
    assert.equal(done.user.email, 'asha@example.com');
    assert.equal(done.driver.vehicleNumber, 'KA01Z9999');
    assert.equal(done.driver.vehicleMake, 'Honda');
  });

  await check('date filter uses calendar days (inclusive) in IST', async () => {
    const day = (d) => new Date(Date.now() + 5.5 * 3600000 - d * 86400000).toISOString().slice(0, 10);
    const today = await listRideRequests({ from: day(0), to: day(0), limit: 50 });
    assert.equal(today.paginator.total, 0);
    const wide = await listRideRequests({ from: day(10), to: day(0), limit: 50 });
    assert.equal(wide.paginator.total, 29);
    const old = await listRideRequests({ from: day(10), to: day(5), limit: 50 });
    assert.equal(old.paginator.total, 0);
  });

  await check('search finds a ride by rider, driver phone, address and request id', async () => {
    assert.equal((await listRideRequests({ search: 'asha' })).paginator.total, 29);
    assert.equal((await listRideRequests({ search: '9200000001' })).paginator.total, 27);
    assert.equal((await listRideRequests({ search: 'koramangala' })).paginator.total, 1);
    assert.equal((await listRideRequests({ search: 'KA01Z9999', limit: 50 })).paginator.total, 27);
    const code = `REQ_${String(ids.searching).slice(-12).toUpperCase()}`;
    const byCode = await listRideRequests({ search: code });
    assert.equal(byCode.paginator.total, 1);
    assert.equal(byCode.results[0].id, String(ids.searching));
    assert.equal((await listRideRequests({ search: 'zzzz-nothing' })).paginator.total, 0);
  });

  await check('search text is not treated as a regex', async () => {
    assert.equal((await listRideRequests({ search: '.*' })).paginator.total, 0);
  });

  await check('deliveries: parcel rides only, with sender and receiver', async () => {
    const res = await listDeliveries({ limit: 10 });
    assert.equal(res.paginator.total, 2);
    assert.deepEqual(res.counts, { all: 2, completed: 1, cancelled: 0, upcoming: 0, on_trip: 1 });
    const done = res.results.find((r) => r.tripStatus === 'COMPLETED');
    assert.equal(done.requestId, `DEL_${String(ids.parcelDone).slice(-12).toUpperCase()}`);
    assert.equal(done.parcel.receiverName, 'Rekha Receiver');
    assert.equal((await listDeliveries({ search: 'rekha' })).paginator.total, 1);
    assert.equal((await listDeliveries({ search: '9333333333' })).paginator.total, 1);
  });

  await check('ongoing: only unfinished rides, any service, with its own tabs', async () => {
    const res = await listOngoingRides({ limit: 20 });
    assert.equal(res.paginator.total, 5); // searching, accepted, ongoing, parcelOngoing, intercity
    assert.deepEqual(res.counts, { all: 5, accepted: 1, upcoming: 2, ongoing: 2 });
    assert.ok(res.results.every((r) => ['UPCOMING', 'ACCEPTED', 'ONGOING'].includes(r.tripStatus)));
    assert.equal((await listOngoingRides({ tab: 'Accepted' })).results[0].statusLabel, 'Driver on the way');
    assert.equal((await listOngoingRides({ serviceType: 'parcel' })).paginator.total, 1);
    assert.equal((await listOngoingRides({ serviceType: 'intercity' })).results[0].routeLabel, 'Bengaluru -> Mysuru');
  });

  await check('an unknown tab falls back to all', async () => {
    assert.equal((await listRideRequests({ tab: 'bogus' })).tab, 'all');
  });

  await check('details: user, driver, timeline, fare, payment and earnings', async () => {
    await Ride.collection.updateOne({ _id: ids.done0 }, { $set: {
      commissionAmount: 20, driverEarnings: 180, insurance_fee: 5, promo: { code: 'SAVE10', discount_amount: 10, fare_before_discount: 210 },
      feedback: { rating: 5, comment: 'Smooth ride', tipAmount: 15 },
      arrivedAt: daysAgo(2), driverPaymentCollection: { provider: 'razorpay', status: 'paid', amount: 200, providerPaymentId: 'pay_x' },
    } });
    const d = await getRideRequestDetails(String(ids.done0));
    assert.equal(d.user.completedRides, 26); // 25 + the admin-hidden one: hiding only removes it from the Trips list
    assert.equal(d.user.totalRides, 31); // every ride Asha booked, including the hidden and intercity ones
    assert.equal(d.driver.walletBalance, 321);
    assert.equal(d.driver.rating, 4.6);
    assert.ok(d.driver.completedTrips >= 25);
    assert.deepEqual(d.timeline.map((t) => t.key).slice(0, 2), ['created', 'accepted']);
    assert.ok(d.timeline.some((t) => t.key === 'completed'));
    const labels = d.fareBreakdown.lines.map((l) => l.key);
    assert.ok(['base', 'distance', 'insurance', 'tip', 'promo'].every((k) => labels.includes(k)));
    assert.equal(d.fareBreakdown.lines.find((l) => l.key === 'promo').amount, -10);
    assert.equal(d.payment.status, 'PAID');
    assert.equal(d.payment.providerPaymentId, 'pay_x');
    assert.equal(d.earnings.driverEarnings, 180);
    assert.equal(d.feedback.rating, 5);
  });

  await check('details: a parcel shows its parcel block, a cancelled ride its reason', async () => {
    const parcel = await getRideRequestDetails(String(ids.parcelDone));
    assert.equal(parcel.parcelDetails.senderName, 'Sunil Sender');
    const cancelled = await getRideRequestDetails(String(ids.cancelled));
    assert.equal(cancelled.cancellation_reason, 'changed plan');
    assert.ok(cancelled.timeline.some((t) => t.key === 'cancelled' && /rider/.test(t.label)));
    assert.equal(cancelled.driver, null);
  });

  await check('details: a bad or unknown id is refused', async () => {
    await assert.rejects(() => getRideRequestDetails('nope'), (e) => e.statusCode === 400);
    await assert.rejects(() => getRideRequestDetails(String(oid())), (e) => e.statusCode === 404);
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll admin ride list checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
