/*
 * Admin-made bookings that need a car: daily cab, outstation, airport taxi and
 * parcel delivery. They are all rides, made through the same createRideRecord the
 * customer's app uses, so the fare, the zone rules and everything the trip does
 * afterwards (OTP, commission, invoices) are exactly those of an ordinary ride.
 *
 * What differs is only when it reaches drivers. An admin-made ride is born
 * "awaiting": it is not offered to any driver, not counted as the customer's
 * current ride, and not swept as stale. Once the customer (or the admin on their
 * behalf) confirms it, it is handed to the driver the admin picked, or, with
 * none picked, offered to drivers like a ride the customer scheduled themselves.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { env } from '../../../../config/env.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { Driver } from '../../driver/models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { Airport } from '../models/Airport.js';
import { Delivery } from '../../user/models/Delivery.js';
import {
  acceptRideAssignment,
  buildDriverVehicleAcceptFilter,
  createRideRecord,
  findDriverConflictingScheduledRide,
  getRideRoom,
  quoteRideFares,
  syncDeliveryWithRide,
} from '../../services/rideService.js';
import {
  emitToRoom,
  getDriverRoom,
  getUserRoom,
  notifyRideAccepted,
  startDispatchFlow,
  stopDispatchFlow,
} from '../../services/dispatchService.js';
import { findZoneByPickup } from '../../services/matchingService.js';
import { releaseDriverAssignment } from '../../driver/services/driverAssignmentService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { ensureDeliveryVehicleAllowed } from '../../user/services/deliveryService.js';
import { SOCKET_EVENTS } from '../../socket/events.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import { checkLeadTime, effectiveConfirmation, hasStarted, phoneVariants } from '../../common/adminBookings.js';

const text = (value) => String(value ?? '').trim();
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const TRANSPORT_OF_TYPE = { daily_cab: 'taxi', airport: 'taxi', outstation: 'intercity', parcel: 'delivery' };
const SERVICE_OF_TYPE = { daily_cab: 'ride', airport: 'ride', outstation: 'intercity', parcel: 'parcel' };

export const RIDE_BOOKING_TYPES = Object.keys(TRANSPORT_OF_TYPE);

/** A place from the admin form: { address, lat, lng } -> [lng, lat] plus its address. */
const toPlace = (place, label) => {
  const lat = Number(place?.lat ?? place?.latitude);
  const lng = Number(place?.lng ?? place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw new ApiError(400, `Choose the ${label} location from the search results.`);
  }
  return { coords: [lng, lat], address: text(place?.address) };
};

/**
 * The two ends of the trip. An airport booking takes one end from the airport the
 * admin picked, so it is genuinely an airport trip and not a cab that happens to pass one.
 */
const resolveTripEnds = async (type, ride = {}) => {
  if (type !== 'airport') {
    return { pickup: toPlace(ride.pickup, 'pickup'), drop: toPlace(ride.drop, 'drop') };
  }

  if (!isId(ride.airportId)) throw new ApiError(400, 'Choose the airport.');
  const airport = await Airport.findById(ride.airportId).lean();
  if (!airport || airport.active === false || airport.status === 'inactive') throw new ApiError(404, 'Airport not found.');

  const point = airport.location?.coordinates?.length === 2
    ? airport.location.coordinates
    : [Number(airport.longitude), Number(airport.latitude)];
  const airportEnd = toPlace({ lng: point[0], lat: point[1], address: airport.name || 'Airport' }, 'airport');
  const direction = text(ride.airportDirection).toLowerCase() === 'drop' ? 'drop' : 'pickup';

  return direction === 'pickup'
    ? { pickup: airportEnd, drop: toPlace(ride.drop, 'drop'), airport }
    : { pickup: toPlace(ride.pickup, 'pickup'), drop: airportEnd, airport };
};

/** The customer's account, if they have one: a deleted account is as good as none. */
export const findCustomerUser = async (phone) => {
  const variants = phoneVariants(phone);
  if (!variants.length) return null;
  return User.findOne({ phone: { $in: variants }, deletedAt: null }).select('_id name phone').lean();
};

