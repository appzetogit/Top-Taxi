import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, Clock } from 'lucide-react';
import { buildAvatarFallback } from './activityHelpers';
import tourService from '../../services/tourService';

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const ActivityCard = ({ id, type, title, address, date, time, status, statusTone, price, onClick, driverName, driverImage, vehicleImage, eyebrow, paymentStatus, balanceAmount, onBalancePaid }) => {
  const [vehicleBroken, setVehicleBroken] = useState(false);
  const [driverBroken, setDriverBroken] = useState(false);
  const [payingBalance, setPayingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const resolvedDriverImage = driverBroken ? buildAvatarFallback(driverName) : driverImage;
  const vehicleAlt = type === 'parcel' ? 'Parcel' : type === 'bus' ? 'Bus' : type === 'pooling' ? 'Pooling vehicle' : type === 'tour' ? 'Tour' : 'Vehicle';
  const showPayBalance = type === 'tour' && paymentStatus === 'partial' && Number(balanceAmount) > 0;

  const handlePayBalance = async (event) => {
    event.stopPropagation();
    if (payingBalance) return;
    setBalanceError('');
    setPayingBalance(true);

    try {
      const orderResponse = await tourService.createBalancePaymentOrder(id);
      const order = orderResponse?.data || orderResponse || {};
      if (!order.keyId || !order.orderId) {
        throw new Error('Unable to start payment');
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Razorpay SDK failed to load');
      }

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: title || 'Tour Balance Payment',
        description: 'Tour booking - balance payment',
        order_id: order.orderId,
        modal: {
          ondismiss: () => setPayingBalance(false),
        },
        theme: { color: '#0F172A' },
        handler: async (response) => {
          try {
            await tourService.verifyBalancePayment(id, response);
            onBalancePaid?.();
          } catch (verifyError) {
            setBalanceError(verifyError?.message || 'Payment completed but could not be verified');
          } finally {
            setPayingBalance(false);
          }
        },
      });

      rzp.on('payment.failed', (paymentFailedEvent) => {
        setBalanceError(paymentFailedEvent?.error?.description || 'Payment failed');
        setPayingBalance(false);
      });

      rzp.open();
    } catch (err) {
      setBalanceError(err?.message || 'Unable to start balance payment');
      setPayingBalance(false);
    }
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick?.();
      }}
      className="w-full cursor-pointer rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-colors hover:border-slate-300 active:translate-y-0 sm:p-4"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:h-[72px] sm:w-[72px]">
          {!vehicleBroken && vehicleImage && (
            <img
              src={vehicleImage}
              alt={vehicleAlt}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setVehicleBroken(true)}
            />
          )}
          <div className="absolute bottom-1.5 right-1.5 h-7 w-7 overflow-hidden rounded-full border-2 border-white bg-white">
            <img
              src={resolvedDriverImage}
              alt={driverName}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setDriverBroken(true)}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="line-clamp-2 break-words text-[14px] font-semibold leading-tight text-slate-900 sm:text-[15px]">{title}</h4>
              <p className="mt-1 line-clamp-2 break-words text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">
                {eyebrow || driverName}
              </p>
              <p className="mt-2 line-clamp-2 text-[12px] text-slate-600">{address}</p>
            </div>
            <span className="shrink-0 whitespace-nowrap pl-1 text-[13px] font-semibold text-slate-900 sm:text-[14px]">Rs {price}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] leading-none text-slate-400">
              <Calendar size={11} strokeWidth={2.4} />
              <span>{date}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] leading-none text-slate-400">
              <Clock size={11} strokeWidth={2.4} />
              <span>{time}</span>
            </div>
            <span
              className={`rounded-full border px-2 py-1 text-[9px] font-semibold leading-none sm:ml-auto ${
                statusTone === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : statusTone === 'danger'
                    ? 'bg-rose-50 text-rose-700 border-rose-100'
                    : 'bg-amber-50 text-amber-700 border-amber-100'
              }`}
            >
              {status.toUpperCase()}
            </span>
          </div>

          {showPayBalance ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={handlePayBalance}
                disabled={payingBalance}
                className="w-full rounded-xl bg-amber-500 py-2 text-[12px] font-bold text-white transition hover:bg-amber-600 disabled:opacity-60"
              >
                {payingBalance ? 'Processing...' : `Pay remaining balance ₹${balanceAmount}`}
              </button>
              {balanceError ? <p className="mt-1.5 text-[11px] font-semibold text-rose-600">{balanceError}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300">
          <ChevronRight size={16} strokeWidth={2.4} />
        </div>
      </div>
    </motion.div>
  );
};

export default ActivityCard;
