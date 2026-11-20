import mongoose from 'mongoose';

/*
 * What an admin-made booking carries on top of an ordinary one.
 *
 * Shared by the three collections a booking can live in (rides, rental requests,
 * tour bookings) so they all answer the same questions: who made it, for whom,
 * has the customer confirmed it, and who cancelled it and why. It is a
 * sub-document that only exists on admin-made bookings, so a booking a customer
 * made carries nothing extra and every existing query still matches it.
 */
export const ADMIN_BOOKING_TYPES = ['daily_cab', 'outstation', 'airport', 'parcel', 'rental', 'tour'];

export const adminBookingSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdByName: { type: String, default: '', trim: true },
    bookingType: { type: String, enum: ADMIN_BOOKING_TYPES, required: true },

    // Who the booking is for. The phone is how it finds the customer's app
    // account, now or whenever they register.
    customerPhone: { type: String, required: true, trim: true, index: true },
    customerName: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true, maxlength: 500 },

    // awaiting: made, not yet agreed by the customer. confirmed / cancelled: settled.
    confirmation: { type: String, enum: ['awaiting', 'confirmed', 'cancelled'], default: 'awaiting' },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: String, enum: ['', 'admin', 'user'], default: '' },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ['', 'admin', 'user'], default: '' },
    cancelReason: { type: String, default: '', trim: true },

    // Rides only: the driver the admin picked while the booking was still
    // awaiting. Nobody is assigned (and no driver hears of it) until it is
    // confirmed; on confirmation this driver is assigned for real.
    preAssignedDriverId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Rides only: why the booking could not be handed to a driver on confirmation.
    activationNote: { type: String, default: '', trim: true },
  },
  { _id: false },
);