/* ------------------------------------------------------------------- quote */

/** What each vehicle would charge for this trip: the figure the admin tells the customer. */
export const quoteAdminRide = async ({ type, ride = {} } = {}) => {
  if (!RIDE_BOOKING_TYPES.includes(type)) throw new ApiError(400, 'Choose a booking type.');

  const ends = await resolveTripEnds(type, ride);
  const transportType = TRANSPORT_OF_TYPE[type];
  const zone = await findZoneByPickup(ends.pickup.coords);

  const vehicles = await Vehicle.find({
    transport_type: { $in: [transportType, 'both'] },
    active: { $ne: false },
    status: { $ne: 0 },
  })
    .select('name image map_icon icon capacity transport_type')
    .sort({ name: 1 })
    .lean();

  const quotes = vehicles.length
    ? await quoteRideFares({
      pickupCoords: ends.pickup.coords,
      dropCoords: ends.drop.coords,
      vehicleTypeIds: vehicles.map((vehicle) => String(vehicle._id)),
      transport_type: transportType,
      service_location_id: zone?.service_location_id ? String(zone.service_location_id) : null,
      weightSlotId: ride.weightSlotId,
      goodsTypeId: ride.goodsTypeId,
    })
    : [];
  const byVehicle = new Map(quotes.map((quote) => [quote.vehicleTypeId, quote]));

  return {
    zone: zone ? { id: String(zone._id), name: zone.name || '' } : null,
    pickup: { address: ends.pickup.address, lat: ends.pickup.coords[1], lng: ends.pickup.coords[0] },
    drop: { address: ends.drop.address, lat: ends.drop.coords[1], lng: ends.drop.coords[0] },
    vehicles: vehicles.map((vehicle) => {
      const quote = byVehicle.get(String(vehicle._id));
      return {
        vehicleTypeId: String(vehicle._id),
        name: vehicle.name || '',
        image: vehicle.image || vehicle.map_icon || vehicle.icon || '',
        capacity: Number(vehicle.capacity || 0),
        available: Boolean(quote?.available),
        fare: quote?.fare ? Number(quote.fare.total || 0) : null,
        distanceKm: quote ? Math.round((Number(quote.measuredDistanceMeters || 0) / 1000) * 10) / 10 : null,
        durationMinutes: quote ? Math.round(Number(quote.measuredDurationMinutes || 0)) : null,
      };
    }),
  };
};

/* ------------------------------------------------------------------ driver */

