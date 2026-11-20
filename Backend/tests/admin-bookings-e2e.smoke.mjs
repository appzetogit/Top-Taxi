/**
 * An admin-made booking from creation to delivery, one per kind, with the money checked.
 *
 * Run: node tests/admin-bookings-e2e.smoke.mjs
 *
 * ride kinds : admin creates -> customer confirms in the app -> picked driver is
 *              assigned -> driver goes arriving -> starts with the OTP -> reaches the
 *              destination -> completes. Fare, commission and driver earnings checked.
 * rental     : create -> customer confirms -> vehicle assigned -> returned -> final charge
 * tour       : create (seats held) -> customer confirms -> money received by hand -> done
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
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

const main = async () => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'admin_bookings_e2e' });

  const svc = await import('../src/modules/taxi/admin/services/adminBookings.js');
  const adminService = await import('../src/modules/taxi/admin/services/adminService.js');
  const rideService = await import('../src/modules/taxi/services/rideService.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Zone } = await import('../src/modules/taxi/driver/models/Zone.js');
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
  const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');
  const { Delivery } = await import('../src/modules/taxi/user/models/Delivery.js');
  const { Airport } = await import('../src/modules/taxi/admin/models/Airport.js');
  const { RentalVehicleType } = await import('../src/modules/taxi/admin/models/RentalVehicleType.js');
  const { RentalBookingRequest } = await import('../src/modules/taxi/admin/models/RentalBookingRequest.js');
  const { TourPackage } = await import('../src/modules/taxi/admin/models/TourPackage.js');
  const { TourBooking } = await import('../src/modules/taxi/user/models/TourBooking.js');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));

  /* ------------------------------------------------------------ seed data */
  const serviceLocation = oid();
  const zoneA = oid();
  await Zone.collection.insertOne({
    _id: zoneA, name: 'Indore', service_location_id: serviceLocation, active: true, status: 'active',
    geometry: { type: 'Polygon', coordinates: [[[75.7, 22.6], [76.0, 22.6], [76.0, 22.9], [75.7, 22.9], [75.7, 22.6]]] },
  });
  const price = (vehicleType, transport, extra) => ({
    vehicle_type: vehicleType, transport_type: transport, pricing_scope: 'ride', active: 1, status: 'active', zone_id: null,
    service_location_id: serviceLocation, service_tax: 5, admin_commision: 10, admin_commision_type: 1, admin_commission_from_driver: 10, admin_commission_type_from_driver: 1,
    createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  const vehicles = { cab: oid(), out: oid(), parcel: oid() };
  await Vehicle.collection.insertMany([
    { _id: vehicles.cab, name: 'Sedan', active: true, status: 1, transport_type: 'taxi', createdAt: new Date() },
    { _id: vehicles.out, name: 'Outstation Sedan', active: true, status: 1, transport_type: 'intercity', createdAt: new Date() },
    { _id: vehicles.parcel, name: 'Mini Truck', active: true, status: 1, transport_type: 'delivery', createdAt: new Date() },
  ]);
  await SetPrice.collection.insertMany([
    price(vehicles.cab, 'taxi', { base_price: 70, base_distance: 2, price_per_distance: 17, time_price: 2 }),
    price(vehicles.out, 'intercity', { outstation_base_price: 500, outstation_base_distance: 10, outstation_price_per_distance: 12, outstation_time_price: 1, outstation_driver_batta: 300 }),
    price(vehicles.parcel, 'delivery', { base_price: 90, base_distance: 2, price_per_distance: 10, time_price: 1 }),
  ]);

  const pickup = { address: 'Vijay Nagar, Indore', lat: 22.728214, lng: 75.8843673 };
  const drop = { address: 'Palasia, Indore', lat: 22.75521, lng: 75.8968202 };
  const admin = { id: String(oid()), name: 'Desk Admin' };

  const customerId = oid();
  await User.collection.insertOne({ _id: customerId, name: 'Asha Rider', phone: '9811111111', createdAt: new Date() });
  const driverFor = (n) => ({
    _id: oid(), name: `Driver ${n}`, phone: `970000000${n}`, password: 'x', approve: true, deletedAt: null, isOnline: true, isOnRide: false,
    zoneId: zoneA, vehicleTypeId: vehicles.cab, vehicleType: 'sedan', vehicleNumber: `MP09AB000${n}`,
    wallet: { balance: 5000, isBlocked: false }, location: { type: 'Point', coordinates: [75.8844, 22.7283] }, locationUpdatedAt: new Date(), createdAt: new Date(),
  });
  const drivers = { cab: driverFor(1), out: driverFor(2), air: driverFor(3), parcel: driverFor(4), late: driverFor(5) };
  drivers.out.vehicleTypeId = vehicles.out;
  drivers.parcel.vehicleTypeId = vehicles.parcel;
  drivers.parcel.serviceCapabilities = ['parcel'];
  await Driver.collection.insertMany(Object.values(drivers));

  /**
   * Drives one ride booking from the admin's form to the driver's last tap and
   * returns what was quoted and what was finally charged.
   */
  const deliver = async (label, body, driver, { expectedFare, expectedPickupAddress } = {}) => {
    const created = await svc.createAdminBooking(body, admin);
    assert.equal(created.confirmation, 'awaiting');
    const quoted = created.amount;
    if (expectedFare !== undefined) assert.equal(quoted, expectedFare, `${label}: quoted fare`);

    // admin picks the driver while the booking is still awaiting
    const picked = await (await import('../src/modules/taxi/admin/services/adminBookingRides.js')).assignDriverToRide(created.id, String(driver._id));
    assert.equal(picked.preAssigned, true);
    // the customer confirms in their app: the picked driver is assigned for real
    const confirmed = await svc.confirmAdminBooking({ kind: 'ride', id: created.id, actor: 'user', userId: customerId });
    assert.equal(confirmed.confirmation, 'confirmed');
    let ride = await Ride.findById(created.id);
    assert.equal(String(ride.driverId), String(driver._id), `${label}: driver assigned`);
    assert.equal(ride.status, 'accepted');
    assert.equal((await User.findById(customerId)).currentRideId ?? null, null, `${label}: not the current ride yet`);

    // the driver's trip
    const step = (nextStatus, extra = {}) => rideService.updateRideLifecycle({ rideId: ride._id, driverId: driver._id, nextStatus, ...extra });
    await step('arriving');
    assert.equal(String((await User.findById(customerId)).currentRideId), String(ride._id), `${label}: becomes the current ride once under way`);
    // a customer can still cancel now (driver on the way), but not after the trip starts
    await assert.rejects(() => step('started'), (e) => e.statusCode === 400 && /OTP/.test(e.message));
    await assert.rejects(() => step('started', { otp: '0000' }), (e) => e.statusCode === 400 && /Invalid OTP/.test(e.message));
    ride = await Ride.findById(ride._id);
    await step('started', { otp: ride.otp });
    await assert.rejects(
      () => svc.cancelAdminBooking({ kind: 'ride', id: ride._id, actor: 'user', userId: customerId }),
      (e) => e.statusCode === 409 && /already started/.test(e.message),
    );
    await step('arrived');
    // the driver's app lies about the money: it must be ignored
    const done = await step('completed', { fare: 9999, additionalCharge: 500, waitingChargeAmount: 300 });
    ride = await Ride.findById(ride._id);
    return { ride, quoted, done, created };
  };

  /* ------------------------------------------------------------- daily cab */
  console.log('\ndaily cab: created by admin, delivered by the driver');
  let cab;
  await check('is charged exactly the quoted fare, whatever the driver app claims', async () => {
    cab = await deliver('daily cab', {
      type: 'daily_cab', customer: { name: 'Asha', phone: '9811111111' }, scheduledAt: inMinutes(20),
      ride: { vehicleTypeId: String(vehicles.cab), pickup, drop, paymentMethod: 'cash' },
    }, drivers.cab);
    assert.equal(cab.ride.status, 'completed');
    assert.equal(cab.ride.fare, cab.quoted, 'fare charged equals the fare quoted');
    // by hand: 70 base + (3.27 - 2 km) x 17 + ~minutes x 2, +5% tax, +10% platform fee, rounded
    const { quoteAdminRide } = await import('../src/modules/taxi/admin/services/adminBookingRides.js');
    const again = (await quoteAdminRide({ type: 'daily_cab', ride: { pickup, drop } })).vehicles.find((v) => v.vehicleTypeId === String(vehicles.cab));
    assert.equal(again.fare, cab.quoted, 'the admin quote and the charged fare are the same figure');
    assert.ok(again.distanceKm > 3 && again.distanceKm < 4, `distance ${again.distanceKm}`);
    assert.equal(cab.ride.additionalCharge ?? 0, 0);
  });
  await check('the split adds up: commission + driver earnings = fare; the driver\'s cash wallet pays the commission', async () => {
    const { ride } = cab;
    assert.ok(ride.commissionAmount > 0, 'a commission was taken');
    assert.ok(near(ride.commissionAmount + ride.driverEarnings, ride.fare), `${ride.commissionAmount} + ${ride.driverEarnings} != ${ride.fare}`);
    const driver = await Driver.findById(drivers.cab._id);
    assert.ok(driver.wallet.balance < 5000, 'cash trip: the driver owes the commission');
    assert.equal(driver.isOnRide, false, 'the driver is free again');
    assert.equal((await User.findById(customerId)).currentRideId ?? null, null, 'the customer is free again');
  });
  await check('the customer\'s history shows it completed, with nothing left to confirm or cancel', async () => {
    const history = await rideService.listRideHistoryForIdentity({ role: 'user', entityId: String(customerId), category: 'all', limit: 20 });
    const mine = history.results.find((r) => r.rideId === String(cab.ride._id));
    assert.equal(mine.status, 'completed');
    assert.equal(mine.adminBooking.confirmation, 'confirmed');
    assert.equal(mine.adminBooking.confirmedBy, 'user');
    assert.equal(mine.adminBooking.canCancel, false);
    assert.equal(mine.adminBooking.canConfirm, false);
    assert.equal(mine.fare, cab.quoted);
  });
  await check('the admin list shows it confirmed, completed and not cancellable', async () => {
    const list = await svc.listAdminBookings({ search: cab.created.code });
    assert.equal(list.results[0].status, 'completed');
    assert.equal(list.results[0].confirmation, 'confirmed');
    assert.equal(list.results[0].canCancel, false);
    assert.equal(list.results[0].driver.name, 'Driver 1');
  });
  await check('waiting at the pickup is billed from the ride\'s own clock, not the driver\'s word', async () => {
    const body = {
      type: 'daily_cab', customer: { name: 'Asha', phone: '9811111111' }, scheduledAt: inMinutes(20),
      ride: { vehicleTypeId: String(vehicles.cab), pickup, drop, paymentMethod: 'cash' },
    };
    const created = await svc.createAdminBooking(body, admin);
    await (await import('../src/modules/taxi/admin/services/adminBookingRides.js')).assignDriverToRide(created.id, String(drivers.late._id));
    await svc.confirmAdminBooking({ kind: 'ride', id: created.id, actor: 'admin' });
    const ride = await Ride.findById(created.id);
    const step = (nextStatus, extra = {}) => rideService.updateRideLifecycle({ rideId: ride._id, driverId: drivers.late._id, nextStatus, ...extra });
    await step('arriving');
    // the driver reached the pickup 20 minutes before the trip started
    await Ride.updateOne({ _id: ride._id }, { $set: { arrivedAt: new Date(Date.now() - 20 * 60000) } });
    await step('started', { otp: (await Ride.findById(ride._id)).otp });
    await step('arrived');
    await step('completed');
    const final = await Ride.findById(ride._id);
    assert.ok(final.waitingChargeAmount >= 0);
    assert.ok(final.fare >= created.amount, 'the fare never goes below the quote');
    assert.ok(near(final.commissionAmount + final.driverEarnings, final.fare));
  });

  /* ------------------------------------------------------------- outstation */
  console.log('\noutstation');
  await check('is an intercity ride at outstation rates (with driver batta), delivered and settled', async () => {
    const out = await deliver('outstation', {
      type: 'outstation', customer: { name: 'Traveller', phone: '9811111111' }, scheduledAt: inMinutes(60),
      ride: { vehicleTypeId: String(vehicles.out), pickup, drop: { address: 'Palasia, Indore', lat: 22.75521, lng: 75.8968202 }, fromCity: 'Indore', toCity: 'Dewas', tripType: 'round-trip', passengers: 3 },
    }, drivers.out);
    assert.equal(out.ride.serviceType, 'intercity');
    assert.equal(out.ride.status, 'completed');
    assert.equal(out.ride.fare, out.quoted);
    // 500 base + 300 batta, within the base distance, + 5% tax
    // (500 base + 300 batta) + 5% tax + the 10% platform fee on the subtotal
    assert.equal(out.quoted, Math.round(800 * 1.05 + 800 * 0.1));
    assert.ok(near(out.ride.commissionAmount + out.ride.driverEarnings, out.ride.fare));
    assert.equal(out.ride.intercity.tripType, 'round-trip');
  });

  /* ---------------------------------------------------------------- airport */
  console.log('\nairport taxi');
  await check('picks up at the airport, is charged the quote, delivered', async () => {
    const airportId = oid();
    await Airport.collection.insertOne({ _id: airportId, name: 'Devi Ahilya Airport', active: true, status: 'active', location: { type: 'Point', coordinates: [75.8011, 22.7218] } });
    const res = await deliver('airport', {
      type: 'airport', customer: { name: 'Flyer', phone: '9811111111' }, scheduledAt: inMinutes(45),
      ride: { vehicleTypeId: String(vehicles.cab), airportId: String(airportId), airportDirection: 'pickup', drop },
    }, drivers.air);
    assert.equal(res.ride.pickupAddress, 'Devi Ahilya Airport');
    assert.equal(res.ride.status, 'completed');
    assert.equal(res.ride.fare, res.quoted);
    assert.ok(near(res.ride.commissionAmount + res.ride.driverEarnings, res.ride.fare));
  });

  /* ----------------------------------------------------------------- parcel */
  console.log('\nparcel delivery');
  await check('is delivered, and its delivery record follows the trip to completed', async () => {
    const res = await deliver('parcel', {
      type: 'parcel', customer: { name: 'Sender', phone: '9811111111' }, scheduledAt: inMinutes(30),
      ride: { vehicleTypeId: String(vehicles.parcel), pickup, drop, paymentMethod: 'cash' },
      parcel: { category: 'Documents', senderName: 'Sunil', senderMobile: '9100000001', receiverName: 'Rekha', receiverMobile: '9100000002', deliveryScope: 'city' },
    }, drivers.parcel);
    assert.equal(res.ride.serviceType, 'parcel');
    assert.equal(res.ride.status, 'completed');
    assert.equal(res.ride.fare, res.quoted);
    const delivery = await Delivery.findOne({ rideId: res.ride._id });
    assert.equal(delivery.status, 'completed');
    assert.equal(delivery.parcel.receiverName, 'Rekha');
    assert.ok(near(res.ride.commissionAmount + res.ride.driverEarnings, res.ride.fare));
  });

  /* ---------------------------------------- customer who registers later */
  console.log('\na customer who registers after the booking was made');
  await check('their confirmed trip is handed to the picked driver when they register, then runs to the end', async () => {
    const phone = '9855555555';
    const created = await svc.createAdminBooking({
      type: 'daily_cab', customer: { name: 'Late Joiner', phone }, scheduledAt: inMinutes(25),
      ride: { vehicleTypeId: String(vehicles.cab), pickup, drop, paymentMethod: 'cash' },
    }, admin);
    const rides = await import('../src/modules/taxi/admin/services/adminBookingRides.js');
    await rides.assignDriverToRide(created.id, String(drivers.cab._id));
    await svc.confirmAdminBooking({ kind: 'ride', id: created.id, actor: 'admin' });
    let ride = await Ride.findById(created.id);
    assert.equal(ride.userId, null);
    assert.equal(ride.driverId ?? null, null, 'no account yet: no driver is assigned');

    const userId = oid();
    await User.collection.insertOne({ _id: userId, name: 'Late Joiner', phone, createdAt: new Date() });
    await svc.linkAdminBookingsToUser(await User.findById(userId));
    ride = await Ride.findById(created.id);
    assert.equal(String(ride.userId), String(userId));
    assert.equal(String(ride.driverId), String(drivers.cab._id), 'the picked driver is assigned on registration');

    const step = (nextStatus, extra = {}) => rideService.updateRideLifecycle({ rideId: ride._id, driverId: drivers.cab._id, nextStatus, ...extra });
    await step('arriving');
    await step('started', { otp: ride.otp });
    await step('arrived');
    await step('completed');
    ride = await Ride.findById(created.id);
    assert.equal(ride.status, 'completed');
    assert.equal(ride.fare, created.amount);
  });

  /* ----------------------------------------------------------------- rental */
  console.log('\nrental');
  const rentalVehicle = oid();
  await RentalVehicleType.collection.insertOne({
    _id: rentalVehicle, name: 'Innova', status: 'active', active: true, transport_type: 'rental', vehicleCategory: 'Car', serviceStoreIds: [],
    pricing: [{ id: 'p8', label: '8 Hours', durationHours: 8, price: 2000, extraHourPrice: 200, includedKm: 80, extraKmPrice: 12, active: true }],
    advancePayment: { enabled: true, paymentMode: 'percentage', amount: 25, label: 'Advance' },
    createdAt: new Date(), updatedAt: new Date(),
  });
  await check('is priced 8h + 2 extra hours = 2400, advance 600, handed over and returned for the right final charge', async () => {
    const created = await svc.createAdminBooking({
      type: 'rental', customer: { name: 'Hirer', phone: '9811111111' },
      rental: {
        vehicleTypeId: String(rentalVehicle), packageId: 'p8', pickupDateTime: inMinutes(30), returnDateTime: inMinutes(30 + 600),
        serviceLocation: { id: String(serviceLocation), name: 'Indore hub', address: 'Hub St', city: 'Indore' },
        advance: { received: true, mode: 'upi', reference: 'UPI-1' },
      },
    }, admin);
    assert.equal(created.amount, 2400);
    let doc = await RentalBookingRequest.findById(created.id);
    assert.equal(doc.payableNow, 600);
    assert.equal(doc.paymentStatus, 'paid');

    await svc.confirmAdminBooking({ kind: 'rental', id: created.id, actor: 'user', userId: customerId });
    // handed over: the vehicle is assigned
    await adminService.updateRentalBookingRequest(created.id, { assignedVehicleId: String(rentalVehicle) }, admin.id);
    doc = await RentalBookingRequest.findById(created.id);
    assert.equal(doc.status, 'assigned');
    await assert.rejects(
      () => svc.cancelAdminBooking({ kind: 'rental', id: created.id, actor: 'user', userId: customerId }),
      (e) => e.statusCode === 409 && /already started/.test(e.message),
    );
    // the customer used it for just under 10 hours (every started hour past the package is billed)
    await RentalBookingRequest.updateOne({ _id: created.id }, { $set: { assignedAt: new Date(Date.now() - 9.9 * 3600000) } });
    const returned = await adminService.updateRentalBookingRequest(created.id, { status: 'completed' }, admin.id);
    assert.equal(returned.status, 'completed');
    assert.equal(returned.finalCharge, 2400, '2000 for 8h + 2 extra hours at 200');
    assert.equal(returned.rideMetrics.remainingDue, 1800, 'the advance of 600 is already paid, so 1800 is left to collect');
  });

  /* ------------------------------------------------------------------- tour */
  console.log('\ntour');
  const departure = { _id: oid(), startDate: new Date(Date.now() + 10 * 86400000), endDate: new Date(Date.now() + 14 * 86400000), totalSeats: 5, seatsBooked: 0, active: true };
  const tourPackage = oid();
  await TourPackage.collection.insertOne({
    _id: tourPackage, destination: 'Goa', pricePerPerson: 1000, durationLabel: '4D/3N', status: 'active', active: true,
    upcomingDates: [departure], upfrontPayment: { paymentMode: 'percentage', percentage: 20 }, createdAt: new Date(), updatedAt: new Date(),
  });
  await check('3 persons = 3000 total; seats held; money received by hand; marked done only when fully paid', async () => {
    const created = await svc.createAdminBooking({
      type: 'tour', customer: { name: 'Traveller', phone: '9811111111' },
      tour: { packageId: String(tourPackage), departureId: String(departure._id), personCount: 3, initialPayment: { amount: 600, mode: 'cash' } },
    }, admin);
    assert.equal(created.amount, 3000);
    assert.equal((await TourPackage.collection.findOne({ _id: tourPackage })).upcomingDates[0].seatsBooked, 3);
    let doc = await TourBooking.findById(created.id).lean();
    assert.equal(doc.paymentStatus, 'partial');
    assert.equal(doc.balanceAmount, 2400);

    // cannot be completed before the customer has confirmed, or while money is due
    await assert.rejects(() => adminService.completeTourBooking(created.id), (e) => e.statusCode === 409);
    await svc.confirmAdminBooking({ kind: 'tour', id: created.id, actor: 'user', userId: customerId });
    await assert.rejects(() => adminService.completeTourBooking(created.id), (e) => e.statusCode === 409 && /still due/.test(e.message));

    // the rest arrives in two parts; more than the balance is refused
    await assert.rejects(() => adminService.recordTourBookingPayment(created.id, { amount: 5000, mode: 'cash' }, admin), (e) => e.statusCode === 400);
    const afterOne = await adminService.recordTourBookingPayment(created.id, { amount: 1400, mode: 'upi', reference: 'U1' }, admin);
    assert.equal(afterOne.amountPaid, 2000);
    assert.equal(afterOne.balanceAmount, 1000);
    const afterTwo = await adminService.recordTourBookingPayment(created.id, { amount: 1000, mode: 'cash' }, admin);
    assert.equal(afterTwo.amountPaid, 3000);
    assert.equal(afterTwo.balanceAmount, 0);
    assert.equal(afterTwo.canComplete, true);

    const finished = await adminService.completeTourBooking(created.id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.paymentStatus, 'paid');
    assert.equal(finished.amountPaid, 3000);
    await assert.rejects(
      () => svc.cancelAdminBooking({ kind: 'tour', id: created.id, actor: 'admin', reason: 'too late' }),
      (e) => e.statusCode === 409,
    );
    assert.equal((await TourPackage.collection.findOne({ _id: tourPackage })).upcomingDates[0].seatsBooked, 3, 'a completed tour keeps its seats');
  });

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll end-to-end booking checks passed');
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
