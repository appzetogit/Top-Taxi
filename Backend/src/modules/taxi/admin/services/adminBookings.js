/*
 * Bookings an admin makes for a customer, whatever kind they are.
 *
 * The admin books for someone on the phone, for a time a little way ahead. The
 * booking is saved at once but is not final: the admin rings the customer, and
 * when they agree marks it confirmed (or cancels it with a reason). The
 * customer sees the same booking in their app, as if they had made it
 * themselves, and can confirm or cancel it there too, until it starts.
 *
 * A booking is found by the customer's phone number, so one made for someone
 * who has not registered yet is waiting for them the moment they do.
 *
 * Kinds: ride (daily cab, outstation, airport, parcel), rental, tour. Pooling
 * and bus bookings are not made this way.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Ride } from '../../user/models/Ride.js';
import { RentalBookingRequest } from '../models/RentalBookingRequest.js';
import { TourBooking } from '../../user/models/TourBooking.js';
import { Driver } from '../../driver/models/Driver.js';
import { Vehicle } from '../models/Vehicle.js';
import { syncDeliveryWithRide } from '../../services/rideService.js';
import { emitToAdmins, emitToRoom, getUserRoom } from '../../services/dispatchService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { createAdminTourBooking } from './adminService.js';
import {
  RIDE_BOOKING_TYPES,
  activateConfirmedRide,
  cancelAdminRide,
  confirmAdminRide,
  createAdminRideBooking,
  findCustomerUser,
} from './adminBookingRides.js';
import { cancelAdminRental, confirmAdminRental, createAdminRentalBooking } from './adminBookingRentals.js';
import { cancelAdminTour, confirmAdminTour } from './adminBookingTours.js';
import { ADMIN_BOOKING_TYPES } from '../../common/adminBookingSchema.js';
import {
  BOOKING_KINDS,
  BOOKING_TYPE_LABEL,
  KIND_OF_TYPE,
  canCancel,
  canConfirm,
  checkCancelReason,
  describeAdminBooking,
  displayStatus,
  effectiveConfirmation,
  isValidCustomerPhone,
  normalizeCustomerPhone,
  notificationFor,
  phoneVariants,
  refusalFor,
} from '../../common/adminBookings.js';

const text = (value) => String(value ?? '').trim();
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const MODEL_OF_KIND = { ride: Ride, rental: RentalBookingRequest, tour: TourBooking };
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const whenOf = (kind, doc) => {
  if (kind === 'tour') return doc.departureSnapshot?.startDate || null;
  if (kind === 'rental') return doc.pickupDateTime || null;
  return doc.scheduledAt || null;
};

const codeOf = (kind, doc) => {
  if (kind === 'rental') return doc.bookingReference || '';
  if (kind === 'tour') return doc.bookingCode || '';
  const prefix = { parcel: 'DEL', intercity: 'INT' }[doc.serviceType] || 'REQ';
  return `${prefix}_${String(doc._id).slice(-12).toUpperCase()}`;
};

/* ---------------------------------------------------------------- notify */

/** Tells the customer, in the app and by push, if they have an account. Never fails the action. */
export const notifyCustomer = async (kind, doc, event, { reason = '' } = {}) => {
  try {
    if (!doc?.userId) return;
    const bookingType = doc.adminBooking?.bookingType;
    const { title, body } = notificationFor(event, { bookingType, when: whenOf(kind, doc), reason });
    const data = {
      type: `admin_booking_${event}`,
      kind,
      bookingType: String(bookingType || ''),
      bookingId: String(doc._id),
    };
    emitToRoom(getUserRoom(doc.userId), 'adminBooking:updated', { ...data, event, confirmation: effectiveConfirmation(doc) });
    await sendPushNotificationToEntities({ userIds: [String(doc.userId)], title, body, data });
  } catch (error) {
    console.error('Failed to notify the customer of an admin booking', error);
  }
};