const haversineKm = ([lng1, lat1], [lng2, lat2]) => {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

const loadOpenAdminRide = async (rideId) => {
  if (!isId(rideId)) throw new ApiError(400, 'Valid booking id is required.');
  const ride = await Ride.findById(rideId);
  if (!ride || !ride.adminBooking) throw new ApiError(404, 'Booking not found.');
  if (effectiveConfirmation(ride) === 'cancelled' || ['cancelled', 'completed'].includes(text(ride.status))) {
    throw new ApiError(409, 'This booking is already closed.');
  }
  if (hasStarted('ride', ride)) throw new ApiError(409, 'This trip has already started, so the driver can no longer be changed.');
  return ride;
};

/** A driver the admin may give this ride to: same zone, approved, able to take this vehicle. */
const driverFilterFor = async (ride, zone) => {
  const clauses = [
    { deletedAt: null },
    { approve: { $ne: false } },
    { 'wallet.isBlocked': { $ne: true } },
  ];
  if (zone) clauses.push({ zoneId: zone._id });
  const vehicleFilter = await buildDriverVehicleAcceptFilter(ride);
  if (Object.keys(vehicleFilter).length) clauses.push(vehicleFilter);
  if (env.unifiedDispatchEnabled) {
    clauses.push({ serviceCapabilities: ride.serviceType === 'parcel' ? 'parcel' : 'taxi' });
  }
  return { $and: clauses };
};

export const listEligibleDrivers = async (rideId, { search = '' } = {}) => {
  const ride = await loadOpenAdminRide(rideId);
  const zone = await findZoneByPickup(ride.pickupLocation.coordinates);
  const filter = await driverFilterFor(ride, zone);

  const term = text(search);
  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and.push({ $or: [{ name: regex }, { phone: regex }, { vehicleNumber: regex }] });
  }

  const drivers = await Driver.find(filter)
    .select('name phone profileImage vehicleType vehicleNumber vehicleColor vehicleMake vehicleModel rating isOnline isOnRide location locationUpdatedAt')
    .limit(200)
    .lean();

  const rows = await Promise.all(drivers.map(async (driver) => {
    const conflict = await findDriverConflictingScheduledRide({ driverId: String(driver._id), ride, excludeRideId: ride._id });
    const [lng, lat] = driver.location?.coordinates || [];
    const hasPosition = Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
    return {
      id: String(driver._id),
      name: driver.name || '',
      phone: driver.phone || '',
      profileImage: driver.profileImage || '',
      vehicleType: driver.vehicleType || '',
      vehicleNumber: driver.vehicleNumber || '',
      vehicleColor: driver.vehicleColor || '',
      vehicle: [driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' '),
      rating: Number(driver.rating || 0),
      isOnline: Boolean(driver.isOnline),
      isOnRide: Boolean(driver.isOnRide),
      distanceKm: hasPosition ? Math.round(haversineKm([lng, lat], ride.pickupLocation.coordinates) * 10) / 10 : null,
      locationUpdatedAt: driver.locationUpdatedAt || null,
      hasScheduleConflict: Boolean(conflict),
      isCurrent: String(ride.driverId || ride.adminBooking.preAssignedDriverId || '') === String(driver._id),
    };
  }));

  rows.sort((a, b) =>
    Number(b.isOnline) - Number(a.isOnline)
    || Number(a.hasScheduleConflict) - Number(b.hasScheduleConflict)
    || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
  );

  return { zone: zone ? { id: String(zone._id), name: zone.name || '' } : null, results: rows };
};

/** Refuses a driver who is outside the ride's zone, or otherwise cannot take it. */
const assertDriverCanTake = async (ride, driverId) => {
  if (!isId(driverId)) throw new ApiError(400, 'Choose a driver.');
  const zone = await findZoneByPickup(ride.pickupLocation.coordinates);
  const filter = await driverFilterFor(ride, zone);
  const driver = await Driver.findOne({ $and: [{ _id: driverId }, ...filter.$and] }).select('_id name').lean();
  if (!driver) {
    throw new ApiError(
      409,
      zone
        ? `That driver is not available for this booking. Only approved drivers of the ${zone.name || 'pickup'} zone with a suitable vehicle can be assigned.`
        : 'That driver is not available for this booking.',
    );
  }
  return driver;
};

const pushToDriver = (driverId, title, body, data) =>
  sendPushNotificationToEntities({ driverIds: [String(driverId)], title, body, data }).catch((error) => {
    console.error('Failed to push admin-booking update to driver', error);
  });

/** Hands a confirmed ride to a driver: the same acceptance a driver makes in their app. */
const assignNow = async (ride, driverId) => {
  const accepted = await acceptRideAssignment({ rideId: ride._id, driverId, byAdmin: true });
  await Ride.updateOne(
    { _id: ride._id },
    { $set: { 'adminBooking.preAssignedDriverId': driverId, 'adminBooking.activationNote': '' } },
  );
  await notifyRideAccepted(accepted);
  pushToDriver(driverId, 'New trip assigned', 'A trip has been assigned to you. Open the app for the pickup details.', {
    type: 'ride_assigned',
    rideId: String(ride._id),
  });
  return accepted;
};

