/*
 * Rental pricing the server decides, not the client.
 *
 * A booking used to be saved with whatever totalCost, payableNow and
 * paymentStatus the app posted, so a modified client could book a vehicle as
 * "paid" for any amount. The booking endpoint now recomputes both numbers here
 * from the vehicle's own package list and advance-payment setting.
 *
 * The formula mirrors the one the customer app shows (RentalSchedule.jsx):
 * package price, plus every started hour past the package's included hours at
 * the package's extra-hour rate.
 */
import { ApiError } from '../../../utils/ApiError.js';

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const resolveRentalQuote = ({ vehicle, packageId, pickupDateTime, returnDateTime }) => {
  const pricing = Array.isArray(vehicle?.pricing) ? vehicle.pricing : [];
  const wantedId = String(packageId || '').trim();

  if (!wantedId) {
    throw new ApiError(400, 'A rental package must be selected');
  }

  const selected = pricing.find((entry) => String(entry?.id || '').trim() === wantedId);
  if (!selected || selected.active === false) {
    throw new ApiError(400, 'The selected rental package is not available for this vehicle');
  }

  const hours = Math.max(0, (new Date(returnDateTime) - new Date(pickupDateTime)) / 3600000);
  const includedHours = Math.max(1, Number(selected.durationHours || 0));
  const extraHours = Math.ceil(Math.max(0, hours - includedHours));

  return {
    package: {
      packageId: String(selected.id),
      label: selected.label || '',
      durationHours: includedHours,
      price: Math.max(0, Number(selected.price || 0)),
      extraHourPrice: Math.max(0, Number(selected.extraHourPrice || 0)),
    },
    requestedHours: round2(hours),
    totalCost: round2(
      Math.max(0, Number(selected.price || 0)) + extraHours * Math.max(0, Number(selected.extraHourPrice || 0)),
    ),
  };
};

/** What the customer must pay up front: full total, a percentage of it, or a flat amount, never more than the total. */
export const computeRentalAdvance = (advancePayment, totalCost) => {
  if (!advancePayment?.enabled) return 0;

  const amount = Math.max(0, Number(advancePayment.amount || 0));
  const mode = advancePayment.paymentMode;

  if (mode === 'full') return round2(totalCost);
  if (mode === 'fixed') return round2(Math.min(amount, totalCost));
  return round2((totalCost * Math.min(amount, 100)) / 100);
};