const tellAdmins = (kind, doc, event) => {
  try {
    emitToAdmins('adminBooking:updated', {
      kind,
      bookingId: String(doc._id),
      event,
      confirmation: effectiveConfirmation(doc),
      bookingType: doc.adminBooking?.bookingType || '',
    });
  } catch (error) {
    console.error('Failed to tell the admin panel of a booking update', error);
  }
};

/* ---------------------------------------------------------------- create */

export const createAdminBooking = async (payload = {}, admin = null) => {
  const type = text(payload.type);
  if (!ADMIN_BOOKING_TYPES.includes(type)) throw new ApiError(400, 'Choose what kind of booking to make.');

  const customer = { name: text(payload.customer?.name), phone: normalizeCustomerPhone(payload.customer?.phone) };
  if (customer.name.length < 2) throw new ApiError(400, "Enter the customer's name.");
  if (!isValidCustomerPhone(customer.phone)) throw new ApiError(400, 'Enter a valid 10-digit mobile number for the customer.');

  const kind = KIND_OF_TYPE[type];
  let doc;

  if (kind === 'ride') {
    doc = await createAdminRideBooking(
      { type, customer, scheduledAt: payload.scheduledAt, notes: payload.notes, ride: payload.ride || {}, parcel: payload.parcel || {} },
      admin,
    );
  } else if (kind === 'rental') {
    const linked = await findCustomerUser(customer.phone);
    doc = await createAdminRentalBooking({ customer, rental: payload.rental || {}, notes: payload.notes }, admin, linked?._id || null);
  } else {
    const tour = payload.tour || {};
    const made = await createAdminTourBooking(
      {
        packageId: tour.packageId,
        departureId: tour.departureId,
        personCount: tour.personCount,
        initialPayment: tour.initialPayment,
        customerName: customer.name,
        customerPhone: customer.phone,
        notes: payload.notes,
      },
      admin,
    );
    doc = await TourBooking.findById(made.id);
  }

  await notifyCustomer(kind, doc, 'created');
  return (await serializeRows([{ kind, doc: doc.toObject ? doc.toObject() : doc }]))[0];
};

/* ----------------------------------------------------- confirm and cancel */

const loadBooking = async (kind, id, { userId = null } = {}) => {
  if (!BOOKING_KINDS.includes(kind)) throw new ApiError(400, 'Unknown booking kind.');
  if (!isId(id)) throw new ApiError(400, 'Valid booking id is required.');
  const doc = await MODEL_OF_KIND[kind].findById(id);
  if (!doc || !doc.adminBooking) throw new ApiError(404, 'Booking not found.');
  // A customer only ever reaches their own booking.
  if (userId && String(doc.userId || '') !== String(userId)) throw new ApiError(404, 'Booking not found.');
  return doc;
};

export const confirmAdminBooking = async ({ kind, id, actor, userId = null }) => {
  const doc = await loadBooking(kind, id, { userId });
  const refusal = refusalFor('confirm', kind, doc);
  if (refusal) throw new ApiError(409, refusal);

  const updated = kind === 'ride'
    ? await confirmAdminRide(id, { actor })
    : kind === 'rental'
      ? await confirmAdminRental(id, { actor })
      : await confirmAdminTour(id, { actor });

  if (actor === 'admin') await notifyCustomer(kind, updated, 'confirmed');
  else tellAdmins(kind, updated, 'confirmed');
  return (await serializeRows([{ kind, doc: updated.toObject() }]))[0];
};

export const cancelAdminBooking = async ({ kind, id, actor, reason, userId = null }) => {
  const doc = await loadBooking(kind, id, { userId });
  const refusal = refusalFor('cancel', kind, doc);
  if (refusal) throw new ApiError(409, refusal);

  let cleaned;
  if (actor === 'admin') {
    const check = checkCancelReason(reason);
    if (!check.ok) throw new ApiError(400, check.message);
    cleaned = check.reason;
  } else {
    cleaned = text(reason).slice(0, 300) || 'Cancelled by the customer';
  }

  const updated = kind === 'ride'
    ? await cancelAdminRide(id, { actor, reason: cleaned })
    : kind === 'rental'
      ? await cancelAdminRental(id, { actor, reason: cleaned })
      : await cancelAdminTour(id, { actor, reason: cleaned });

  if (actor === 'admin') await notifyCustomer(kind, updated, 'cancelled', { reason: cleaned });
  else tellAdmins(kind, updated, 'cancelled');
  return (await serializeRows([{ kind, doc: updated.toObject() }]))[0];
};