/** Frees the driver of an assigned ride, and leaves them busy only if they truly are. */
const releaseDriver = async (ride) => {
  if (!ride.driverId) return;
  const otherJob = await Ride.exists({
    driverId: ride.driverId,
    _id: { $ne: ride._id },
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date() } }],
  });
  if (!otherJob) await Driver.updateOne({ _id: ride.driverId }, { $set: { isOnRide: false } });
  await releaseDriverAssignment(ride.driverId, ride._id);
};

export const assignDriverToRide = async (rideId, driverId) => {
  const ride = await loadOpenAdminRide(rideId);
  await assertDriverCanTake(ride, driverId);

  // Before the customer confirms, the pick is only remembered: nobody is told.
  if (effectiveConfirmation(ride) === 'awaiting') {
    await Ride.updateOne({ _id: ride._id }, { $set: { 'adminBooking.preAssignedDriverId': driverId } });
    return { assigned: false, preAssigned: true };
  }

  if (!ride.userId) {
    throw new ApiError(409, 'The customer has not registered in the app yet. A driver can be assigned once they register with this number.');
  }
  if (String(ride.driverId || '') === String(driverId)) return { assigned: true, preAssigned: false };

  if (ride.driverId) await unassignDriverFromRide(rideId, { redispatch: false });
  stopDispatchFlow(ride._id);
  await assignNow(await Ride.findById(ride._id), driverId);
  return { assigned: true, preAssigned: false };
};

export const unassignDriverFromRide = async (rideId, { redispatch = true } = {}) => {
  const ride = await loadOpenAdminRide(rideId);

  if (!ride.driverId) {
    await Ride.updateOne({ _id: ride._id }, { $set: { 'adminBooking.preAssignedDriverId': null } });
    return { unassigned: true };
  }

  const driverId = ride.driverId;
  const reverted = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId, status: RIDE_STATUS.ACCEPTED },
    {
      $set: {
        status: RIDE_STATUS.SEARCHING,
        liveStatus: RIDE_LIVE_STATUS.SEARCHING,
        'adminBooking.preAssignedDriverId': null,
      },
      $unset: { driverId: '', acceptedAt: '' },
    },
    { new: true },
  );
  if (!reverted) throw new ApiError(409, 'This booking changed just now. Refresh and try again.');

  await releaseDriver(ride);
  emitToRoom(getDriverRoom(driverId), 'rideRequestClosed', { rideId: String(ride._id), reason: 'driver-removed-by-admin' });
  pushToDriver(driverId, 'Trip removed', 'A trip that was assigned to you has been taken back.', {
    type: 'ride_unassigned',
    rideId: String(ride._id),
  });
  await syncDeliveryWithRide(reverted);

  if (reverted.userId) {
    emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
      rideId: String(ride._id),
      status: reverted.status,
      liveStatus: reverted.liveStatus,
    });
    if (redispatch && effectiveConfirmation(reverted) === 'confirmed') await startDispatchFlow(reverted);
  }
  return { unassigned: true };
};

/* ------------------------------------------------------------------ create */

const intercityPayload = (ride = {}, scheduledAt) => ({
  fromCity: text(ride.fromCity),
  toCity: text(ride.toCity),
  tripType: text(ride.tripType) === 'round-trip' ? 'round-trip' : 'one-way',
  travelDate: new Date(scheduledAt).toISOString().slice(0, 10),
  passengers: Math.max(1, Number(ride.passengers) || 1),
  vehicleName: text(ride.vehicleName),
});

const parcelPayload = (parcel = {}) => {
  const senderName = text(parcel.senderName);
  const receiverName = text(parcel.receiverName);
  const senderMobile = text(parcel.senderMobile).replace(/\D/g, '').slice(-10);
  const receiverMobile = text(parcel.receiverMobile).replace(/\D/g, '').slice(-10);
  if (senderName.length < 2 || receiverName.length < 2) throw new ApiError(400, 'Enter the sender and receiver names.');
  if (!/^\d{10}$/.test(senderMobile) || !/^\d{10}$/.test(receiverMobile)) {
    throw new ApiError(400, 'Enter a valid 10-digit mobile number for the sender and the receiver.');
  }
  return {
    category: text(parcel.category),
    weight: text(parcel.weight),
    description: text(parcel.description),
    goodsTypeId: text(parcel.goodsTypeId),
    weightSlotId: text(parcel.weightSlotId),
    deliveryScope: text(parcel.deliveryScope) === 'outstation' ? 'outstation' : 'city',
    isOutstation: text(parcel.deliveryScope) === 'outstation',
    senderName,
    senderMobile,
    receiverName,
    receiverMobile,
  };
};

