import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Home, Ticket } from 'lucide-react';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const TourConfirm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = getRoutePrefix(location.pathname);
  const { booking } = location.state || {};

  if (!booking?.bookingCode) {
    navigate(`${routePrefix}/tours`, { replace: true });
    return null;
  }

  const isPartial = booking.paymentStatus === 'partial';

  return (
    <div className="flex min-h-screen max-w-lg mx-auto flex-col items-center justify-center bg-slate-50 px-6 py-10 font-sans">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 size={44} className="text-emerald-500" />
      </motion.div>

      <h1 className="mt-6 text-xl font-black text-slate-900">Booking Confirmed</h1>
      <p className="mt-1 text-sm font-semibold text-slate-500">Booking code: {booking.bookingCode}</p>

      <div className="mt-6 w-full rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Ticket size={16} className="text-slate-400" />
          {booking.packageSnapshot?.destination || 'Tour'}
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-500">
          {formatDate(booking.departureSnapshot?.startDate)} - {formatDate(booking.departureSnapshot?.endDate)}
        </p>

        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between font-semibold text-slate-600">
            <span>Total Amount</span>
            <span>₹{booking.totalAmount}</span>
          </div>
          <div className="flex justify-between font-black text-slate-900">
            <span>Amount Paid</span>
            <span>₹{booking.amountPaid}</span>
          </div>
        </div>

        {isPartial ? (
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
            ₹{booking.balanceAmount} balance due — you can pay this anytime from your Bookings/Activity page.
          </div>
        ) : null}
      </div>

      <div className="mt-8 flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate(`${routePrefix}/activity`)}
          className="rounded-[14px] bg-slate-900 py-3.5 text-sm font-black text-white"
        >
          View in Activity
        </button>
        <button
          type="button"
          onClick={() => navigate(`${routePrefix}/tours`)}
          className="flex items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white py-3.5 text-sm font-black text-slate-700"
        >
          <Home size={16} /> Back to Tours
        </button>
      </div>
    </div>
  );
};

export default TourConfirm;