/* ------------------------------------------------------------------ link */

/**
 * Attaches the bookings made for this phone number to the customer's account. Runs
 * whenever a customer opens their bookings, so it works however and whenever they
 * signed up. A confirmed ride that was waiting for an account is handed to its driver now.
 */
export const linkAdminBookingsToUser = async (user) => {
  const variants = phoneVariants(user?.phone);
  if (!user?._id || !variants.length) return 0;

  let linked = 0;
  for (const kind of BOOKING_KINDS) {
    const Model = MODEL_OF_KIND[kind];
    const waiting = await Model.find({ bookingSource: 'admin', userId: null, 'adminBooking.customerPhone': { $in: variants } })
      .select('_id')
      .lean();
    if (!waiting.length) continue;

    const ids = waiting.map((item) => item._id);
    await Model.updateMany({ _id: { $in: ids }, userId: null }, { $set: { userId: user._id } });
    linked += ids.length;

    if (kind === 'ride') {
      for (const id of ids) {
        try {
          const ride = await Ride.findById(id);
          await syncDeliveryWithRide(ride);
          await activateConfirmedRide(id);
        } catch (error) {
          console.error('Failed to activate a linked admin booking', error);
        }
      }
    }
  }
  return linked;
};

/* ------------------------------------------------------------------ list */

const CONFIRMATION_FILTER = {
  awaiting: { 'adminBooking.confirmation': 'awaiting', status: { $ne: 'cancelled' } },
  confirmed: { 'adminBooking.confirmation': 'confirmed', status: { $ne: 'cancelled' } },
  cancelled: { $or: [{ 'adminBooking.confirmation': 'cancelled' }, { status: 'cancelled' }] },
};

const buildFilter = (kind, { type, confirmation, search, from, to }) => {
  const and = [{ bookingSource: 'admin' }];
  if (type) and.push({ 'adminBooking.bookingType': type });
  if (CONFIRMATION_FILTER[confirmation]) and.push(CONFIRMATION_FILTER[confirmation]);

  const term = text(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const or = [{ 'adminBooking.customerPhone': regex }, { 'adminBooking.customerName': regex }];
    if (kind === 'rental') or.push({ bookingReference: regex }, { vehicleName: regex });
    if (kind === 'tour') or.push({ bookingCode: regex }, { 'packageSnapshot.destination': regex });
    if (kind === 'ride') {
      or.push({ pickupAddress: regex }, { dropAddress: regex });
      const code = term.replace(/^(REQ|DEL|INT)_/i, '');
      if (/^[0-9a-f]{3,24}$/i.test(code)) {
        or.push({ $expr: { $regexMatch: { input: { $substrCP: [{ $toString: '$_id' }, 12, 12] }, regex: code.toLowerCase() } } });
      }
    }
    and.push({ $or: or });
  }

  const day = (value, endOfDay) => {
    const raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const start = day(from, false);
  const end = day(to, true);
  if (start || end) and.push({ createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) } });

  return { $and: and };
};

const driverLine = (driver) =>
  driver
    ? {
        id: String(driver._id),
        name: driver.name || '',
        phone: driver.phone || '',
        vehicleNumber: driver.vehicleNumber || '',
        vehicleType: driver.vehicleType || '',
      }
    : null;

const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const cleanRows = (rows) => rows.filter(([, value]) => value !== '' && value !== null && value !== undefined && value !== false);
const who = (actor) => (actor === 'user' ? 'the customer' : 'admin');

