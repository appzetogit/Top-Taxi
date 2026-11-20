import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Phone, Plus, RefreshCw, Search, UserCheck, X, XCircle } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { describeApiError } from '../../../../shared/utils/apiError';
import AdminPageHeader from '../../components/ui/AdminPageHeader.jsx';
import { adminInputClass, adminPageContainerClass } from '../../components/ui/adminUi.js';
import CreateAdminBookingModal from './CreateAdminBookingModal.jsx';
import AssignDriverModal from './AssignDriverModal.jsx';

/*
 * Bookings made for customers: the queue the admin works through.
 *
 * Each is saved as "awaiting". The admin asks the customer and then confirms it,
 * or cancels it with a reason; the customer can do the same in their app until
 * the booking starts, and whichever happens first settles it. Rides can also be
 * given a driver of their zone from here.
 */

const TABS = [
  { key: 'awaiting', label: 'Awaiting confirmation' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];
const TYPES = [
  { value: '', label: 'All types' },
  { value: 'daily_cab', label: 'Daily Cab' },
  { value: 'outstation', label: 'Outstation' },
  { value: 'airport', label: 'Airport Taxi' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'rental', label: 'Rental' },
  { value: 'tour', label: 'Tour' },
];
const TYPE_STYLE = {
  daily_cab: 'bg-slate-100 text-slate-600',
  outstation: 'bg-cyan-100 text-cyan-700',
  airport: 'bg-sky-100 text-sky-700',
  parcel: 'bg-violet-100 text-violet-700',
  rental: 'bg-orange-100 text-orange-700',
  tour: 'bg-teal-100 text-teal-700',
};
const CONFIRMATION_STYLE = {
  awaiting: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
const CONFIRMATION_LABEL = { awaiting: 'Awaiting confirmation', confirmed: 'Confirmed', cancelled: 'Cancelled' };

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatWhen = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const REFRESH_MS = 20000;

const CancelModal = ({ booking, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Please give a reason for the cancellation.');
      return;
    }
    setSaving(true);
    try {
      await adminService.cancelAdminBooking(booking.kind, booking.id, reason.trim());
      onDone(`${booking.code} was cancelled and the customer has been told.`);
    } catch (err) {
      setError(describeApiError(err, 'Could not cancel the booking.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Cancel this booking</h2>
            <p className="text-xs text-gray-500">{booking.code} · {booking.customer.name} · {booking.customer.phone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">Reason (the customer will see it)</label>
        <textarea
          autoFocus
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(''); }}
          className={adminInputClass}
          placeholder="e.g. Customer called to say they no longer need it"
        />
        {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
        {booking.kind === 'tour' && booking.payment?.status && booking.payment.status !== 'pending' ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            Money may already have been received for this booking. Refund it to the customer by hand.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Keep booking</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Cancel booking
          </button>
        </div>
      </form>
    </div>
  );
};

const AdminBookings = () => {
  const [tab, setTab] = useState('awaiting');
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], counts: {}, paginator: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [tab, type, search, from, to]);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const requestId = ++requestRef.current;
      if (!quiet) setLoading(true);
      try {
        const response = await adminService.getAdminBookings({ confirmation: tab === 'all' ? '' : tab, type, search, from, to, page, limit: 15 });
        if (requestId !== requestRef.current) return;
        setData(response?.data || { results: [], counts: {}, paginator: {} });
        setError('');
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(describeApiError(err, 'Could not load the bookings.'));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [tab, type, search, from, to, page],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const confirm = async (booking) => {
    if (!window.confirm(`Mark ${booking.code} as confirmed? Do this only after the customer has agreed to it.`)) return;
    setBusyKey(booking.key);
    setError('');
    try {
      await adminService.confirmAdminBooking(booking.kind, booking.id);
      setNotice(`${booking.code} is confirmed and the customer has been told.`);
      await load({ quiet: true });
    } catch (err) {
      setError(describeApiError(err, 'Could not confirm the booking.'));
    } finally {
      setBusyKey('');
    }
  };

  const afterChange = (message) => {
    setCancelFor(null);
    setAssignFor(null);
    setCreateOpen(false);
    setNotice(message);
    load({ quiet: true });
  };

  const counts = data.counts || {};
  const { current_page: current = 1, last_page: last = 1, total = 0, per_page: perPage = 15 } = data.paginator || {};
  const from1 = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to1 = Math.min(total, current * perPage);

  return (
    <div className={adminPageContainerClass}>
      <AdminPageHeader
        module="Operations"
        page="Admin Bookings"
        right={(
          <>
            <button type="button" onClick={() => load()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="Refresh" aria-label="Refresh">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => { setNotice(''); setCreateOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              <Plus size={16} /> Create booking
            </button>
          </>
        )}
      />

      <p className="-mt-3 mb-5 max-w-3xl text-sm text-gray-500">
        Bookings you make for customers. Each starts as <b>awaiting</b>: ask the customer, then confirm it or cancel it with a reason. The customer sees it in their app and can confirm or cancel it there too, until it starts.
      </p>

      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button>
        </div>
      ) : null}
      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</div> : null}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="space-y-3 border-b border-gray-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {TABS.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`flex items-center gap-2 border-b-2 pb-1 text-sm font-bold transition-colors ${active ? 'border-indigo-600 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                >
                  {item.label}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{item.key === 'all' ? counts.all ?? 0 : counts[item.key] ?? 0}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search phone, name, booking id, address" className={`${adminInputClass} pl-9`} />
            </div>
            <select value={type} onChange={(e) => setType(e.target.value)} className={`${adminInputClass} sm:w-44`}>
              {TYPES.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={`${adminInputClass} sm:w-40`} title="Created from" />
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={`${adminInputClass} sm:w-40`} title="Created to" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                {['Booking', 'Customer', 'Details', 'When and amount', 'Driver', 'Status and action'].map((heading) => (
                  <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && data.results.length === 0 ? (
                <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-gray-300" size={28} /></td></tr>
              ) : data.results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-sm font-medium text-gray-400">
                    {search || type || from || to ? 'No bookings match these filters.' : tab === 'awaiting' ? 'Nothing is waiting for confirmation.' : 'No bookings here yet.'}
                  </td>
                </tr>
              ) : (
                data.results.map((booking) => (
                  <tr key={booking.key} className="align-top hover:bg-gray-50/60">
                    <td className="px-4 py-4">
                      <p className="whitespace-nowrap text-[13px] font-bold text-indigo-700">{booking.code}</p>
                      <span className={`mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLE[booking.bookingType] || TYPE_STYLE.daily_cab}`}>{booking.bookingTypeLabel}</span>
                      <p className="mt-1 text-[11px] text-gray-400">Made {formatWhen(booking.createdAt)}{booking.createdByName ? ` by ${booking.createdByName}` : ''}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-gray-900">{booking.customer.name || '--'}</p>
                      <p className="flex items-center gap-1 text-xs text-gray-500"><Phone size={11} />{booking.customer.phone}</p>
                      <span className={`mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${booking.customer.registered ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {booking.customer.registered ? 'App user' : 'Not registered yet'}
                      </span>
                    </td>
                    <td className="min-w-[180px] max-w-[260px] px-4 py-4">
                      <p className="font-semibold text-gray-900">{booking.title}</p>
                      <p className="line-clamp-2 text-xs text-gray-500">{booking.subtitle}</p>
                      {booking.detail ? <p className="text-xs text-gray-400">{booking.detail}</p> : null}
                      {booking.notes ? <p className="mt-1 text-[11px] italic text-gray-400">&ldquo;{booking.notes}&rdquo;</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs font-semibold text-gray-700">{formatWhen(booking.when)}</p>
                      <p className="mt-1 font-black text-gray-900">{money(booking.amount)}</p>
                      <p className="text-[11px] font-semibold uppercase text-gray-400">{[booking.payment?.method, booking.payment?.status].filter(Boolean).join(' · ')}</p>
                      {booking.payment?.due > 0 ? <p className="text-[11px] font-bold text-rose-600">Due {money(booking.payment.due)}</p> : null}
                    </td>
                    <td className="min-w-[130px] px-4 py-4 text-xs">
                      {booking.kind !== 'ride' ? (
                        <span className="text-gray-300">--</span>
                      ) : booking.driver ? (
                        <div>
                          <p className="font-bold text-gray-900">{booking.driver.name}</p>
                          <p className="text-gray-500">{[booking.driver.phone, booking.driver.vehicleNumber].filter(Boolean).join(' · ')}</p>
                        </div>
                      ) : booking.preAssignedDriver ? (
                        <div>
                          <p className="font-bold text-gray-900">{booking.preAssignedDriver.name}</p>
                          <p className="text-[11px] font-semibold text-amber-600">Picked, assigned on confirmation</p>
                        </div>
                      ) : (
                        <span className="font-semibold text-gray-400">No driver yet</span>
                      )}
                      {booking.activationNote ? <p className="mt-1 text-[11px] font-semibold text-amber-600">{booking.activationNote}</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${CONFIRMATION_STYLE[booking.confirmation] || CONFIRMATION_STYLE.awaiting}`}>
                        {CONFIRMATION_LABEL[booking.confirmation] || booking.confirmation}
                      </span>
                      {booking.confirmation === 'confirmed' && booking.confirmedBy ? <p className="mt-1 text-[11px] text-gray-400">by {booking.confirmedBy === 'user' ? 'the customer' : 'admin'}</p> : null}
                      {booking.confirmation === 'cancelled' ? (
                        <p className="mt-1 max-w-[180px] text-[11px] text-gray-500">
                          {booking.cancelledBy ? `by ${booking.cancelledBy === 'user' ? 'the customer' : 'admin'}` : ''}{booking.cancelReason ? `: ${booking.cancelReason}` : ''}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] capitalize text-gray-400">{String(booking.status || '').replace('_', ' ')}</p>
                      <div className="mt-3 flex flex-wrap items-start gap-1.5">
                        {booking.canConfirm ? (
                          <button type="button" onClick={() => confirm(booking)} disabled={busyKey === booking.key} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                            {busyKey === booking.key ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm
                          </button>
                        ) : null}
                        {booking.kind === 'ride' && booking.canAssignDriver ? (
                          <button
                            type="button"
                            onClick={() => (booking.driverBlockedReason && booking.confirmation === 'confirmed' ? setError(`${booking.driverBlockedReason} A driver can be assigned once they register with this number.`) : setAssignFor(booking))}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                          >
                            <UserCheck size={13} /> {booking.driver || booking.preAssignedDriver ? 'Change driver' : 'Assign driver'}
                          </button>
                        ) : null}
                        {booking.canCancel ? (
                          <button type="button" onClick={() => setCancelFor(booking)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50">
                            <XCircle size={13} /> Cancel
                          </button>
                        ) : null}
                        {!booking.canConfirm && !booking.canCancel && !booking.canAssignDriver ? <span className="text-xs text-gray-300">--</span> : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row">
          <p className="text-xs font-medium text-gray-500">Showing {from1} to {to1} of {total} bookings</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 disabled:opacity-40"><ChevronLeft size={13} /> Previous</button>
            <span className="text-xs font-bold text-gray-500">Page {current} / {last}</span>
            <button type="button" disabled={current >= last} onClick={() => setPage(current + 1)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 disabled:opacity-40">Next <ChevronRight size={13} /></button>
          </div>
        </div>
      </div>

      {createOpen ? (
        <CreateAdminBookingModal
          onClose={() => setCreateOpen(false)}
          onCreated={(booking) => {
            setTab('awaiting');
            afterChange(`${booking?.code || 'Booking'} is created for ${booking?.customer?.name || 'the customer'}. Ask them, then confirm or cancel it.`);
          }}
        />
      ) : null}
      {cancelFor ? <CancelModal booking={cancelFor} onClose={() => setCancelFor(null)} onDone={afterChange} /> : null}
      {assignFor ? <AssignDriverModal booking={assignFor} onClose={() => setAssignFor(null)} onChanged={afterChange} /> : null}
    </div>
  );
};

export default AdminBookings;
