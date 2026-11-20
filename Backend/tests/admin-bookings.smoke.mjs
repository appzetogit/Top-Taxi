/**
 * Bookings an admin makes for a customer: create, confirm, cancel, find the
 * customer by phone, and give a ride to a driver.
 *
 * Run: node tests/admin-bookings.smoke.mjs
 *
 * Drives the real services against an in-memory MongoDB. Rides are made through
 * the same createRideRecord the app uses (priced from a seeded Set Price row).
 * Distance is measured in a straight line so the rupee figures are exact.
 */
process.env.TAXI_DISTANCE_SOURCE = 'straight';
process.env.NODE_ENV = 'test';
process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';

import assert from 'node:assert/strict';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${err.stack?.split('\n').slice(0, 3).join(' | ') || err.message}`);
  }
};
const oid = () => new mongoose.Types.ObjectId();
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
const rejects = async (fn, status, pattern) => {
  await assert.rejects(fn, (e) => {
    assert.equal(e.statusCode, status, `status ${e.statusCode}: ${e.message}`);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
};

const main = async () => {
  // A replica set: accepting a ride is a transaction.
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'admin_bookings' });

  const rules = await import('../src/modules/taxi/common/adminBookings.js');
  const svc = await import('../src/modules/taxi/admin/services/adminBookings.js');
  const rides = await import('../src/modules/taxi/admin/services/adminBookingRides.js');
  const adminService = await import('../src/modules/taxi/admin/services/adminService.js');
  const dispatch = await import('../src/modules/taxi/services/dispatchService.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
  const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
  const { RentalVehicleType } = await import('../src/modules/taxi/admin/models/RentalVehicleType.js');
  const { RentalBookingRequest } = await import('../src/modules/taxi/admin/models/RentalBookingRequest.js');
  const { TourPackage } = await import('../src/modules/taxi/admin/models/TourPackage.js');
  const { TourBooking } = await import('../src/modules/taxi/user/models/TourBooking.js');
  const { sweepStaleRides } = await import('../src/modules/taxi/services/staleRideSweep.js');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  /* ------------------------------------------------------------------ rules */
  console.log('\nthe rules');
  await check('phone numbers are normalised to 10 digits', async () => {
    assert.equal(rules.normalizeCustomerPhone('+91 98765-43210'), '9876543210');
    assert.equal(rules.normalizeCustomerPhone('919876543210'), '9876543210');
    assert.equal(rules.isValidCustomerPhone('12345'), false);
    assert.deepEqual(rules.phoneVariants('9876543210'), ['9876543210', '919876543210', '+919876543210']);
  });
  await check('confirm and cancel are allowed only before the booking starts', async () => {
    const awaiting = { adminBooking: { confirmation: 'awaiting' }, status: 'searching', liveStatus: 'searching' };
    assert.equal(rules.canConfirm('ride', awaiting), true);
    assert.equal(rules.canCancel('ride', awaiting), true);
    const confirmed = { adminBooking: { confirmation: 'confirmed' }, status: 'accepted', liveStatus: 'arriving' };
    assert.equal(rules.canConfirm('ride', confirmed), false);
    assert.equal(rules.canCancel('ride', confirmed), true);
    const started = { adminBooking: { confirmation: 'confirmed' }, status: 'ongoing', liveStatus: 'started' };
    assert.equal(rules.canCancel('ride', started), false);
    assert.equal(rules.canCancel('ride', { adminBooking: { confirmation: 'awaiting' }, status: 'cancelled' }), false);
    assert.equal(rules.canCancel('ride', { status: 'searching' }), false); // not an admin booking
    assert.equal(rules.canCancel('rental', { adminBooking: { confirmation: 'confirmed' }, status: 'assigned' }), false);
    const departed = { adminBooking: { confirmation: 'confirmed' }, status: 'confirmed', departureSnapshot: { startDate: new Date(Date.now() - 1000) } };
    assert.equal(rules.canCancel('tour', departed), false);
  });
  await check('an unconfirmed booking shows as awaiting; one cancelled elsewhere shows cancelled', async () => {
    assert.equal(rules.displayStatus({ adminBooking: { confirmation: 'awaiting' }, status: 'confirmed' }), 'awaiting_confirmation');
    assert.equal(rules.effectiveConfirmation({ adminBooking: { confirmation: 'confirmed' }, status: 'cancelled' }), 'cancelled');
    assert.equal(rules.describeAdminBooking('ride', { status: 'searching' }), null);
  });
  await check('a cancellation needs a reason; a booking time must be ahead', async () => {
    assert.equal(rules.checkCancelReason('  ').ok, false);
    assert.equal(rules.checkCancelReason('customer changed plan').ok, true);
    assert.equal(rules.checkLeadTime(inMinutes(1)).ok, false);
    assert.equal(rules.checkLeadTime(inMinutes(15)).ok, true);
    assert.equal(rules.checkLeadTime('nonsense').ok, false);
  });

  /* ------------------------------------------------------------- seed data */
  const serviceLocation = oid();
  const zoneA = oid();
  const zoneB = oid();
  // Zone A covers the pickup (Indore); zone B is elsewhere.
  await Zone.collection.insertMany([
    { _id: zoneA, name: 'Indore', service_location_id: serviceLocation, active: true, status: 'active', geometry: { type: 'Polygon', coordinates: [[[75.7, 22.6], [76.0, 22.6], [76.0, 22.9], [75.7, 22.9], [75.7, 22.6]]] } },
    { _id: zoneB, name: 'Bhopal', service_location_id: serviceLocation, active: true, status: 'active', geometry: { type: 'Polygon', coordinates: [[[77.2, 23.1], [77.6, 23.1], [77.6, 23.4], [77.2, 23.4], [77.2, 23.1]]] } },
  ]);
  const sedan = oid();
  const bike = oid();
  await Vehicle.collection.insertMany([
    { _id: sedan, name: 'Sedan', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() },
    { _id: bike, name: 'Bike', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() },
  ]);
  await SetPrice.collection.insertOne({
    vehicle_type: sedan, transport_type: 'taxi', pricing_scope: 'ride', active: 1, status: 'active', zone_id: null,
    service_location_id: serviceLocation, service_tax: 5, base_price: 70, base_distance: 2, price_per_distance: 17, time_price: 2,
    admin_commision: 5, admin_commision_type: 1, createdAt: new Date(), updatedAt: new Date(),
  });

  const pickup = { address: 'Vijay Nagar, Indore', lat: 22.728214, lng: 75.8843673 };
  const drop = { address: 'Palasia, Indore', lat: 22.75521, lng: 75.8968202 };
  const admin = { id: String(oid()), name: 'Desk Admin' };

  const registered = oid();
  await User.collection.insertOne({ _id: registered, name: 'Asha Rider', phone: '9811111111', createdAt: new Date() });
  const unregisteredPhone = '9822222222';

  const makeDriver = (over = {}) => ({
    _id: oid(), name: 'Driver', phone: '9700000000', password: 'x', approve: true, deletedAt: null, isOnline: true, isOnRide: false,
    zoneId: zoneA, vehicleTypeId: sedan, vehicleType: 'sedan', vehicleNumber: 'MP09AB1234', wallet: { balance: 5000, isBlocked: false },
    location: { type: 'Point', coordinates: [75.885, 22.729] }, locationUpdatedAt: new Date(), createdAt: new Date(), ...over,
  });
  const dIn = makeDriver({ name: 'Zone A Driver', phone: '9700000001' });
  const dOffline = makeDriver({ name: 'Zone A Offline', phone: '9700000002', isOnline: false });
  const dOther = makeDriver({ name: 'Zone B Driver', phone: '9700000003', zoneId: zoneB });
  const dWrongVehicle = makeDriver({ name: 'Bike Driver', phone: '9700000004', vehicleTypeId: bike, vehicleType: 'bike' });
  const dBlocked = makeDriver({ name: 'Blocked Driver', phone: '9700000005', wallet: { balance: 0, isBlocked: true } });
  await Driver.collection.insertMany([dIn, dOffline, dOther, dWrongVehicle, dBlocked]);

  const cab = (phone, over = {}) => svc.createAdminBooking({
    type: 'daily_cab',
    customer: { name: 'Customer', phone },
    scheduledAt: inMinutes(20),
    notes: 'called in',
    ride: { vehicleTypeId: String(sedan), pickup, drop, paymentMethod: 'cash', ...over },
  }, admin);

  /* ------------------------------------------------------------ ride quote */
  console.log('\nquote');
  await check('the quote prices each vehicle and marks an unpriced one unavailable', async () => {
    const quote = await rides.quoteAdminRide({ type: 'daily_cab', ride: { pickup, drop } });
    assert.equal(quote.zone.name, 'Indore');
    const sedanQuote = quote.vehicles.find((v) => v.vehicleTypeId === String(sedan));
    assert.equal(sedanQuote.available, true);
    assert.equal(sedanQuote.fare, 118);
    assert.equal(quote.vehicles.find((v) => v.vehicleTypeId === String(bike)).available, false);
  });

  /* ------------------------------------------------------------- ride flow */
  console.log('\na cab for a customer with no account');
  let ghostRide;
  await check('is saved awaiting, priced by the server, dispatched to nobody', async () => {
    const row = await cab(unregisteredPhone);
    ghostRide = row;
    assert.equal(row.kind, 'ride');
    assert.equal(row.bookingType, 'daily_cab');
    assert.equal(row.confirmation, 'awaiting');
    assert.equal(row.customer.registered, false);
    assert.equal(row.amount, 118);
    const doc = await Ride.findById(row.id);
    assert.equal(doc.bookingSource, 'admin');
    assert.equal(doc.userId, null);
    assert.equal(doc.status, 'searching');
    assert.ok(doc.scheduledAt > new Date());
    assert.equal(dispatch.getDispatchState(row.id)?.notifiedDriverIds?.length || 0, 0);
  });
  await check('is not offered by the restart dispatch, and not swept as stale', async () => {
    await dispatch.restoreScheduledDispatches();
    assert.equal(dispatch.getDispatchState(ghostRide.id)?.notifiedDriverIds?.length || 0, 0);
    await Ride.collection.updateOne({ _id: new mongoose.Types.ObjectId(ghostRide.id) }, { $set: { updatedAt: new Date(Date.now() - 3 * 3600000) } });
    const swept = await sweepStaleRides();
    assert.equal(swept.cancelled, 0);
    assert.equal((await Ride.findById(ghostRide.id)).status, 'searching');
  });
  await check('appears in the admin list under awaiting, with the customer\'s phone', async () => {
    const list = await svc.listAdminBookings({ confirmation: 'awaiting' });
    assert.equal(list.results.length, 1);
    assert.equal(list.results[0].customer.phone, unregisteredPhone);
    assert.equal(list.counts.awaiting, 1);
    assert.equal(list.results[0].canAssignDriver, true);
    assert.match(list.results[0].driverBlockedReason, /not registered/);
  });
  await check('a bad phone, name, vehicle or time is refused', async () => {
    await rejects(() => cab('12345'), 400, /10-digit/);
    await rejects(() => svc.createAdminBooking({ type: 'daily_cab', customer: { name: 'A', phone: '9833333333' }, scheduledAt: inMinutes(20), ride: {} }, admin), 400, /name/);
    await rejects(() => svc.createAdminBooking({ type: 'daily_cab', customer: { name: 'Customer', phone: '9833333333' }, scheduledAt: inMinutes(1), ride: { vehicleTypeId: String(sedan), pickup, drop } }, admin), 400, /5 minutes/);
    await rejects(() => svc.createAdminBooking({ type: 'daily_cab', customer: { name: 'Customer', phone: '9833333333' }, scheduledAt: inMinutes(20), ride: { vehicleTypeId: String(bike), pickup, drop } }, admin), 400, /no price/);
    await rejects(() => svc.createAdminBooking({ type: 'bus', customer: { name: 'Customer', phone: '9833333333' } }, admin), 400);
  });
  await check('the admin confirms it; with no account yet nothing is dispatched', async () => {
    const row = await svc.confirmAdminBooking({ kind: 'ride', id: ghostRide.id, actor: 'admin' });
    assert.equal(row.confirmation, 'confirmed');
    assert.equal(row.confirmedBy, 'admin');
    assert.equal(row.canConfirm, false);
    assert.equal(row.canCancel, true);
    assert.equal(dispatch.getDispatchState(ghostRide.id)?.notifiedDriverIds?.length || 0, 0);
    await rejects(() => svc.confirmAdminBooking({ kind: 'ride', id: ghostRide.id, actor: 'admin' }), 409, /already confirmed/);
  });
  await check('the customer registers: the booking is theirs, linked by phone', async () => {
    const newUser = oid();
    await User.collection.insertOne({ _id: newUser, name: 'New Customer', phone: unregisteredPhone, createdAt: new Date() });
    const user = await User.findById(newUser);
    assert.equal(await svc.linkAdminBookingsToUser(user), 1);
    assert.equal(String((await Ride.findById(ghostRide.id)).userId), String(newUser));
    assert.equal(await svc.linkAdminBookingsToUser(user), 0, 'linking twice does nothing');
    assert.equal((await User.findById(newUser)).currentRideId ?? null, null, 'the booking is not their current ride');
  });

  console.log('\na cab for a registered customer');
  let rideRow;
  await check('is created for their account without becoming their current ride', async () => {
    rideRow = await cab('9811111111');
    assert.equal(rideRow.customer.registered, true);
    const doc = await Ride.findById(rideRow.id);
    assert.equal(String(doc.userId), String(registered));
    assert.equal((await User.findById(registered)).currentRideId ?? null, null);
    assert.equal(rideRow.adminBooking.confirmation, 'awaiting');
  });
  await check('booking their own ride in the meantime does not cancel it', async () => {
    const { createRideRecord } = await import('../src/modules/taxi/services/rideService.js');
    const own = await createRideRecord({
      userId: registered, pickupCoords: [pickup.lng, pickup.lat], dropCoords: [drop.lng, drop.lat], pickupAddress: 'A', dropAddress: 'B',
      fare: 0, vehicleTypeId: String(sedan), paymentMethod: 'cash', serviceType: 'ride', transport_type: 'taxi',
    });
    assert.equal((await Ride.findById(rideRow.id)).status, 'searching');
    assert.equal(String((await User.findById(registered)).currentRideId), String(own._id));
    await Ride.deleteOne({ _id: own._id });
    await User.collection.updateOne({ _id: registered }, { $set: { currentRideId: null } });
  });
  await check('is hidden from drivers\' scheduled list until it is confirmed', async () => {
    const stillAwaiting = await Ride.find({
      scheduledAt: { $ne: null, $gte: new Date() },
      'adminBooking.confirmation': { $ne: 'awaiting' },
      status: 'searching',
    }).lean();
    assert.ok(!stillAwaiting.some((r) => String(r._id) === rideRow.id));
  });
  await check('the customer\'s ride history carries the admin booking, with confirm and cancel allowed', async () => {
    const { listRideHistoryForIdentity } = await import('../src/modules/taxi/services/rideService.js');
    const history = await listRideHistoryForIdentity({ role: 'user', entityId: String(registered), category: 'all', limit: 20 });
    const mine = history.results.find((r) => r.rideId === rideRow.id);
    assert.equal(mine.adminBooking.source, 'admin');
    assert.equal(mine.adminBooking.confirmation, 'awaiting');
    assert.equal(mine.adminBooking.canConfirm, true);
    assert.equal(mine.adminBooking.canCancel, true);
    assert.equal(mine.displayStatus, 'awaiting_confirmation');
    assert.equal(mine.adminBooking.createdByName, undefined, 'the admin\'s name is not shown to the customer');
  });

  console.log('\ngiving the cab a driver');
  await check('only drivers of the pickup zone with a suitable vehicle are offered', async () => {
    const { zone, results } = await rides.listEligibleDrivers(rideRow.id);
    assert.equal(zone.name, 'Indore');
    const names = results.map((d) => d.name).sort();
    assert.deepEqual(names, ['Zone A Driver', 'Zone A Offline']);
    assert.equal(results[0].name, 'Zone A Driver', 'online drivers come first');
    assert.ok(results[0].distanceKm >= 0);
  });
  await check('a driver from another zone, the wrong vehicle or a blocked wallet is refused', async () => {
    await rejects(() => rides.assignDriverToRide(rideRow.id, String(dOther._id)), 409, /not available/);
    await rejects(() => rides.assignDriverToRide(rideRow.id, String(dWrongVehicle._id)), 409, /not available/);
    await rejects(() => rides.assignDriverToRide(rideRow.id, String(dBlocked._id)), 409, /not available/);
  });
  await check('before confirmation the pick is only remembered: nobody is assigned or told', async () => {
    const result = await rides.assignDriverToRide(rideRow.id, String(dIn._id));
    assert.deepEqual(result, { assigned: false, preAssigned: true });
    const doc = await Ride.findById(rideRow.id);
    assert.equal(doc.driverId ?? null, null);
    assert.equal(String(doc.adminBooking.preAssignedDriverId), String(dIn._id));
    const list = await svc.listAdminBookings({ confirmation: 'awaiting', search: '9811111111' });
    assert.equal(list.results[0].preAssignedDriver.name, 'Zone A Driver');
  });
  await check('the customer confirms in their app: the picked driver is assigned for real', async () => {
    const out = await svc.confirmAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'user', userId: registered });
    assert.equal(out.confirmation, 'confirmed');
    assert.equal(out.confirmedBy, 'user');
    const doc = await Ride.findById(rideRow.id);
    assert.equal(String(doc.driverId), String(dIn._id));
    assert.equal(doc.status, 'accepted');
    assert.ok(doc.acceptedAt);
    const driver = await Driver.findById(dIn._id);
    assert.equal(driver.isOnRide, false, 'a trip for later does not make the driver busy now');
    assert.equal(out.driver.name, 'Zone A Driver');
  });
  await check('another customer cannot confirm or cancel it', async () => {
    await rejects(() => svc.cancelAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'user', userId: oid(), reason: 'x' }), 404);
  });
  await check('the admin swaps the driver, and the old one is released', async () => {
    const result = await rides.assignDriverToRide(rideRow.id, String(dOffline._id));
    assert.equal(result.assigned, true, 'an off-shift driver can be given a booked trip');
    const doc = await Ride.findById(rideRow.id);
    assert.equal(String(doc.driverId), String(dOffline._id));
    assert.equal(doc.status, 'accepted');
  });
  await check('removing the driver puts the booking back to waiting', async () => {
    await rides.unassignDriverFromRide(rideRow.id, { redispatch: false });
    const doc = await Ride.findById(rideRow.id);
    assert.equal(doc.driverId ?? null, null);
    assert.equal(doc.status, 'searching');
    assert.equal(doc.adminBooking.confirmation, 'confirmed');
  });
  await check('the admin cancels it with a reason: free of charge, customer told, record kept', async () => {
    await rejects(() => svc.cancelAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'admin', reason: ' ' }), 400, /reason/);
    const out = await svc.cancelAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'admin', reason: 'Customer called to cancel' });
    assert.equal(out.confirmation, 'cancelled');
    assert.equal(out.cancelReason, 'Customer called to cancel');
    assert.equal(out.canCancel, false);
    const doc = await Ride.findById(rideRow.id);
    assert.equal(doc.status, 'cancelled');
    assert.equal(doc.cancelled_by, 'admin');
    assert.equal(doc.cancellation_charge, 0);
    await rejects(() => svc.cancelAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'admin', reason: 'again' }), 409, /already cancelled/);
    await rejects(() => svc.confirmAdminBooking({ kind: 'ride', id: rideRow.id, actor: 'admin' }), 409);
  });
  await check('a started trip can no longer be confirmed, cancelled or given another driver', async () => {
    const row = await cab('9811111111');
    await svc.confirmAdminBooking({ kind: 'ride', id: row.id, actor: 'admin' });
    await Ride.collection.updateOne({ _id: new mongoose.Types.ObjectId(row.id) }, { $set: { status: 'ongoing', liveStatus: 'started', startedAt: new Date() } });
    await rejects(() => svc.cancelAdminBooking({ kind: 'ride', id: row.id, actor: 'admin', reason: 'too late' }), 409, /already started/);
    await rejects(() => svc.cancelAdminBooking({ kind: 'ride', id: row.id, actor: 'user', userId: registered }), 409, /already started/);
    await rejects(() => rides.assignDriverToRide(row.id, String(dIn._id)), 409, /already started/);
  });
  await check('the customer cancels their own awaiting booking, with or without a reason', async () => {
    const row = await cab('9811111111');
    const out = await svc.cancelAdminBooking({ kind: 'ride', id: row.id, actor: 'user', userId: registered });
    assert.equal(out.confirmation, 'cancelled');
    assert.equal(out.cancelledBy, 'user');
    assert.equal(out.cancelReason, 'Cancelled by the customer');
  });
  await check('a ride the customer cancelled the ordinary way also reads as cancelled', async () => {
    const row = await cab('9811111111');
    await Ride.collection.updateOne({ _id: new mongoose.Types.ObjectId(row.id) }, { $set: { status: 'cancelled', liveStatus: 'cancelled' } });
    const list = await svc.listAdminBookings({ confirmation: 'cancelled', search: row.code });
    assert.equal(list.results.length, 1);
    assert.equal(list.results[0].confirmation, 'cancelled');
  });

  console.log('\nairport, outstation and parcel');
  await check('an airport taxi takes one end from the airport the admin picked', async () => {
    const { Airport } = await import('../src/modules/taxi/admin/models/Airport.js');
    const airportId = oid();
    await Airport.collection.insertOne({ _id: airportId, name: 'Devi Ahilya Airport', active: true, status: 'active', location: { type: 'Point', coordinates: [75.8011, 22.7218] } });
    const row = await svc.createAdminBooking({
      type: 'airport', customer: { name: 'Flyer', phone: '9811111111' }, scheduledAt: inMinutes(30),
      ride: { vehicleTypeId: String(sedan), airportId: String(airportId), airportDirection: 'drop', pickup },
    }, admin);
    assert.equal(row.bookingType, 'airport');
    const doc = await Ride.findById(row.id);
    assert.equal(doc.dropAddress, 'Devi Ahilya Airport');
    assert.deepEqual(doc.dropLocation.coordinates, [75.8011, 22.7218]);
    assert.equal(doc.pickupAddress, pickup.address);
  });
  await check('an outstation booking is an intercity ride with its route', async () => {
    const { Vehicle: V } = await import('../src/modules/taxi/admin/models/Vehicle.js');
    const outVehicle = oid();
    await V.collection.insertOne({ _id: outVehicle, name: 'Outstation Sedan', active: true, status: 1, transport_type: 'intercity', createdAt: new Date() });
    await SetPrice.collection.insertOne({
      vehicle_type: outVehicle, transport_type: 'intercity', pricing_scope: 'ride', active: 1, status: 'active', zone_id: null,
      service_location_id: serviceLocation, service_tax: 5, outstation_base_price: 500, outstation_base_distance: 10, outstation_price_per_distance: 12, outstation_time_price: 1,
      admin_commision: 5, admin_commision_type: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    const row = await svc.createAdminBooking({
      type: 'outstation', customer: { name: 'Traveller', phone: '9811111111' }, scheduledAt: inMinutes(60),
      ride: { vehicleTypeId: String(outVehicle), pickup, drop: { address: 'Bhopal', lat: 23.2599, lng: 77.4126 }, fromCity: 'Indore', toCity: 'Bhopal', tripType: 'round-trip', passengers: 3 },
    }, admin);
    assert.equal(row.bookingType, 'outstation');
    const doc = await Ride.findById(row.id);
    assert.equal(doc.serviceType, 'intercity');
    assert.equal(doc.intercity.toCity, 'Bhopal');
    assert.equal(doc.intercity.tripType, 'round-trip');
    assert.equal(doc.intercity.passengers, 3);
  });
  await check('a parcel needs sender and receiver; for a customer with no account it waits for one', async () => {
    const parcelVehicle = oid();
    await Vehicle.collection.insertOne({ _id: parcelVehicle, name: 'Mini Truck', active: true, status: 1, transport_type: 'delivery', createdAt: new Date() });
    await SetPrice.collection.insertOne({
      vehicle_type: parcelVehicle, transport_type: 'delivery', pricing_scope: 'ride', active: 1, status: 'active', zone_id: null,
      service_location_id: serviceLocation, service_tax: 5, base_price: 90, base_distance: 2, price_per_distance: 10, time_price: 1,
      admin_commision: 5, admin_commision_type: 1, createdAt: new Date(), updatedAt: new Date(),
    });
    const body = (parcel) => ({
      type: 'parcel', customer: { name: 'Sender', phone: '9844444444' }, scheduledAt: inMinutes(30),
      ride: { vehicleTypeId: String(parcelVehicle), pickup, drop }, parcel,
    });
    await rejects(() => svc.createAdminBooking(body({ senderName: 'A' }), admin), 400);
    const row = await svc.createAdminBooking(body({ category: 'Documents', senderName: 'Sunil', senderMobile: '9100000001', receiverName: 'Rekha', receiverMobile: '9100000002', deliveryScope: 'city' }), admin);
    assert.equal(row.bookingType, 'parcel');
    const { Delivery } = await import('../src/modules/taxi/user/models/Delivery.js');
    assert.equal(await Delivery.countDocuments({ rideId: row.id }), 0, 'no account, no delivery record yet');
    const newUser = oid();
    await User.collection.insertOne({ _id: newUser, name: 'Sender', phone: '9844444444', createdAt: new Date() });
    await svc.linkAdminBookingsToUser(await User.findById(newUser));
    assert.equal(await Delivery.countDocuments({ rideId: row.id }), 1, 'the delivery record is made once they register');
  });

  /* ---------------------------------------------------------------- rental */
  console.log('\nrental');
  const rentalVehicle = oid();
  await RentalVehicleType.collection.insertOne({
    _id: rentalVehicle, name: 'Innova', status: 'active', active: true, transport_type: 'rental', vehicleCategory: 'Car', serviceStoreIds: [],
    pricing: [{ id: 'p8', label: '8 Hours', durationHours: 8, price: 2000, extraHourPrice: 200, includedKm: 80, extraKmPrice: 12, active: true }],
    advancePayment: { enabled: true, paymentMode: 'percentage', amount: 25, label: 'Advance' },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const rentalBody = (over = {}) => ({
    type: 'rental', customer: { name: 'Hirer', phone: '9811111111' },
    rental: {
      vehicleTypeId: String(rentalVehicle), packageId: 'p8', pickupDateTime: inMinutes(30), returnDateTime: inMinutes(30 + 10 * 60),
      serviceLocation: { id: String(serviceLocation), name: 'Indore hub', address: 'Hub St', city: 'Indore' }, ...over,
    },
  });
  let rentalRow;
  await check('is priced from the vehicle (8h package + 2 extra hours) with its advance, saved pending', async () => {
    rentalRow = await svc.createAdminBooking(rentalBody(), admin);
    assert.equal(rentalRow.kind, 'rental');
    assert.equal(rentalRow.amount, 2400);
    const doc = await RentalBookingRequest.findById(rentalRow.id);
    assert.equal(doc.bookingSource, 'admin');
    assert.equal(doc.payableNow, 600);
    assert.equal(doc.paymentStatus, 'pending');
    assert.equal(doc.status, 'pending');
    assert.equal(String(doc.userId), String(registered));
    assert.equal(rentalRow.confirmation, 'awaiting');
  });
  await check('an advance collected by hand is recorded as paid', async () => {
    const row = await svc.createAdminBooking(rentalBody({ advance: { received: true, mode: 'upi', reference: 'UPI123' } }), admin);
    const doc = await RentalBookingRequest.findById(row.id);
    assert.equal(doc.paymentStatus, 'paid');
    assert.equal(doc.payment.provider, 'manual');
    assert.equal(doc.payment.amount, 600);
    assert.equal(doc.paymentMethod, 'upi');
  });
  await check('a return before the pickup, or a retired package, is refused', async () => {
    await rejects(() => svc.createAdminBooking(rentalBody({ returnDateTime: inMinutes(10) }), admin), 400, /after the pickup/);
    await rejects(() => svc.createAdminBooking(rentalBody({ packageId: 'nope' }), admin), 400);
  });
  await check('confirming moves it to confirmed; cancelling keeps the reason', async () => {
    const out = await svc.confirmAdminBooking({ kind: 'rental', id: rentalRow.id, actor: 'user', userId: registered });
    assert.equal(out.confirmation, 'confirmed');
    assert.equal((await RentalBookingRequest.findById(rentalRow.id)).status, 'confirmed');
    const cancelled = await svc.cancelAdminBooking({ kind: 'rental', id: rentalRow.id, actor: 'admin', reason: 'Vehicle unavailable' });
    assert.equal(cancelled.confirmation, 'cancelled');
    const doc = await RentalBookingRequest.findById(rentalRow.id);
    assert.equal(doc.status, 'cancelled');
    assert.equal(doc.cancelReason, 'Vehicle unavailable');
  });
  await check('once a vehicle is handed over, it can no longer be cancelled', async () => {
    const row = await svc.createAdminBooking(rentalBody(), admin);
    await svc.confirmAdminBooking({ kind: 'rental', id: row.id, actor: 'admin' });
    await RentalBookingRequest.updateOne({ _id: row.id }, { $set: { status: 'assigned' } });
    await rejects(() => svc.cancelAdminBooking({ kind: 'rental', id: row.id, actor: 'admin', reason: 'too late' }), 409, /already started/);
  });
  await check('the customer\'s rental list shows it with confirm and cancel', async () => {
    const row = await svc.createAdminBooking(rentalBody(), admin);
    const doc = await RentalBookingRequest.findById(row.id).lean();
    const view = rules.describeAdminBooking('rental', doc);
    assert.equal(view.canConfirm, true);
    assert.equal(view.canCancel, true);
  });

  /* ----------------------------------------------------------------- tours */
  console.log('\ntours');
  const departure = { _id: oid(), startDate: new Date(Date.now() + 10 * 86400000), endDate: new Date(Date.now() + 14 * 86400000), totalSeats: 5, seatsBooked: 0, active: true };
  const tourPackage = oid();
  await TourPackage.collection.insertOne({
    _id: tourPackage, destination: 'Goa', pricePerPerson: 1000, durationLabel: '4D/3N', status: 'active', active: true,
    upcomingDates: [departure], upfrontPayment: { paymentMode: 'percentage', percentage: 20 }, createdAt: new Date(), updatedAt: new Date(),
  });
  const tourBody = (over = {}) => ({
    type: 'tour', customer: { name: 'Traveller', phone: '9811111111' },
    tour: { packageId: String(tourPackage), departureId: String(departure._id), personCount: 2, ...over },
  });
  const seatsBooked = async () => (await TourPackage.collection.findOne({ _id: tourPackage })).upcomingDates[0].seatsBooked;
  let tourRow;
  await check('holds the seats at once but is awaiting the customer\'s word', async () => {
    tourRow = await svc.createAdminBooking(tourBody({ initialPayment: { amount: 400, mode: 'cash' } }), admin);
    assert.equal(tourRow.kind, 'tour');
    assert.equal(tourRow.confirmation, 'awaiting');
    assert.equal(await seatsBooked(), 2);
    const doc = await TourBooking.findById(tourRow.id);
    assert.equal(String(doc.userId), String(registered));
    assert.equal(doc.status, 'confirmed');
    assert.equal(doc.bookingSource, 'admin');
  });
  await check('cannot be marked done until the customer has confirmed', async () => {
    await rejects(() => adminService.completeTourBooking(tourRow.id), 409);
    await svc.confirmAdminBooking({ kind: 'tour', id: tourRow.id, actor: 'user', userId: registered });
    assert.equal((await TourBooking.findById(tourRow.id)).adminBooking.confirmation, 'confirmed');
  });
  await check('cancelling gives the seats back and keeps the reason', async () => {
    const out = await svc.cancelAdminBooking({ kind: 'tour', id: tourRow.id, actor: 'admin', reason: 'Customer postponed the trip' });
    assert.equal(out.confirmation, 'cancelled');
    assert.equal(await seatsBooked(), 0);
    assert.equal((await TourBooking.findById(tourRow.id)).status, 'cancelled');
    await rejects(() => svc.cancelAdminBooking({ kind: 'tour', id: tourRow.id, actor: 'admin', reason: 'again' }), 409);
    assert.equal(await seatsBooked(), 0, 'a second cancel does not hand the seats back twice');
  });
  await check('a departure that has left cannot be cancelled', async () => {
    const row = await svc.createAdminBooking(tourBody({ personCount: 1 }), admin);
    await TourBooking.updateOne({ _id: row.id }, { $set: { 'departureSnapshot.startDate': new Date(Date.now() - 3600000) } });
    await rejects(() => svc.cancelAdminBooking({ kind: 'tour', id: row.id, actor: 'admin', reason: 'too late' }), 409, /already started/);
  });
  await check('seats cannot be oversold', async () => {
    await rejects(() => svc.createAdminBooking(tourBody({ personCount: 50 }), admin), 409, /seat/);
  });

  /* ------------------------------------------------------------------ list */
  console.log('\nthe admin list');
  await check('filters by type, confirmation and customer, with counts and paging', async () => {
    const all = await svc.listAdminBookings({ limit: 5, page: 1 });
    assert.ok(all.paginator.total > 5);
    assert.equal(all.results.length, 5);
    assert.equal(all.counts.all, all.counts.awaiting + all.counts.confirmed + all.counts.cancelled);
    const tours = await svc.listAdminBookings({ type: 'tour' });
    assert.ok(tours.results.every((r) => r.kind === 'tour'));
    const rentals = await svc.listAdminBookings({ type: 'rental', confirmation: 'cancelled' });
    assert.ok(rentals.results.length >= 1 && rentals.results.every((r) => r.confirmation === 'cancelled'));
    const mine = await svc.listAdminBookings({ search: '9844444444' });
    assert.equal(mine.results.length, 1);
    assert.equal((await svc.listAdminBookings({ search: '.*' })).results.length, 0, 'search is not a regex');
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll admin booking checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
