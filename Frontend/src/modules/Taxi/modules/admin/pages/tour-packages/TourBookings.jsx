import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { adminService } from '../../services/adminService';
import AdminPageHeader from '../../components/ui/AdminPageHeader.jsx';
import { adminCardClass, adminInputClass, adminLabelClass, adminPageContainerClass } from '../../components/ui/adminUi.js';
import { describeApiError } from '../../../../shared/utils/apiError';

const STATUS_OPTIONS = ['', 'pending', 'partial', 'paid', 'failed', 'expired'];

const PAYMENT_STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  partial: 'bg-sky-50 text-sky-700',
  paid: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  expired: 'bg-gray-100 text-gray-500',
};

const BOOKING_STATUS_BADGE = {
  confirmed: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-emerald-50 text-emerald-700',
  pending_payment: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-rose-50 text-rose-700',
  expired: 'bg-gray-100 text-gray-500',
};

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

const modeLabel = (mode) =>
  mode === 'online' ? 'Online (Razorpay)' : PAYMENT_MODES.find((m) => m.value === mode)?.label || mode;

const unwrap = (response) => response?.data ?? response;

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const buttonPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60';
const buttonGhost =
  'inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60';
const buttonSmall =
  'rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Field = ({ label, error, children }) => (
  <div>
    <label className={adminLabelClass}>{label}</label>
    {children}
    {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
  </div>
);

const PaymentFields = ({ value, onChange, amountLabel, max }) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <Field label={amountLabel}>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          className={adminInputClass}
          placeholder="0"
        />
        {max > 0 ? (
          <button type="button" onClick={() => onChange({ ...value, amount: String(max) })} className="mt-1 text-xs font-semibold text-indigo-600 hover:underline">
            Use full amount ({money(max)})
          </button>
        ) : null}
      </Field>
      <Field label="Payment mode">
        <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value })} className={adminInputClass}>
          {PAYMENT_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
      </Field>
    </div>
    <Field label="Reference (receipt no. / UPI ref / cheque no.)">
      <input
        type="text"
        value={value.reference}
        onChange={(e) => onChange({ ...value, reference: e.target.value })}
        className={adminInputClass}
        maxLength={120}
        placeholder="Optional"
      />
    </Field>
  </>
);

const EMPTY_PAYMENT = { amount: '', mode: 'cash', reference: '' };