export const createAdminRideBooking = async ({ type, customer, scheduledAt, notes, ride = {}, parcel = {} }, admin) => {
  if (!RIDE_BOOKING_TYPES.includes(type)) throw new ApiError(400, 'Choose a booking type.');
  if (!isId(ride.vehicleTypeId)) throw new ApiError(400, 'Choose a vehicle.');

  const lead = checkLeadTime(scheduledAt);
  if (!lead.ok) throw new ApiError(400, lead.message);

  const ends = await resolveTripEnds(type, ride);
  const zone = await findZoneByPickup(ends.pickup.coords);
  const linkedUser = await findCustomerUser(customer.phone);

  const parcelData = type === 'parcel' ? parcelPayload(parcel) : undefined;
  if (parcelData) await ensureDeliveryVehicleAllowed({ vehicleTypeId: ride.vehicleTypeId, parcel: parcelData });

  // A trip with no price would be booked for nothing, so the vehicle must be priced for it.
  const [quote] = await quoteRideFares({
    pickupCoords: ends.pickup.coords,
    dropCoords: ends.drop.coords,
    vehicleTypeIds: [String(ride.vehicleTypeId)],
    transport_type: TRANSPORT_OF_TYPE[type],
    service_location_id: zone?.service_location_id ? String(zone.service_location_id) : null,
    weightSlotId: parcelData?.weightSlotId,
    goodsTypeId: parcelData?.goodsTypeId,
  });
  if (!quote?.available || !(Number(quote.fare?.total) > 0)) {
    throw new ApiError(400, 'This vehicle has no price set for this trip. Choose another vehicle.');
  }

  const preAssigned = isId(ride.driverId) ? ride.driverId : null;

  const created = await createRideRecord({
    userId: linkedUser?._id || null,
    pickupCoords: ends.pickup.coords,
    dropCoords: ends.drop.coords,
    pickupAddress: ends.pickup.address,
    dropAddress: ends.drop.address,
    fare: 0,
    vehicleTypeId: String(ride.vehicleTypeId),
    paymentMethod: text(ride.paymentMethod) === 'online' ? 'online' : 'cash',
    serviceType: SERVICE_OF_TYPE[type],
    transport_type: TRANSPORT_OF_TYPE[type],
    service_location_id: zone?.service_location_id ? String(zone.service_location_id) : undefined,
    scheduledAt: lead.date,
    intercity: type === 'outstation' ? intercityPayload(ride, lead.date) : undefined,
    parcel: parcelData,
    adminBooking: {
      createdBy: admin?.id && isId(admin.id) ? admin.id : null,
      createdByName: text(admin?.name),
      bookingType: type,
      customerPhone: customer.phone,
      customerName: customer.name,
      notes: text(notes),
    },
  });

  if (preAssigned) {
    try {
      await assertDriverCanTake(created, preAssigned);
      await Ride.updateOne({ _id: created._id }, { $set: { 'adminBooking.preAssignedDriverId': preAssigned } });
    } catch (error) {
      await Ride.updateOne({ _id: created._id }, { $set: { 'adminBooking.activationNote': error.message } });
    }
  }

  return Ride.findById(created._id);
};

/* --------------------------------------------------------------- lifecycle */

/**
 * Once a ride is confirmed and the customer has an account, it goes to its driver: the
 * one the admin picked, or, failing that, every driver nearby. Safe to call twice.
 */
