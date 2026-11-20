/*
 * The rules of a booking an admin made for a customer, in one place.
 *
 * Pure functions, no database: the admin panel, the customer's app and the tests
 * all ask the same questions and have to get the same answers.
 *
 * A booking is one of three kinds, whatever it is called on screen:
 *   ride    - daily cab, outstation, airport taxi and parcel delivery
 *   rental  - a rental package
 *   tour    - a tour package departure
 */

export const BOOKING_KINDS = ['ride', 'rental', 'tour'];

export const BOOKING_TYPE_LABEL = {
  daily_cab: 'Daily Cab',
  outstation: 'Outstation',
  airport: 'Airport Taxi',
  parcel: 'Parcel Delivery',
  rental: 'Rental',
  tour: 'Tour',
};

export const KIND_OF_TYPE = {
  daily_cab: 'ride',
  outstation: 'ride',
  airport: 'ride',
  parcel: 'ride',
  rental: 'rental',
  tour: 'tour',
};

export const MIN_CANCEL_REASON_LENGTH = 3;
export const MIN_LEAD_MINUTES = 5;

const text = (value) => String(value ?? '').trim();

/** A phone as the customers collection stores it: 10 digits, no country code. */
export const normalizeCustomerPhone = (value) => {
  const digits = text(value).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};

export const isValidCustomerPhone = (value) => /^\d{10}$/.test(normalizeCustomerPhone(value));

/** Every way the same number may have been saved on a user account. */
export const phoneVariants = (value) => {
  const phone = normalizeCustomerPhone(value);
  return phone ? [phone, `91${phone}`, `+91${phone}`] : [];
};

const startOf = (kind, doc = {}) => {
  if (kind === 'tour') return doc.departureSnapshot?.startDate;
  if (kind === 'rental') return doc.pickupDateTime;
  return doc.scheduledAt;
};

/** Has the booking begun? After that it can no longer be confirmed or cancelled. */
export const hasStarted = (kind, doc = {}, now = new Date()) => {
  const status = text(doc.status).toLowerCase();
  const live = text(doc.liveStatus).toLowerCase();

  if (kind === 'ride') {
    return ['ongoing', 'completed'].includes(status) || ['started', 'arrived', 'completed'].includes(live) || Boolean(doc.startedAt);
  }
  if (kind === 'rental') {
    return ['assigned', 'end_requested', 'completed'].includes(status);
  }
  // A tour has begun once its departure date has come.
  const departure = startOf('tour', doc);
  const departureTime = departure ? new Date(departure).getTime() : NaN;
  return status === 'completed' || (Number.isFinite(departureTime) && departureTime <= new Date(now).getTime());
};

const isClosed = (doc = {}) => ['cancelled', 'completed', 'expired'].includes(text(doc.status).toLowerCase());

/** The booking's confirmation, reading a cancellation made through any other route as cancelled. */
export const effectiveConfirmation = (doc = {}) => {
  if (!doc.adminBooking) return null;
  if (text(doc.status).toLowerCase() === 'cancelled') return 'cancelled';
  return doc.adminBooking.confirmation || 'awaiting';
};

export const canConfirm = (kind, doc = {}, now = new Date()) =>
  effectiveConfirmation(doc) === 'awaiting' && !isClosed(doc) && !hasStarted(kind, doc, now);

export const canCancel = (kind, doc = {}, now = new Date()) =>
  ['awaiting', 'confirmed'].includes(effectiveConfirmation(doc)) && !isClosed(doc) && !hasStarted(kind, doc, now);

/** The status a screen should show: an unconfirmed booking is "awaiting", whatever its record says. */
export const displayStatus = (doc = {}) => {
  const confirmation = effectiveConfirmation(doc);
  if (confirmation === 'awaiting') return 'awaiting_confirmation';
  return text(doc.status).toLowerCase();
};

/**
 * What the apps are given about an admin-made booking, or null for an ordinary one.
 * `audience` 'admin' also carries who made it and the driver the admin picked.
 */
export const describeAdminBooking = (kind, doc = {}, { audience = 'user', now = new Date() } = {}) => {
  const meta = doc.adminBooking;
  if (!meta) return null;

  const confirmation = effectiveConfirmation(doc);
  const base = {
    source: 'admin',
    bookingType: meta.bookingType,
    bookingTypeLabel: BOOKING_TYPE_LABEL[meta.bookingType] || '',
    confirmation,
    canConfirm: canConfirm(kind, doc, now),
    canCancel: canCancel(kind, doc, now),
    confirmedAt: meta.confirmedAt || null,
    confirmedBy: meta.confirmedBy || '',
    cancelledAt: meta.cancelledAt || null,
    cancelledBy: meta.cancelledBy || '',
    cancelReason: meta.cancelReason || '',
    notes: meta.notes || '',
    createdAt: doc.createdAt || null,
  };

  if (audience !== 'admin') return base;
  return {
    ...base,
    createdByName: meta.createdByName || '',
    customerPhone: meta.customerPhone || '',
    customerName: meta.customerName || '',
    registered: Boolean(doc.userId),
    preAssignedDriverId: meta.preAssignedDriverId ? String(meta.preAssignedDriverId) : '',
    activationNote: meta.activationNote || '',
  };
};

/** Why an action is refused, in words for the person who tried it. */
export const refusalFor = (action, kind, doc = {}, now = new Date()) => {
  const confirmation = effectiveConfirmation(doc);
  if (!doc.adminBooking) return 'This booking was not made by the admin.';
  if (confirmation === 'cancelled') return 'This booking is already cancelled.';
  if (isClosed(doc)) return `This booking is already ${text(doc.status).toLowerCase()}.`;
  if (hasStarted(kind, doc, now)) return 'This booking has already started, so it can no longer be changed.';
  if (action === 'confirm' && confirmation === 'confirmed') return 'This booking is already confirmed.';
  return '';
};

/** The reason given for a cancellation, or an error message if it is not good enough. */
export const checkCancelReason = (value) => {
  const reason = text(value);
  if (reason.length < MIN_CANCEL_REASON_LENGTH) return { ok: false, message: 'Please give a reason for the cancellation.' };
  return { ok: true, reason: reason.slice(0, 300) };
};

/** Booking time for a ride: a real date at least MIN_LEAD_MINUTES ahead. */
export const checkLeadTime = (value, now = new Date()) => {
  const when = value ? new Date(value) : null;
  if (!when || Number.isNaN(when.getTime())) return { ok: false, message: 'Pick the date and time of the booking.' };
  if (when.getTime() < new Date(now).getTime() + MIN_LEAD_MINUTES * 60000) {
    return { ok: false, message: `The booking time must be at least ${MIN_LEAD_MINUTES} minutes from now.` };
  }
  return { ok: true, date: when };
};

/** What the customer is told, by event. */
export const notificationFor = (event, { bookingType, when = null, reason = '' } = {}) => {
  const label = BOOKING_TYPE_LABEL[bookingType] || 'booking';
  const at = when
    ? new Date(when).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : '';
  const forTime = at ? ` for ${at}` : '';

  if (event === 'created') {
    return { title: 'New booking made for you', body: `Gogo has booked a ${label}${forTime}. Please confirm or cancel it in the app.` };
  }
  if (event === 'confirmed') {
    return { title: 'Booking confirmed', body: `Your ${label}${forTime} is confirmed.` };
  }
  if (event === 'cancelled') {
    return { title: 'Booking cancelled', body: `Your ${label}${forTime} was cancelled${reason ? `: ${reason}` : '.'}` };
  }
  return { title: 'Booking update', body: `There is an update on your ${label}.` };
};
