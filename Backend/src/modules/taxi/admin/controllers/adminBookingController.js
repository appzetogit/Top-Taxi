import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  cancelAdminBooking,
  confirmAdminBooking,
  createAdminBooking,
  listAdminBookings,
} from '../services/adminBookings.js';
import {
  assignDriverToRide,
  listEligibleDrivers,
  quoteAdminRide,
  unassignDriverFromRide,
} from '../services/adminBookingRides.js';
import { getPlaceDetails, searchPlaces } from '../services/adminBookingPlaces.js';

const ok = (res, data) => res.json({ success: true, data });
const adminOf = (req) => req.auth?.admin || null;

export const getAdminBookings = asyncHandler(async (req, res) => ok(res, await listAdminBookings(req.query)));

export const postAdminBooking = asyncHandler(async (req, res) => {
  const booking = await createAdminBooking(req.body || {}, adminOf(req));
  res.status(201).json({ success: true, data: booking, message: 'Booking created. Confirm it once the customer agrees.' });
});

export const postAdminBookingQuote = asyncHandler(async (req, res) => ok(res, await quoteAdminRide(req.body || {})));

export const postConfirmAdminBooking = asyncHandler(async (req, res) =>
  ok(res, await confirmAdminBooking({ kind: req.params.kind, id: req.params.id, actor: 'admin' })),
);

export const postCancelAdminBooking = asyncHandler(async (req, res) =>
  ok(res, await cancelAdminBooking({ kind: req.params.kind, id: req.params.id, actor: 'admin', reason: req.body?.reason })),
);

export const getAdminBookingPlaces = asyncHandler(async (req, res) => ok(res, await searchPlaces(req.query.q)));

export const getAdminBookingPlace = asyncHandler(async (req, res) => ok(res, await getPlaceDetails(req.params.placeId)));

export const getAdminBookingDrivers = asyncHandler(async (req, res) =>
  ok(res, await listEligibleDrivers(req.params.id, { search: req.query.search })),
);

export const postAssignAdminBookingDriver = asyncHandler(async (req, res) =>
  ok(res, await assignDriverToRide(req.params.id, req.body?.driverId)),
);

export const postUnassignAdminBookingDriver = asyncHandler(async (req, res) =>
  ok(res, await unassignDriverFromRide(req.params.id)),
);