export const activateConfirmedRide = async (rideId) => {
  const ride = await Ride.findById(rideId);
  if (
    !ride
    || ride.bookingSource !== 'admin'
    || ride.status !== RIDE_STATUS.SEARCHING
    || ride.driverId
    || !ride.userId
    || effectiveConfirmation(ride) !== 'confirmed'
  ) {
    return { activated: false };
  }

  const picked = ride.adminBooking.preAssignedDriverId;
  if (picked) {
    try {
      await assertDriverCanTake(ride, picked);
      await assignNow(ride, picked);
      return { activated: true, assigned: true };
    } catch (error) {
      // The picked driver is no longer free. The ride is still confirmed, so it falls
      // back to being offered to drivers, and the admin sees why on the booking.
      await Ride.updateOne({ _id: ride._id }, { $set: { 'adminBooking.activationNote': `Picked driver could not be assigned: ${error.message}` } });
    }
  }

  await startDispatchFlow(await Ride.findById(ride._id));
  return { activated: true, assigned: false };
};

/** Cancels a ride that has not started and lets go of everyone it touched. */
export const cancelAdminRide = async (rideId, { actor, reason }) => {
  const cancelled = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      bookingSource: 'admin',
      status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED] },
      liveStatus: { $nin: [RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED, RIDE_LIVE_STATUS.COMPLETED, RIDE_LIVE_STATUS.CANCELLED] },
    },
    {
      $set: {
        status: RIDE_STATUS.CANCELLED,
        liveStatus: RIDE_LIVE_STATUS.CANCELLED,
        cancelled_by: actor,
        cancellation_reason: reason,
        cancellation_time: new Date(),
        cancellation_charge: 0,
        'adminBooking.confirmation': 'cancelled',
        'adminBooking.cancelledAt': new Date(),
        'adminBooking.cancelledBy': actor,
        'adminBooking.cancelReason': reason,
      },
    },
    { new: false },
  );
  if (!cancelled) throw new ApiError(409, 'This booking changed just now. Refresh and try again.');

  stopDispatchFlow(rideId);
  await releaseDriver(cancelled);
  if (cancelled.userId) {
    await User.updateOne({ _id: cancelled.userId, currentRideId: cancelled._id }, { $set: { currentRideId: null } });
  }
  if (cancelled.deliveryId) {
    await Delivery.findByIdAndUpdate(cancelled.deliveryId, { status: RIDE_STATUS.CANCELLED, liveStatus: RIDE_LIVE_STATUS.CANCELLED });
  }

  const payload = { rideId: String(rideId), room: getRideRoom(rideId), reason: reason || 'Booking cancelled' };
  if (cancelled.userId) emitToRoom(getUserRoom(cancelled.userId), 'rideCancelled', payload);
  if (cancelled.driverId) {
    emitToRoom(getDriverRoom(cancelled.driverId), 'rideRequestClosed', { rideId: String(rideId), reason: 'booking-cancelled' });
    pushToDriver(cancelled.driverId, 'Trip cancelled', 'A trip assigned to you has been cancelled.', {
      type: 'ride_cancelled',
      rideId: String(rideId),
    });
  }
  emitToRoom(getRideRoom(rideId), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(rideId),
    status: RIDE_STATUS.CANCELLED,
    liveStatus: RIDE_LIVE_STATUS.CANCELLED,
  });

  return Ride.findById(rideId);
};

export const confirmAdminRide = async (rideId, { actor }) => {
  const confirmed = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      bookingSource: 'admin',
      'adminBooking.confirmation': 'awaiting',
      status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED] },
    },
    {
      $set: {
        'adminBooking.confirmation': 'confirmed',
        'adminBooking.confirmedAt': new Date(),
        'adminBooking.confirmedBy': actor,
      },
    },
    { new: true },
  );
  if (!confirmed) throw new ApiError(409, 'This booking changed just now. Refresh and try again.');

  await activateConfirmedRide(rideId);
  return Ride.findById(rideId);
};
