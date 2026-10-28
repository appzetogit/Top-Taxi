// One definition of "how much has been paid on a tour booking", shared by the
// admin and user sides. A booking can be paid through up to three channels: the
// online upfront leg, the online balance leg, and any number of payments an
// admin recorded by hand (cash/UPI/bank transfer collected outside the app).

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const TOUR_MANUAL_PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'];

export const getTourAmountPaid = (booking = {}) => {
  const upfront = booking.payment?.status === 'paid' ? Number(booking.payment.amount) || 0 : 0;
  const balance = booking.balancePayment?.status === 'paid' ? Number(booking.balancePayment.amount) || 0 : 0;
  const manual = (booking.manualPayments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return round2(upfront + balance + manual);
};

export const getTourBalanceDue = (booking = {}) =>
  Math.max(0, round2((Number(booking.totalAmount) || 0) - getTourAmountPaid(booking)));

// The payment-status fields that follow from a given paid total. `previousBalanceStatus`
// only decides whether a fully-cleared balance reads 'paid' (there was a balance and it
// got settled) or 'not_required' (it was settled in one go).
export const deriveTourPaymentState = ({ totalAmount, amountPaid, previousBalanceStatus = 'not_required' }) => {
  const balanceAmount = Math.max(0, round2((Number(totalAmount) || 0) - (Number(amountPaid) || 0)));
  if (balanceAmount <= 0) {
    return {
      paymentStatus: 'paid',
      balanceAmount: 0,
      balancePaymentStatus: ['pending', 'paid'].includes(previousBalanceStatus) ? 'paid' : 'not_required',
    };
  }
  return {
    paymentStatus: amountPaid > 0 ? 'partial' : 'pending',
    balanceAmount,
    balancePaymentStatus: 'pending',
  };
};
