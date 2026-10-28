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

const tourBookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
      index: true,
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

    status: {
      type: String,
      enum: ['pending_payment', 'confirmed', 'cancelled', 'expired'],
      default: 'pending_payment',
      index: true,
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
