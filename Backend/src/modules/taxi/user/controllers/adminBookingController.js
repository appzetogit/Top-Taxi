import { ApiError } from '../../../../utils/ApiError.js';
import { User } from '../models/User.js';
import {
  cancelAdminBooking,
  confirmAdminBooking,
  describeForCustomer,
  linkAdminBookingsToUser,
} from '../../admin/services/adminBookings.js';

/*
 * A customer answering a booking an admin made for them: confirm it, or cancel it.
 * Allowed only on their own booking, and only until it starts.
 */
const loadCustomer = async (req) => {
  const user = await User.findById(req.auth?.sub).select('_id phone');
  if (!user) throw new ApiError(404, 'User not found');
  // A booking made for this number before they registered is theirs from now on.
  await linkAdminBookingsToUser(user);
  return user;
};

export const confirmMyAdminBooking = async (req, res) => {
  const user = await loadCustomer(req);
  await confirmAdminBooking({ kind: req.params.kind, id: req.params.id, actor: 'user', userId: user._id });
  res.json({
    success: true,
    data: await describeForCustomer(req.params.kind, req.params.id),
    message: 'Booking confirmed',
  });
};

export const cancelMyAdminBooking = async (req, res) => {
  const user = await loadCustomer(req);
  await cancelAdminBooking({
    kind: req.params.kind,
    id: req.params.id,
    actor: 'user',
    reason: req.body?.reason,
    userId: user._id,
  });
  res.json({
    success: true,
    data: await describeForCustomer(req.params.kind, req.params.id),
    message: 'Booking cancelled',
  });
};
