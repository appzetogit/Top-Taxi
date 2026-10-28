import api from '../../../shared/api/axiosInstance';

export const tourService = {
  listPackages: () => api.get('/tour-packages'),
  getPackage: (id) => api.get(`/tour-packages/${id}`),

  createBookingOrder: (payload) => api.post('/tour-bookings/order', payload),
  verifyBookingPayment: (payload) => api.post('/tour-bookings/verify', payload),

  createBalancePaymentOrder: (bookingId) => api.post(`/tour-bookings/${bookingId}/balance/order`, {}),
  verifyBalancePayment: (bookingId, payload) => api.post(`/tour-bookings/${bookingId}/balance/verify`, payload),

  listMyBookings: () => api.get('/tour-bookings'),
  getMyBooking: (id) => api.get(`/tour-bookings/${id}`),
};

export default tourService;