const CreateBookingModal = ({ packages, onClose, onCreated }) => {
  const [packageId, setPackageId] = useState('');
  const [departureId, setDepartureId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [personCount, setPersonCount] = useState(1);
  const [payment, setPayment] = useState(EMPTY_PAYMENT);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedPackage = useMemo(() => packages.find((p) => p.id === packageId) || null, [packages, packageId]);
  const departures = useMemo(
    () => (selectedPackage?.upcomingDates || []).filter((d) => d.active !== false && d.seatsLeft > 0),
    [selectedPackage],
  );
  const selectedDeparture = departures.find((d) => d.id === departureId) || null;

  const seatsLeft = selectedDeparture?.seatsLeft || 0;
  const total = (selectedPackage?.pricePerPerson || 0) * (Number(personCount) || 0);
  const received = Number(payment.amount) || 0;

  const pickPackage = (id) => {
    setPackageId(id);
    setDepartureId('');
    setPersonCount(1);
  };

  const validate = () => {
    const next = {};
    if (!selectedPackage) next.package = 'Select a package';
    if (selectedPackage && !selectedDeparture) next.departure = 'Select a departure date';
    if (customerName.trim().length < 2) next.name = 'Customer name is required';
    if (!/^\d{10}$/.test(customerPhone)) next.phone = 'Enter a valid 10-digit mobile number';
    const persons = Number(personCount);
    if (!Number.isInteger(persons) || persons < 1) next.persons = 'At least 1 person';
    else if (selectedDeparture && persons > seatsLeft) next.persons = `Only ${seatsLeft} seat(s) left`;
    if (received < 0) next.amount = 'Amount cannot be negative';
    else if (selectedPackage && received > total) next.amount = `Cannot be more than the total ${money(total)}`;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await adminService.createTourBooking({
        packageId,
        departureId,
        customerName: customerName.trim(),
        customerPhone,
        personCount: Number(personCount),
        initialPayment: received > 0 ? { amount: received, mode: payment.mode, reference: payment.reference.trim() } : undefined,
      });
      onCreated(unwrap(response));
    } catch (error) {
      setSubmitError(describeApiError(error, 'Could not create the booking.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create booking" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Package" error={errors.package}>
          <select value={packageId} onChange={(e) => pickPackage(e.target.value)} className={adminInputClass}>
            <option value="">Select a package</option>
            {packages.filter((p) => p.active !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.destination} — {money(p.pricePerPerson)}/person</option>
            ))}
          </select>
        </Field>

        <Field label="Departure date" error={errors.departure}>
          <select
            value={departureId}
            onChange={(e) => { setDepartureId(e.target.value); setPersonCount(1); }}
            className={adminInputClass}
            disabled={!selectedPackage}
          >
            <option value="">{selectedPackage ? (departures.length ? 'Select a date' : 'No departure with seats left') : 'Select a package first'}</option>
            {departures.map((d) => (
              <option key={d.id} value={d.id}>
                {formatDate(d.startDate)} – {formatDate(d.endDate)} · {d.seatsLeft} seat(s) left
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" error={errors.name}>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={adminInputClass} placeholder="Full name" />
          </Field>
          <Field label="Mobile number" error={errors.phone}>
            <input
              type="tel"
              inputMode="numeric"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className={adminInputClass}
              placeholder="10-digit number"
            />
          </Field>
        </div>

        <Field label={`Number of persons${selectedDeparture ? ` (max ${seatsLeft})` : ''}`} error={errors.persons}>
          <input
            type="number"
            min="1"
            max={seatsLeft || undefined}
            value={personCount}
            onChange={(e) => setPersonCount(e.target.value)}
            className={adminInputClass}
            disabled={!selectedDeparture}
          />
        </Field>

        <div className="rounded-xl bg-gray-50 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              {selectedPackage ? `${money(selectedPackage.pricePerPerson)} × ${Number(personCount) || 0} person(s)` : 'Total'}
            </span>
            <span className="text-base font-bold text-gray-900">{money(total)}</span>
          </div>
          {selectedPackage?.upfrontPayment ? (
            <p className="mt-1 text-xs text-gray-400">
              Package asks for {selectedPackage.upfrontPayment.paymentMode === 'full' ? 'full payment' : `${selectedPackage.upfrontPayment.percentage}% upfront`} when booked online. Here you can record any amount you actually received.
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Payment received now (optional)</p>
          <div className="space-y-3">
            <PaymentFields value={payment} onChange={setPayment} amountLabel="Amount received (₹)" max={total} />
            {errors.amount ? <p className="text-xs font-medium text-rose-600">{errors.amount}</p> : null}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Balance after this: <span className="font-semibold text-rose-600">{money(Math.max(0, total - received))}</span> — you can add further payments later from the bookings list.
          </p>
        </div>

        {submitError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{submitError}</div> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={buttonGhost} disabled={saving}>Cancel</button>
          <button type="submit" className={buttonPrimary} disabled={saving}>{saving ? 'Creating…' : 'Create booking'}</button>
        </div>
      </form>
    </Modal>
  );
};

const AddPaymentModal = ({ booking, onClose, onSaved }) => {
  const [payment, setPayment] = useState({ ...EMPTY_PAYMENT, amount: String(booking.balanceAmount || '') });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const amount = Number(payment.amount) || 0;
  const balanceAfter = Math.max(0, booking.balanceAmount - amount);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!(amount > 0)) return setError('Enter the amount received');
    if (amount > booking.balanceAmount) return setError(`Amount is more than the balance due (${money(booking.balanceAmount)})`);
    setSaving(true);
    try {
      const response = await adminService.addTourBookingPayment(booking.id, {
        amount,
        mode: payment.mode,
        reference: payment.reference.trim(),
        note: note.trim(),
      });
      onSaved(unwrap(response));
    } catch (err) {
      setError(describeApiError(err, 'Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Add payment · ${booking.bookingCode}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3 text-center">
          <div><p className="text-[10px] font-bold uppercase text-gray-400">Total</p><p className="text-sm font-bold text-gray-900">{money(booking.totalAmount)}</p></div>
          <div><p className="text-[10px] font-bold uppercase text-gray-400">Paid</p><p className="text-sm font-bold text-emerald-600">{money(booking.amountPaid)}</p></div>
          <div><p className="text-[10px] font-bold uppercase text-gray-400">Balance</p><p className="text-sm font-bold text-rose-600">{money(booking.balanceAmount)}</p></div>
        </div>
        <p className="text-sm text-gray-600">{booking.customerName} · {booking.customerPhone}</p>

        <PaymentFields value={payment} onChange={setPayment} amountLabel="Amount received (₹)" max={booking.balanceAmount} />
        <Field label="Note">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={adminInputClass} maxLength={300} placeholder="Optional" />
        </Field>

        <p className="text-xs text-gray-500">
          {amount > 0 && balanceAfter === 0
            ? 'This clears the balance. You can then mark the booking done.'
            : <>Balance after this payment: <span className="font-semibold text-rose-600">{money(balanceAfter)}</span></>}
        </p>

        {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonGhost} disabled={saving}>Cancel</button>
          <button type="submit" className={buttonPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</button>
        </div>
      </form>
    </Modal>
  );
};

const PaymentHistory = ({ payments }) => {
  if (!payments?.length) {
    return <p className="text-xs text-gray-500">No payment has been received on this booking yet.</p>;
  }
  return (
    <table className="w-full max-w-3xl text-xs">
      <thead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">
          <th className="py-1 pr-4">Received</th>
          <th className="py-1 pr-4">Amount</th>
          <th className="py-1 pr-4">Mode</th>
          <th className="py-1 pr-4">Reference</th>
          <th className="py-1 pr-4">Note</th>
          <th className="py-1">Recorded by</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id} className="border-t border-gray-100 text-gray-700">
            <td className="py-1.5 pr-4">{formatDateTime(p.receivedAt)}</td>
            <td className="py-1.5 pr-4 font-semibold text-emerald-600">{money(p.amount)}</td>
            <td className="py-1.5 pr-4">{modeLabel(p.mode)}</td>
            <td className="py-1.5 pr-4">{p.reference || '—'}</td>
            <td className="py-1.5 pr-4">{p.note || '—'}</td>
            <td className="py-1.5">{p.source === 'online' ? 'Customer (app)' : p.recordedBy || 'Admin'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const TourBookings = () => {
  const [packages, setPackages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState({ totalBookings: 0, totalCollected: 0, totalOutstanding: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [packageFilter, setPackageFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState(null);
  const [expandedId, setExpandedId] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadPackages = useCallback(() => {
    adminService
      .getTourPackages()
      .then((response) => {
        const data = unwrap(response) || {};
        setPackages(data.results || response?.results || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages, refreshKey]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErrorMessage('');

    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (packageFilter) params.packageId = packageFilter;

    adminService
      .getTourBookings(params)
      .then((response) => {
        if (!mounted) return;
        const data = unwrap(response) || {};
        setBookings(Array.isArray(data.bookings) ? data.bookings : []);
        setSummary(data.summary || { totalBookings: 0, totalCollected: 0, totalOutstanding: 0 });
      })
      .catch((error) => {
        if (!mounted) return;
        setErrorMessage(describeApiError(error, 'Could not load tour bookings.'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [statusFilter, packageFilter, refreshKey]);

  const refresh = () => setRefreshKey((key) => key + 1);

  const packageOptions = useMemo(() => packages.map((pkg) => ({ id: pkg.id, label: pkg.destination })), [packages]);

  const handleCreated = (booking) => {
    setCreateOpen(false);
    setNotice(`Booking ${booking?.bookingCode || ''} created for ${booking?.customerName || 'the customer'}.`);
    refresh();
  };

  const handlePaymentSaved = (booking) => {
    setPaymentFor(null);
    setNotice(
      booking?.canComplete
        ? `Payment recorded. ${booking.bookingCode} is fully paid — you can mark it done.`
        : `Payment recorded on ${booking?.bookingCode || 'the booking'}. Balance left: ${money(booking?.balanceAmount)}.`,
    );
    refresh();
  };

  const handleComplete = async (booking) => {
    if (!window.confirm(`Mark ${booking.bookingCode} (${booking.customerName}) as done? Payment is fully received.`)) return;
    setBusyId(booking.id);
    setErrorMessage('');
    try {
      await adminService.completeTourBooking(booking.id);
      setNotice(`${booking.bookingCode} marked as done.`);
      refresh();
    } catch (error) {
      setErrorMessage(describeApiError(error, 'Could not mark the booking done.'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className={adminPageContainerClass}>
      <AdminPageHeader
        module="Price Management"
        page="Tour Bookings"
        right={(
          <button type="button" onClick={() => { setNotice(''); setCreateOpen(true); }} className={buttonPrimary}>
            <Plus size={16} /> Create booking
          </button>
        )}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Bookings</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.totalBookings || 0}</p>
        </div>
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{money(summary.totalCollected)}</p>
        </div>
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Outstanding</p>
          <p className="mt-1 text-2xl font-bold text-rose-600">{money(summary.totalOutstanding)}</p>
        </div>
      </div>

      <div className={`${adminCardClass} mb-6`}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={adminLabelClass}>Package</label>
            <select value={packageFilter} onChange={(e) => setPackageFilter(e.target.value)} className={adminInputClass}>
              <option value="">All packages</option>
              {packageOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={adminLabelClass}>Payment Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={adminInputClass}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option || 'all'} value={option}>{option ? option.charAt(0).toUpperCase() + option.slice(1) : 'All statuses'}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button>
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{errorMessage}</div>
      ) : null}

      {loading ? (
        <div className={adminCardClass}>Loading tour bookings...</div>
      ) : bookings.length === 0 ? (
        <div className={adminCardClass}>No tour bookings found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Persons</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const expanded = expandedId === booking.id;
                return (
                  <Fragment key={booking.id}>
                    <tr className="border-b border-gray-100 align-top last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{booking.customerName}</p>
                        <p className="text-xs text-gray-500">{booking.customerPhone}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {booking.bookingCode} · {booking.bookingSource === 'admin' ? 'Admin booking' : 'App booking'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{booking.packageSnapshot?.destination || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(booking.departureSnapshot?.startDate)} – {formatDate(booking.departureSnapshot?.endDate)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{booking.personCount}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{money(booking.totalAmount)}</td>
                      <td className="px-4 py-3 text-emerald-600">{money(booking.amountPaid)}</td>
                      <td className="px-4 py-3 text-rose-600">{money(booking.balanceAmount)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${PAYMENT_STATUS_BADGE[booking.paymentStatus] || 'bg-gray-100 text-gray-500'}`}>
                          {booking.paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${BOOKING_STATUS_BADGE[booking.status] || 'bg-gray-100 text-gray-500'}`}>
                          {String(booking.status || '').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(booking.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {booking.canAddPayment ? (
                            <button type="button" onClick={() => { setNotice(''); setPaymentFor(booking); }} className={`${buttonSmall} border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}>
                              Add payment
                            </button>
                          ) : null}
                          {booking.canComplete ? (
                            <button type="button" onClick={() => handleComplete(booking)} disabled={busyId === booking.id} className={`${buttonSmall} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
                              {busyId === booking.id ? 'Saving…' : 'Mark done'}
                            </button>
                          ) : null}
                          <button type="button" onClick={() => setExpandedId(expanded ? '' : booking.id)} className={`${buttonSmall} inline-flex items-center gap-1 border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}>
                            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Payments ({booking.payments?.length || 0})
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-gray-100 bg-gray-50/60 last:border-b-0">
                        <td colSpan={11} className="px-4 py-3">
                          <PaymentHistory payments={booking.payments} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createOpen ? (
        <CreateBookingModal packages={packages} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      ) : null}
      {paymentFor ? (
        <AddPaymentModal booking={paymentFor} onClose={() => setPaymentFor(null)} onSaved={handlePaymentSaved} />
      ) : null}
    </div>
  );
};

export default TourBookings;
