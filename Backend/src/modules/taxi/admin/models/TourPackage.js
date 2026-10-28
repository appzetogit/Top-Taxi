import mongoose from 'mongoose';

const tourItineraryDaySchema = new mongoose.Schema(
  {
    day: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false },
);

const tourDepartureSchema = new mongoose.Schema(
  {
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    totalSeats: {
      type: Number,
      required: true,
      min: 1,
    },
    // Derived seats-left = totalSeats - seatsBooked, computed at read time
    // (see serializeTourPackage) rather than stored, so it can never drift.
    seatsBooked: {
      type: Number,
      default: 0,
      min: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true },
);

// No `fixed` mode here (unlike RentalVehicleType.advancePayment's full|percentage|fixed):
// a flat-rupee deposit does not scale against pricePerPerson * personCount, and the
// product ask was explicitly "percentage of total, or full" -- nothing else.
const tourUpfrontPaymentSchema = new mongoose.Schema(
  {
    paymentMode: {
      type: String,
      enum: ['full', 'percentage'],
      default: 'percentage',
    },
    percentage: {
      type: Number,
      default: 20,
      min: 1,
      max: 100,
    },
  },
  { _id: false },
);

const tourPackageSchema = new mongoose.Schema(
  {
    destination: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      default: '',
      trim: true,
    },
    coverImage: {
      type: String,
      default: '',
      trim: true,
    },
    galleryImages: {
      type: [String],
      default: [],
    },
    pricePerPerson: {
      type: Number,
      required: true,
      min: 0,
    },
    durationLabel: {
      type: String,
      default: '',
      trim: true,
    },
    ageRangeLabel: {
      type: String,
      default: '',
      trim: true,
    },
    happyTravellersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    overview: {
      type: String,
      default: '',
      trim: true,
    },
    highlights: {
      type: [String],
      default: [],
    },
    itinerary: {
      type: [tourItineraryDaySchema],
      default: [],
    },
    inclusions: {
      type: [String],
      default: [],
    },
    exclusions: {
      type: [String],
      default: [],
    },
    upcomingDates: {
      type: [tourDepartureSchema],
      default: [],
    },
    upfrontPayment: {
      type: tourUpfrontPaymentSchema,
      default: () => ({ paymentMode: 'percentage', percentage: 20 }),
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

tourPackageSchema.index({ destination: 1 });
tourPackageSchema.index({ status: 1, active: 1 });

export const TourPackage =
  mongoose.models.TaxiTourPackage || mongoose.model('TaxiTourPackage', tourPackageSchema);
