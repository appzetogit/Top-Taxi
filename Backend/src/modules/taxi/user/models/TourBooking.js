import mongoose from 'mongoose';

// First (upfront) and second (balance) payment legs share this shape.
const tourPaymentSnapshotSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'razorpay' },
    orderId: { type: String, default: '', trim: true, index: true },
    paymentId: { type: String, default: '', trim: true },
    signature: { type: String, default: '', trim: true },
    amount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'expired'],
      default: 'created',
    },
    paidAt: { type: Date, default: null },
  },
  { _id: false },
);

// A payment an admin collected outside the app and recorded by hand.
const tourManualPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    mode: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'],
      default: 'cash',
    },
    reference: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true },
    receivedAt: { type: Date, default: Date.now },
    recordedByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
    recordedByName: { type: String, default: '', trim: true },
  },
  { _id: true },
);

const tourBookingSchema = new mongoose.Schema(
  {
    // Optional for admin-created bookings: the customer may not have an app
    // account. When the phone matches one, the booking is linked to it so it
    // also shows in that user's own bookings list.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required() {
        return this.bookingSource !== 'admin';
      },
      default: null,
      index: true,
    },
    bookingSource: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiTourPackage',
      required: true,
      index: true,
    },
    departureId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    bookingCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },

    // Snapshots: a later admin edit to the package/departure must never
    // retroactively change an existing booking's terms.
    packageSnapshot: {
      destination: { type: String, default: '' },
      coverImage: { type: String, default: '' },
      durationLabel: { type: String, default: '' },
    },
    departureSnapshot: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },
    personCount: {
      type: Number,
      required: true,
      min: 1,
    },

    pricePerPerson: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    upfrontPaymentSnapshot: {
      paymentMode: { type: String, enum: ['full', 'percentage'], default: 'percentage' },
      percentage: { type: Number, default: 20 },
    },
    upfrontRequiredAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentStatus: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },
    payment: {
      type: tourPaymentSnapshotSchema,
      default: () => ({}),
    },

    balanceAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    balancePaymentStatus: {
      type: String,
      enum: ['not_required', 'pending', 'paid', 'failed'],
      default: 'not_required',
    },
    balancePayment: {
      type: tourPaymentSnapshotSchema,
      default: () => ({}),
    },

    manualPayments: {
      type: [tourManualPaymentSchema],
      default: [],
    },

    status: {
      type: String,
      enum: ['pending_payment', 'confirmed', 'completed', 'cancelled', 'expired'],
      default: 'pending_payment',
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

tourBookingSchema.index({ userId: 1, createdAt: -1 });
tourBookingSchema.index({ packageId: 1, departureId: 1 });

export const TourBooking =
  mongoose.models.TaxiTourBooking || mongoose.model('TaxiTourBooking', tourBookingSchema);