/** Everything about a booking, grouped for the admin's details view. */
const detailSections = (kind, doc, { vehicleName = '', driver = null, picked = null } = {}) => {
  const meta = doc.adminBooking || {};
  const sections = [];

  if (kind === 'ride') {
    const parcel = doc.parcel || {};
    const intercity = doc.intercity || {};
    sections.push({
      title: 'Trip',
      rows: cleanRows([
        ['Pickup', doc.pickupAddress],
        ['Drop', doc.dropAddress],
        ['Pickup time', when(doc.scheduledAt)],
        ['Vehicle', vehicleName],
        ['Distance', doc.estimatedDistanceMeters ? `${(doc.estimatedDistanceMeters / 1000).toFixed(1)} km` : ''],
        ['Duration', doc.estimatedDurationMinutes ? `${Math.round(doc.estimatedDurationMinutes)} min` : ''],
        ['Route', intercity.fromCity ? `${intercity.fromCity} → ${intercity.toCity}` : ''],
        ['Trip type', intercity.tripType],
        ['Passengers', intercity.fromCity ? intercity.passengers : ''],
      ]),
    });
    if (meta.bookingType === 'parcel') {
      sections.push({
        title: 'Parcel',
        rows: cleanRows([
          ['What', parcel.category],
          ['Weight', parcel.weightSlotLabel || parcel.weight],
          ['Delivery', parcel.deliveryScope === 'outstation' ? 'Outstation' : 'Within the city'],
          ['Sender', [parcel.senderName, parcel.senderMobile].filter(Boolean).join(' · ')],
          ['Receiver', [parcel.receiverName, parcel.receiverMobile].filter(Boolean).join(' · ')],
          ['Description', parcel.description],
        ]),
      });
    }
    sections.push({
      title: 'Fare and payment',
      rows: cleanRows([
        ['Fare', rupees(doc.fare)],
        ['Payment', doc.paymentMethod === 'online' ? 'Online' : 'Cash to the driver'],
      ]),
    });
    sections.push({
      title: 'Driver',
      rows: cleanRows(driver
        ? [['Assigned', driver.name], ['Phone', driver.phone], ['Vehicle number', driver.vehicleNumber], ['Trip OTP (tell the customer)', doc.otp]]
        : [['Assigned', 'No driver yet'], ['Picked by admin', picked ? `${picked.name} (assigned when confirmed)` : '']]),
    });
  } else if (kind === 'rental') {
    const balance = Math.max(0, Number(doc.totalCost || 0) - (doc.paymentStatus === 'paid' ? Number(doc.payableNow || 0) : 0));
    sections.push({
      title: 'Rental',
      rows: cleanRows([
        ['Vehicle', doc.vehicleName],
        ['Package', doc.selectedPackage?.label],
        ['Pickup', when(doc.pickupDateTime)],
        ['Return', when(doc.returnDateTime)],
        ['Duration', doc.requestedHours ? `${doc.requestedHours} h` : ''],
        ['Pickup hub', [doc.serviceLocation?.name, doc.serviceLocation?.address].filter(Boolean).join(', ')],
        ['Booking reference', doc.bookingReference],
      ]),
    });
    sections.push({
      title: 'Price and advance',
      rows: cleanRows([
        ['Total', rupees(doc.totalCost)],
        ['Advance asked', doc.payableNow ? rupees(doc.payableNow) : 'None'],
        ['Advance status', doc.paymentStatus],
        ['Paid by', doc.paymentMethod],
        ['Reference', doc.payment?.paymentId],
        ['Balance at pickup', rupees(balance)],
        ['Vehicle given', doc.assignedVehicle?.name],
      ]),
    });
  } else {
    const paid = (doc.payment?.status === 'paid' ? Number(doc.payment.amount || 0) : 0)
      + (doc.balancePayment?.status === 'paid' ? Number(doc.balancePayment.amount || 0) : 0)
      + (doc.manualPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    sections.push({
      title: 'Tour',
      rows: cleanRows([
        ['Package', doc.packageSnapshot?.destination],
        ['Duration', doc.packageSnapshot?.durationLabel],
        ['Departure', when(doc.departureSnapshot?.startDate)],
        ['Return', when(doc.departureSnapshot?.endDate)],
        ['Persons', doc.personCount],
        ['Booking code', doc.bookingCode],
      ]),
    });
    sections.push({
      title: 'Price and payment',
      rows: cleanRows([
        ['Price per person', rupees(doc.pricePerPerson)],
        ['Total', rupees(doc.totalAmount)],
        ['Upfront asked', rupees(doc.upfrontRequiredAmount)],
        ['Received so far', rupees(paid)],
        ['Balance', rupees(Math.max(0, Number(doc.totalAmount || 0) - paid))],
        ['Payments recorded', (doc.manualPayments || []).length || ''],
      ]),
    });
  }

  sections.push({
    title: 'Booking',
    rows: cleanRows([
      ['Made', `${when(doc.createdAt)}${meta.createdByName ? ` by ${meta.createdByName}` : ''}`],
      ['Notes', meta.notes],
      ['Confirmed', meta.confirmedAt ? `${when(meta.confirmedAt)} by ${who(meta.confirmedBy)}` : ''],
      ['Cancelled', meta.cancelledAt ? `${when(meta.cancelledAt)} by ${who(meta.cancelledBy)}` : ''],
      ['Cancel reason', meta.cancelReason],
      ['Needs attention', meta.activationNote],
    ]),
  });
  return sections;
};

/** One uniform row per booking, for the admin's list. */
const serializeRows = async (entries) => {
  const rides = entries.filter((entry) => entry.kind === 'ride').map((entry) => entry.doc);
  const driverIds = [
    ...new Set(
      rides.flatMap((ride) => [ride.driverId, ride.adminBooking?.preAssignedDriverId]).filter(Boolean).map((id) => String(id._id || id)),
    ),
  ];
  const drivers = driverIds.length
    ? await Driver.find({ _id: { $in: driverIds } }).select('name phone vehicleNumber vehicleType').lean()
    : [];
  const driverById = new Map(drivers.map((driver) => [String(driver._id), driver]));
  const vehicleIds = [...new Set(rides.map((ride) => String(ride.vehicleTypeId || '')).filter(Boolean))];
  const vehicleNames = new Map(
    vehicleIds.length ? (await Vehicle.find({ _id: { $in: vehicleIds } }).select('name').lean()).map((v) => [String(v._id), v.name || '']) : [],
  );
  const now = new Date();

  return entries.map(({ kind, doc }) => {
    const meta = doc.adminBooking || {};
    const confirmation = effectiveConfirmation(doc);
    const base = {
      key: `${kind}:${doc._id}`,
      kind,
      id: String(doc._id),
      code: codeOf(kind, doc),
      bookingType: meta.bookingType,
      bookingTypeLabel: BOOKING_TYPE_LABEL[meta.bookingType] || '',
      customer: { name: meta.customerName || '', phone: meta.customerPhone || '', registered: Boolean(doc.userId) },
      status: doc.status,
      displayStatus: displayStatus(doc),
      confirmation,
      canConfirm: canConfirm(kind, doc, now),
      canCancel: canCancel(kind, doc, now),
      cancelReason: meta.cancelReason || '',
      cancelledBy: meta.cancelledBy || '',
      confirmedBy: meta.confirmedBy || '',
      notes: meta.notes || '',
      createdAt: doc.createdAt || null,
      createdByName: meta.createdByName || '',
      when: whenOf(kind, doc),
      adminBooking: describeAdminBooking(kind, doc, { audience: 'admin', now }),
    };

    if (kind === 'ride') {
      const assigned = driverById.get(String(doc.driverId?._id || doc.driverId || ''));
      const picked = driverById.get(String(meta.preAssignedDriverId || ''));
      const intercity = doc.intercity || {};
      const parcel = doc.parcel || {};
      return {
        ...base,
        title: BOOKING_TYPE_LABEL[meta.bookingType] || 'Ride',
        subtitle: `${doc.pickupAddress || 'Pickup'} → ${doc.dropAddress || 'Drop'}`,
        detail: meta.bookingType === 'parcel'
          ? [parcel.category, parcel.receiverName && `to ${parcel.receiverName}`].filter(Boolean).join(' ')
          : [intercity.tripType, intercity.fromCity && `${intercity.fromCity} → ${intercity.toCity}`].filter(Boolean).join(' · '),
        amount: Number(doc.fare || 0),
        payment: { method: doc.paymentMethod || 'cash', status: '', due: 0 },
        driver: driverLine(assigned),
        preAssignedDriver: assigned ? null : driverLine(picked),
        activationNote: meta.activationNote || '',
        sections: detailSections(kind, doc, { vehicleName: vehicleNames.get(String(doc.vehicleTypeId || '')) || '', driver: driverLine(assigned), picked: driverLine(picked) }),
        canAssignDriver: canCancel(kind, doc, now),
        // Without an account there is nobody to notify, so a driver cannot be given the trip yet.
        driverBlockedReason: doc.userId ? '' : 'The customer has not registered in the app yet.',
      };
    }

    if (kind === 'rental') {
      return {
        ...base,
        title: doc.vehicleName || 'Rental',
        subtitle: [doc.selectedPackage?.label, doc.serviceLocation?.name].filter(Boolean).join(' · '),
        detail: '',
        amount: Number(doc.totalCost || 0),
        payment: { method: doc.paymentMethod || '', status: doc.paymentStatus || '', due: Math.max(0, Number(doc.totalCost || 0) - (doc.paymentStatus === 'paid' ? Number(doc.payableNow || 0) : 0)) },
        sections: detailSections(kind, doc),
      };
    }

    return {
      ...base,
      title: doc.packageSnapshot?.destination || 'Tour',
      subtitle: `${doc.personCount || 0} person(s)`,
      detail: '',
      amount: Number(doc.totalAmount || 0),
      payment: { method: '', status: doc.paymentStatus || '', due: Number(doc.balanceAmount || 0) },
      sections: detailSections(kind, doc),
    };
  });
};

export const listAdminBookings = async ({ type, confirmation, search, from, to, page = 1, limit = 20 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const wanted = ADMIN_BOOKING_TYPES.includes(type) ? type : '';
  const kinds = wanted ? [KIND_OF_TYPE[wanted]] : BOOKING_KINDS;
  const filterArgs = { type: wanted, confirmation, search, from, to };

  const fetched = await Promise.all(
    kinds.map(async (kind) => {
      const items = await MODEL_OF_KIND[kind].find(buildFilter(kind, filterArgs)).sort({ createdAt: -1 }).limit(300).lean();
      return items.map((doc) => ({ kind, doc }));
    }),
  );
  const merged = fetched.flat().sort((a, b) => new Date(b.doc.createdAt) - new Date(a.doc.createdAt));

  // The tab counts are over everything matching except the tab itself.
  const forCounts = (await Promise.all(
    kinds.map(async (kind) => {
      const items = await MODEL_OF_KIND[kind]
        .find(buildFilter(kind, { ...filterArgs, confirmation: '' }))
        .select('status adminBooking.confirmation')
        .limit(1000)
        .lean();
      return items;
    }),
  )).flat();
  const counts = { all: forCounts.length, awaiting: 0, confirmed: 0, cancelled: 0 };
  forCounts.forEach((doc) => {
    counts[effectiveConfirmation(doc)] += 1;
  });

  const rows = await serializeRows(merged.slice((safePage - 1) * safeLimit, safePage * safeLimit));
  return {
    results: rows,
    counts,
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total: merged.length,
      last_page: Math.max(1, Math.ceil(merged.length / safeLimit)),
    },
  };
};

/** What the customer is told after confirming or cancelling: the state, nothing of the admin's. */
export const describeForCustomer = async (kind, id) => {
  const doc = await MODEL_OF_KIND[kind].findById(id).lean();
  if (!doc) throw new ApiError(404, 'Booking not found.');
  return {
    kind,
    id: String(doc._id),
    status: doc.status,
    displayStatus: displayStatus(doc),
    adminBooking: describeAdminBooking(kind, doc),
  };
};

export { RIDE_BOOKING_TYPES, serializeRows as serializeAdminBookingRows };
