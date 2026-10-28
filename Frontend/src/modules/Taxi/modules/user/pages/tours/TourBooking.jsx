import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, Minus, Phone, Plus, User } from 'lucide-react';
import tourService from '../../services/tourService';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

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

const TourBooking = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = getRoutePrefix(location.pathname);
  const { packageId, departureId } = location.state || {};

  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [personCount, setPersonCount] = useState(1);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    if (!packageId || !departureId) {
      navigate(`${routePrefix}/tours`, { replace: true });
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await tourService.getPackage(packageId);
        const data = response?.data || response || null;
        if (active) setPkg(data);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load tour package');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [packageId, departureId, navigate, routePrefix]);

  const departure = useMemo(
    () => (pkg?.upcomingDates || []).find((d) => d.id === departureId) || null,
    [pkg, departureId],
  );

  const seatsLeft = departure?.seatsLeft ?? 0;
  const pricePerPerson = Number(pkg?.pricePerPerson || 0);
  const totalAmount = pricePerPerson * personCount;
  const upfrontPayment = pkg?.upfrontPayment || { paymentMode: 'full', percentage: 100 };
  const payNowAmount =
    upfrontPayment.paymentMode === 'percentage'
      ? Math.round((totalAmount * Number(upfrontPayment.percentage || 0)) / 100)
      : totalAmount;
  const balanceAmount = totalAmount - payNowAmount;

  const adjustPersonCount = (delta) => {
    setPersonCount((current) => {
      const next = current + delta;
      if (next < 1) return 1;
      if (seatsLeft && next > seatsLeft) return seatsLeft;
      return next;
    });
  };

  const validate = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Full name is required';
    if (!phone.trim()) errors.phone = 'Mobile number is required';
    else if (!/^\d{10}$/.test(phone.trim())) errors.phone = 'Enter valid 10-digit number';
    if (!personCount || personCount < 1) errors.personCount = 'At least 1 person is required';
    else if (seatsLeft && personCount > seatsLeft) errors.personCount = `Only ${seatsLeft} seats left`;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleBookNow = async () => {
    setSubmitError('');
    if (!validate()) return;
    if (isPaying) return;

    setIsPaying(true);
    try {
      const orderResponse = await tourService.createBookingOrder({
        packageId,
        departureId,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        personCount,
      });
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
        name: pkg?.destination || 'Tour Booking',
        description: `Tour booking - ${pkg?.destination || ''}`,
        order_id: order.orderId,
        prefill: {
          name: name.trim(),
          contact: phone.trim(),
        },
        modal: {
          ondismiss: () => {
            setIsPaying(false);
          },
        },
        theme: { color: '#0F172A' },
        handler: async (response) => {
          try {
            const verifyResponse = await tourService.verifyBookingPayment(response);
            const booking = verifyResponse?.data || verifyResponse || {};
            navigate(`${routePrefix}/tours/confirm`, {
              replace: true,
              state: { booking },
            });
          } catch (verifyError) {
            setSubmitError(verifyError?.message || 'Payment completed but the booking could not be confirmed');
            setIsPaying(false);
          }
        },
      });

      rzp.on('payment.failed', (event) => {
        const message = event?.error?.description || event?.error?.reason || 'Payment failed';
        setSubmitError(message);
        setIsPaying(false);
      });

      rzp.open();
    } catch (err) {
      setSubmitError(err?.message || 'Unable to continue with booking');
      setIsPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen max-w-lg mx-auto items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !pkg || !departure) {
    return (
      <div className="min-h-screen max-w-lg mx-auto bg-slate-50 p-6">
        <button onClick={() => navigate(-1)} className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <ArrowLeft size={18} />
        </button>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          {error || 'This departure is no longer available'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-slate-50 font-sans pb-28">
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-white/92 px-4 pb-3 pt-10 shadow-sm backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <ArrowLeft size={18} className="text-slate-900" />
        </button>
        <h1 className="truncate text-base font-black text-slate-900">Book {pkg.destination}</h1>
      </div>

      <div className="space-y-4 px-4 pt-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Traveller Details</p>

          <div className="mt-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Name</label>
            <div className={`flex items-center gap-3 rounded-2xl border bg-slate-50 px-4 py-3 ${fieldErrors.name ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}>
              <User size={16} className="shrink-0 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="Full name"
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
              />
            </div>
            {fieldErrors.name ? <p className="text-[11px] font-bold text-rose-600">{fieldErrors.name}</p> : null}
          </div>

          <div className="mt-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mobile Number</label>
            <div className={`flex items-center gap-3 rounded-2xl border bg-slate-50 px-4 py-3 ${fieldErrors.phone ? 'border-rose-500 bg-rose-50/20' : 'border-slate-100'}`}>
              <Phone size={16} className="shrink-0 text-slate-400" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: '' }));
                }}
                placeholder="10-digit mobile number"
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
              />
            </div>
            {fieldErrors.phone ? <p className="text-[11px] font-bold text-rose-600">{fieldErrors.phone}</p> : null}
          </div>

          <div className="mt-3 space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Number of Persons</label>
            <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <button type="button" onClick={() => adjustPersonCount(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
                <Minus size={14} />
              </button>
              <span className="text-base font-black text-slate-900">{personCount}</span>
              <button type="button" onClick={() => adjustPersonCount(1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
                <Plus size={14} />
              </button>
            </div>
            {fieldErrors.personCount ? <p className="text-[11px] font-bold text-rose-600">{fieldErrors.personCount}</p> : null}
            <p className="text-[11px] font-semibold text-slate-400">{seatsLeft} seats available for this departure</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Fare Summary</p>
          <div className="mt-3 flex justify-between text-sm font-semibold text-slate-600">
            <span>₹{pricePerPerson} x {personCount}</span>
            <span>₹{totalAmount}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-black text-slate-900">
            <span>Total Amount</span>
            <span>₹{totalAmount}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          {upfrontPayment.paymentMode === 'full' ? (
            <p className="text-sm font-bold text-emerald-700">Pay full amount: ₹{totalAmount} now</p>
          ) : (
            <>
              <p className="text-sm font-bold text-emerald-700">
                Pay ₹{payNowAmount} now ({upfrontPayment.percentage}%)
              </p>
              <p className="mt-1 text-xs font-semibold text-emerald-600">₹{balanceAmount} balance due later</p>
            </>
          )}
        </div>

        {submitError ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{submitError}</div>
        ) : null}
      </div>

      <div className="fixed bottom-0 left-1/2 w-full max-w-lg -translate-x-1/2 border-t border-slate-100 bg-white px-4 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={handleBookNow}
          disabled={isPaying || seatsLeft === 0}
          className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-slate-900 py-4 text-[15px] font-black text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] disabled:opacity-60"
        >
          {isPaying ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : `Book Now · Pay ₹${payNowAmount}`}
        </motion.button>
      </div>
    </div>
  );
};

export default TourBooking;
