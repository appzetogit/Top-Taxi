/**
 * Admin driver tracking: the four map views list the right drivers and trips.
 *
 * Run: node tests/driver-tracking.smoke.mjs
 *
 * waiting / on_trip / offline are views over the Driver document (isOnline,
 * isOnRide, location, locationUpdatedAt); history is finished and cancelled
 * rides. Runs the real service against an in-memory MongoDB.
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
const point = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

const main = async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'driver_tracking' });

  const { getDriverTracking } = await import('../src/modules/taxi/admin/services/adminService.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');

  const locA = oid();
  const locB = oid();
  const base = { password: 'x', approve: true, deletedAt: null };
  const drivers = {
    waitingFresh: { name: 'Asha Waiting', phone: '9000000001', vehicleNumber: 'KA01A0001', isOnline: true, isOnRide: false, location: point(77.59, 12.97), locationUpdatedAt: minutesAgo(1), service_location_id: locA },
    waitingStale: { name: 'Ravi Stale', phone: '9000000002', vehicleNumber: 'KA01A0002', isOnline: true, isOnRide: false, location: point(77.6, 12.98), locationUpdatedAt: minutesAgo(30), service_location_id: locA },
    onTrip: { name: 'Meena OnTrip', phone: '9000000003', vehicleNumber: 'KA01A0003', isOnline: true, isOnRide: true, location: point(77.61, 12.99), locationUpdatedAt: minutesAgo(0.2), service_location_id: locA },
    offlineKnown: { name: 'Kiran Offline', phone: '9000000004', vehicleNumber: 'KA01A0004', isOnline: false, isOnRide: false, location: point(77.5, 12.9), locationUpdatedAt: minutesAgo(600), service_location_id: locB },
    offlineNever: { name: 'Neha NeverSeen', phone: '9000000005', vehicleNumber: 'KA01A0005', isOnline: false, isOnRide: false, location: point(0, 0), service_location_id: locB },
    pending: { name: 'Pending Person', phone: '9000000006', isOnline: true, isOnRide: false, location: point(77.7, 13), approve: false, service_location_id: locA },
    deleted: { name: 'Deleted Person', phone: '9000000007', isOnline: true, isOnRide: false, location: point(77.7, 13), deletedAt: new Date(), service_location_id: locA },
  };
  const ids = {};
  for (const [key, doc] of Object.entries(drivers)) {
    ids[key] = oid();
    await Driver.collection.insertOne({ _id: ids[key], ...base, ...doc });
  }

  const rideBase = { fare: 250, pickupAddress: 'MG Road', dropAddress: 'Airport', pickupLocation: point(77.6, 12.97), dropLocation: point(77.7, 13.2) };
  const rider = { _id: oid(), name: 'Rider One', phone: '9111111111' };
  await mongoose.connection.collection('taxiusers').insertOne(rider).catch(() => {});
  const rideIds = { active: oid(), done: oid(), cancelled: oid(), old: oid() };
  const rides = [
    { _id: rideIds.active, driverId: ids.onTrip, userId: rider._id, status: 'ongoing', liveStatus: 'started', createdAt: minutesAgo(10) },
    { _id: rideIds.done, driverId: ids.waitingFresh, userId: rider._id, status: 'completed', liveStatus: 'completed', createdAt: minutesAgo(120), completedAt: minutesAgo(90) },
    { _id: rideIds.cancelled, driverId: ids.waitingStale, userId: rider._id, status: 'cancelled', liveStatus: 'cancelled', createdAt: minutesAgo(200), cancelled_by: 'rider', cancellation_reason: 'changed plan' },
    { _id: rideIds.old, driverId: ids.waitingFresh, userId: rider._id, status: 'completed', liveStatus: 'completed', createdAt: new Date(Date.now() - 3 * 86400000) },
  ];
  for (const ride of rides) await Ride.collection.insertOne({ ...rideBase, ...ride, updatedAt: new Date() });

  const names = (res) => res.results.map((r) => r.name).sort();

  await check('counts: only approved, non-deleted drivers are counted', async () => {
    const res = await getDriverTracking({ status: 'waiting' });
    assert.deepEqual(res.counts, { waiting: 2, on_trip: 1, offline: 2, history: 2 });
  });

  await check('waiting: online and idle, fresh vs stale position flagged', async () => {
    const res = await getDriverTracking({ status: 'waiting' });
    assert.deepEqual(names(res), ['Asha Waiting', 'Ravi Stale']);
    const fresh = res.results.find((r) => r.name === 'Asha Waiting');
    const stale = res.results.find((r) => r.name === 'Ravi Stale');
    assert.deepEqual(fresh.position, { lat: 12.97, lng: 77.59 });
    assert.equal(fresh.locationStale, false);
    assert.equal(stale.locationStale, true);
  });

  await check('on_trip: carries the trip, pickup, drop and rider', async () => {
    const res = await getDriverTracking({ status: 'on_trip' });
    assert.deepEqual(names(res), ['Meena OnTrip']);
    const trip = res.results[0].trip;
    assert.equal(trip.status, 'ongoing');
    assert.equal(trip.requestId, `REQ_${String(rideIds.active).slice(-12).toUpperCase()}`);
    assert.equal(trip.pickup.address, 'MG Road');
    assert.deepEqual([trip.drop.lat, trip.drop.lng], [13.2, 77.7]);
  });

  await check('offline: last known position, and a never-reported driver has none (not a pin at 0,0)', async () => {
    const res = await getDriverTracking({ status: 'offline' });
    assert.deepEqual(names(res), ['Kiran Offline', 'Neha NeverSeen']);
    assert.ok(res.results.find((r) => r.name === 'Kiran Offline').position);
    assert.equal(res.results.find((r) => r.name === 'Neha NeverSeen').position, null);
    assert.ok(res.results.every((r) => r.locationStale === false));
  });

  await check('history: finished and cancelled trips inside the window, newest first', async () => {
    const res = await getDriverTracking({ status: 'history', hours: 24 });
    assert.equal(res.results.length, 2);
    assert.deepEqual(res.results.map((r) => r.status), ['completed', 'cancelled']);
    assert.equal(res.results[0].driver.name, 'Asha Waiting');
    assert.equal(res.results[1].cancelledBy, 'rider');
    const wide = await getDriverTracking({ status: 'history', hours: 168 });
    assert.equal(wide.results.length, 3);
  });

  await check('search narrows by name, phone and vehicle number', async () => {
    assert.deepEqual(names(await getDriverTracking({ status: 'waiting', search: 'asha' })), ['Asha Waiting']);
    assert.deepEqual(names(await getDriverTracking({ status: 'offline', search: '9000000004' })), ['Kiran Offline']);
    assert.deepEqual(names(await getDriverTracking({ status: 'waiting', search: 'KA01A0002' })), ['Ravi Stale']);
    assert.equal((await getDriverTracking({ status: 'history', search: 'asha' })).results.length, 1);
  });

  await check('search text is not treated as a regex', async () => {
    const res = await getDriverTracking({ status: 'waiting', search: '.*' });
    assert.equal(res.results.length, 0);
  });

  await check('an unknown status falls back to waiting', async () => {
    assert.equal((await getDriverTracking({ status: 'nonsense' })).status, 'waiting');
  });

  await check('a regional admin sees only their own service location', async () => {
    const admin = { admin_type: 'subadmin', service_location_ids: [String(locB)], permissions: ['drivers.view'] };
    const res = await getDriverTracking({ status: 'offline' }, admin);
    assert.deepEqual(names(res), ['Kiran Offline', 'Neha NeverSeen']);
    const waiting = await getDriverTracking({ status: 'waiting' }, admin);
    assert.equal(waiting.results.length, 0);
    assert.equal((await getDriverTracking({ status: 'history' }, admin)).results.length, 0);
  });

  await check('an admin without the drivers permission is refused', async () => {
    const admin = { admin_type: 'subadmin', service_location_ids: [String(locA)], permissions: [] };
    await assert.rejects(() => getDriverTracking({ status: 'waiting' }, admin), (e) => e.statusCode === 403);
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll driver tracking checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
