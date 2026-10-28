import api from '../../../shared/api/axiosInstance';

// Paths carry the /users prefix because the taxi user router is mounted at
// /users inside the taxi module (see Backend taxi/user/routes/index.js) --
// same as busService's /users/bus-bookings paths.
export const tourService = {
  listPackages: () => api.get('/users/tour-packages'),
  getPackage: (id) => api.get(`/users/tour-packages/${id}`),

  createBookingOrder: (payload) => api.post('/users/tour-bookings/order', payload),
  verifyBookingPayment: (payload) => api.post('/users/tour-bookings/verify', payload),

  createBalancePaymentOrder: (bookingId) => api.post(`/users/tour-bookings/${bookingId}/balance/order`, {}),
  verifyBalancePayment: (bookingId, payload) => api.post(`/users/tour-bookings/${bookingId}/balance/verify`, payload),

  listMyBookings: () => api.get('/users/tour-bookings'),
  getMyBooking: (id) => api.get(`/users/tour-bookings/${id}`),
};

export default tourService;
