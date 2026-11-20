/*
 * Admin-made rental bookings.
 *
 * Priced exactly as the customer's own rental booking is (common/rentalPricing.js:
 * the vehicle's package and advance setting, never a figure typed in), so an admin
 * cannot book a vehicle for the wrong price any more than the app can. The advance,
 * if the vehicle asks for one, is either collected by the admin by hand (cash or
 * UPI, recorded here) or left pending for the customer to pay at pickup.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RentalBookingRequest } from '../models/RentalBookingRequest.js';
import { RentalVehicleType } from '../models/RentalVehicleType.js';
import { ServiceStore } from '../models/ServiceStore.js';
import { computeRentalAdvance, resolveRentalQuote } from '../../common/rentalPricing.js';
import { checkLeadTime } from '../../common/adminBookings.js';

const text = (value) => String(value ?? '').trim();
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const MANUAL_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'];

const newReference = () => `RNT-${Date.now().toString(36).slice(-6).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

export const createAdminRentalBooking = async ({ customer, rental = {}, notes }, admin, linkedUserId = null) => {
  if (!isId(rental.vehicleTypeId)) throw new ApiError(400, 'Choose a rental vehicle.');

  const pickup = checkLeadTime(rental.pickupDateTime);
  if (!pickup.ok) throw new ApiError(400, pickup.message);
  const returnAt = rental.returnDateTime ? new Date(rental.returnDateTime) : null;
  if (!returnAt || Number.isNaN(returnAt.getTime()) || returnAt <= pickup.date) {
    throw new ApiError(400, 'The return time must be after the pickup time.');
  }

  const vehicle = await RentalVehicleType.findById(rental.vehicleTypeId).lean();
  if (!vehicle || vehicle.active === false || vehicle.status !== 'active') throw new ApiError(404, 'Rental vehicle not found.');

  const quote = resolveRentalQuote({
    vehicle,
    packageId: rental.packageId,
    pickupDateTime: pickup.date,
    returnDateTime: returnAt,
  });
  const payableNow = computeRentalAdvance(vehicle.advancePayment, quote.totalCost);

  // The advance: collected by hand now, or still to come.
  const received = Boolean(rental.advance?.received) && payableNow > 0;
  const mode = MANUAL_MODES.includes(text(rental.advance?.mode)) ? text(rental.advance.mode) : 'cash';
  const paymentStatus = payableNow <= 0 ? 'not_required' : received ? 'paid' : 'pending';

  const location = rental.serviceLocation || {};
  const locationId = text(location.id || location.locationId);
  const storeIds = (Array.isArray(vehicle.serviceStoreIds) ? vehicle.serviceStoreIds : []).filter(isId);
  const centers = storeIds.length
    ? await ServiceStore.find({ _id: { $in: storeIds }, ...(isId(locationId) ? { service_location_id: locationId } : {}) }).select('_id').lean()
    : [];

  const created = await RentalBookingRequest.create({
    userId: linkedUserId,
    bookingSource: 'admin',
    adminBooking: {
      createdBy: admin?.id && isId(admin.id) ? admin.id : null,
      createdByName: text(admin?.name),
      bookingType: 'rental',
      customerPhone: customer.phone,
      customerName: customer.name,
      notes: text(notes),
    },
    bookingReference: newReference(),
    vehicleTypeId: vehicle._id,
    vehicleName: vehicle.name || '',
    vehicleCategory: vehicle.vehicleCategory || '',
    vehicleImage: vehicle.image || '',
    serviceCenterIds: centers.map((center) => center._id),
    selectedPackage: quote.package,
    serviceLocation: {
      locationId,
      name: text(location.name),
      address: text(location.address),
      city: text(location.city),
      latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
      longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null,
      distanceKm: null,
    },
    pickupDateTime: pickup.date,
    returnDateTime: returnAt,
    requestedHours: quote.requestedHours,
    totalCost: quote.totalCost,
    payableNow,
    advancePaymentLabel: text(vehicle.advancePayment?.label) || 'Advance booking payment',
    paymentStatus,
    paymentMethod: received ? mode : '',
    paymentMethodLabel: received ? mode.replace('_', ' ') : '',
    payment: received
      ? { provider: 'manual', status: 'paid', amount: payableNow, currency: 'INR', paymentId: text(rental.advance?.reference), orderId: '', signature: '' }
      : { provider: 'manual', status: payableNow > 0 ? 'pending' : 'not_required', amount: 0, currency: 'INR', orderId: '', paymentId: '', signature: '' },
    contactName: customer.name,
    contactPhone: customer.phone,
    contactEmail: '',
    kycCompleted: false,
    status: 'pending',
  });

  return created;
};

export const confirmAdminRental = async (id, { actor }) => {
  const confirmed = await RentalBookingRequest.findOneAndUpdate(
    { _id: id, bookingSource: 'admin', 'adminBooking.confirmation': 'awaiting', status: 'pending' },
    {
      $set: {
        status: 'confirmed',
        reviewedAt: new Date(),
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

export const cancelAdminRental = async (id, { actor, reason }) => {
  const cancelled = await RentalBookingRequest.findOneAndUpdate(
    { _id: id, bookingSource: 'admin', status: { $in: ['pending', 'confirmed'] } },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
        'adminBooking.confirmation': 'cancelled',
        'adminBooking.cancelledAt': new Date(),
        'adminBooking.cancelledBy': actor,
        'adminBooking.cancelReason': reason,
      },
    },
    { new: true },
  );
  if (!cancelled) throw new ApiError(409, 'This booking changed just now. Refresh and try again.');
  return cancelled;
};
