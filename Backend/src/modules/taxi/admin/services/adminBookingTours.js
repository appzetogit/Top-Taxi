/*
 * Admin-made tour bookings. The booking itself is made by adminService
 * (createAdminTourBooking: seats taken at once, any money received recorded by
 * hand); this adds the customer's agreement on top: confirm, or cancel and give
 * the seats back.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { TourBooking } from '../../user/models/TourBooking.js';
import { TourPackage } from '../models/TourPackage.js';

export const confirmAdminTour = async (id, { actor }) => {
  const confirmed = await TourBooking.findOneAndUpdate(
    { _id: id, bookingSource: 'admin', 'adminBooking.confirmation': 'awaiting', status: 'confirmed' },
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
  return confirmed;
};

export const cancelAdminTour = async (id, { actor, reason }) => {
  const cancelled = await TourBooking.findOneAndUpdate(
    { _id: id, bookingSource: 'admin', status: 'confirmed' },
    {
      $set: {
        status: 'cancelled',
        'adminBooking.confirmation': 'cancelled',
        'adminBooking.cancelledAt': new Date(),
        'adminBooking.cancelledBy': actor,
        'adminBooking.cancelReason': reason,
      },
    },
    { new: false },
  );
  if (!cancelled) throw new ApiError(409, 'This booking changed just now. Refresh and try again.');

  // The seats go back to the departure. The raw handle is used on purpose: Mongoose's own
  // updateOne reports a change even when an arrayFilters match changed nothing.
  await TourPackage.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(cancelled.packageId)) },
    { $inc: { 'upcomingDates.$[elem].seatsBooked': -Math.max(0, Number(cancelled.personCount) || 0) } },
    { arrayFilters: [{ 'elem._id': new mongoose.Types.ObjectId(String(cancelled.departureId)) }] },
  );

  return TourBooking.findById(id);
};
