import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bike,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Search,
  Ticket,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { describeApiError } from '../../../../shared/utils/apiError';
import AdminPageHeader from '../../components/ui/AdminPageHeader.jsx';
import { adminInputClass, adminPageContainerClass } from '../../components/ui/adminUi.js';
import CreateAdminBookingModal from './CreateAdminBookingModal.jsx';
import AssignDriverModal from './AssignDriverModal.jsx';

/*
 * Bookings made for customers: the queue the admin works through.
 *
 * Each is saved as "awaiting". The admin asks the customer (by phone or WhatsApp,
 * buttons on every booking) and then confirms it, or cancels it with a reason; the
 * customer can do the same in their app until the booking starts, and whichever
 * happens first settles it. Rides can also be given a driver of their zone.
 */

const STAGES = [
  { key: 'awaiting', label: 'Awaiting confirmation', hint: 'Ask the customer', tone: 'amber' },
  { key: 'confirmed', label: 'Confirmed', hint: 'Agreed', tone: 'emerald' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Not going ahead', tone: 'rose' },
  { key: 'all', label: 'All bookings', hint: 'Everything', tone: 'slate' },
];
const STAGE_TONE = {
  amber: { ring: 'ring-amber-300 bg-amber-50', num: 'text-amber-700', dot: 'bg-amber-400' },
  emerald: { ring: 'ring-emerald-300 bg-emerald-50', num: 'text-emerald-700', dot: 'bg-emerald-500' },
  rose: { ring: 'ring-rose-300 bg-rose-50', num: 'text-rose-700', dot: 'bg-rose-500' },
  slate: { ring: 'ring-slate-300 bg-slate-100', num: 'text-slate-700', dot: 'bg-slate-400' },
};
const TYPES = [
  { value: '', label: 'All types' },
  { value: 'daily_cab', label: 'Daily Cab' },
  { value: 'outstation', label: 'Outstation' },
  { value: 'airport', label: 'Airport Taxi' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'rental', label: 'Rental' },
  { value: 'tour', label: 'Tour' },
];
const TYPE_LOOK = {
  daily_cab: { icon: Car, chip: 'bg-slate-100 text-slate-700', badge: 'bg-slate-800 text-white' },
  outstation: { icon: Route, chip: 'bg-cyan-100 text-cyan-800', badge: 'bg-cyan-600 text-white' },
  airport: { icon: Plane, chip: 'bg-sky-100 text-sky-800', badge: 'bg-sky-600 text-white' },
  parcel: { icon: Package, chip: 'bg-violet-100 text-violet-800', badge: 'bg-violet-600 text-white' },
  rental: { icon: Bike, chip: 'bg-orange-100 text-orange-800', badge: 'bg-orange-500 text-white' },
  tour: { icon: Ticket, chip: 'bg-teal-100 text-teal-800', badge: 'bg-teal-600 text-white' },
};
const CONFIRMATION_STYLE = {
  awaiting: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
};
const CONFIRMATION_LABEL = { awaiting: 'Awaiting confirmation', confirmed: 'Confirmed', cancelled: 'Cancelled' };
const ARROW = ' → ';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const parse = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const formatWhen = (value) => {
  const date = parse(value);
  return date ? date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
};
const formatDay = (value) => {
  const date = parse(value);
  return date ? date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) : '--';
};
const formatTime = (value) => {
  const date = parse(value);
  return date ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
const REFRESH_MS = 20000;

/* Ring or WhatsApp the customer straight from the booking. */
const contactLinks = (booking) => {
  const phone = String(booking.customer?.phone || '').replace(/\D/g, '').slice(-10);
  const name = booking.customer?.name || 'there';
  const message = `Hello ${name}, this is Gogo support. We have booked a ${booking.bookingTypeLabel || 'booking'} for you`
    + `${booking.when ? ` on ${formatWhen(booking.when)}` : ''}. Please reply YES to confirm it or NO to cancel it.`;
  return { call: `tel:+91${phone}`, whatsapp: `https://wa.me/91${phone}?text=${encodeURIComponent(message)}` };
};

const ContactButtons = ({ booking, large = false }) => {
  const links = contactLinks(booking);
  const size = large ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-xs';
  return (
    <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
      <a href={links.call} className={`inline-flex items-center gap-1.5 rounded-lg bg-sky-600 font-bold text-white shadow-sm hover:bg-sky-700 ${size}`}>
        <Phone size={large ? 15 : 13} /> Call
      </a>
      <a href={links.whatsapp} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 font-bold text-white shadow-sm hover:bg-emerald-700 ${size}`}>
        <MessageCircle size={large ? 15 : 13} /> WhatsApp
      </a>
    </div>
  );
};

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
            <p className="text-xs text-gray-500">{booking.code} &middot; {booking.customer.name} &middot; {booking.customer.phone}</p>
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

const BookingDrawer = ({ booking, onClose, onConfirm, onCancel, onAssign, busy }) => (
  <div className="fixed inset-0 z-[55] flex justify-end bg-slate-900/40" onClick={onClose}>
    <aside className="h-full w-full max-w-[520px] overflow-y-auto bg-gray-50 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{booking.bookingTypeLabel}</p>
          <h2 className="text-lg font-black text-gray-900">{booking.code}</h2>
          <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${CONFIRMATION_STYLE[booking.confirmation] || CONFIRMATION_STYLE.awaiting}`}>
            {CONFIRMATION_LABEL[booking.confirmation] || booking.confirmation}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-gray-500 hover:bg-gray-100"><X size={20} /></button>
      </div>

      <div className="space-y-4 p-5">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-3 text-[11px] font-black uppercase tracking-wider text-gray-400">Customer</h3>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-base font-black text-indigo-700">{initials(booking.customer.name)}</div>
            <div>
              <p className="text-base font-black text-gray-900">{booking.customer.name || '--'}</p>
              <p className="text-sm text-gray-600">{booking.customer.phone}</p>
            </div>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${booking.customer.registered ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {booking.customer.registered ? 'Has the app' : 'Not registered yet'}
            </span>
          </div>
          <div className="mt-3"><ContactButtons booking={booking} large /></div>
          <p className="mt-2 text-[11px] text-gray-400">WhatsApp opens a ready message asking them to reply YES to confirm or NO to cancel.</p>
        </section>

        {(booking.sections || []).map((section) => (
          <section key={section.title} className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-gray-400">{section.title}</h3>
            <dl className="divide-y divide-gray-50">
              {section.rows.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-1.5 text-[13px]">
                  <dt className="shrink-0 text-gray-500">{label}</dt>
                  <dd className="text-right font-semibold text-gray-900">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <div className="flex flex-wrap gap-2 pb-6">
          {booking.canConfirm ? (
            <button type="button" onClick={() => onConfirm(booking)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              <CheckCircle2 size={15} /> Confirm
            </button>
          ) : null}
          {booking.kind === 'ride' && booking.canAssignDriver ? (
            <button type="button" onClick={() => onAssign(booking)} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
              <UserCheck size={15} /> {booking.driver || booking.preAssignedDriver ? 'Change driver' : 'Assign driver'}
            </button>
          ) : null}
          {booking.canCancel ? (
            <button type="button" onClick={() => onCancel(booking)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50">
              <XCircle size={15} /> Cancel booking
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  </div>
);

/* One booking, as a card. */
const BookingCard = ({ booking, busy, onOpen, onConfirm, onCancel, onAssign, onBlockedAssign }) => {
  const look = TYPE_LOOK[booking.bookingType] || TYPE_LOOK.daily_cab;
  const Icon = look.icon;
  const route = booking.kind === 'ride' ? String(booking.subtitle || '').split(ARROW) : null;
  const driver = booking.driver || booking.preAssignedDriver;

  return (
    <article
      onClick={onOpen}
      className="cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/70 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${look.badge}`}><Icon size={18} /></span>
          <div>
            <p className="text-sm font-black text-indigo-700">{booking.code}</p>
            <p className="text-[11px] font-semibold text-gray-500">{booking.bookingTypeLabel}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${CONFIRMATION_STYLE[booking.confirmation] || CONFIRMATION_STYLE.awaiting}`}>
            {CONFIRMATION_LABEL[booking.confirmation] || booking.confirmation}
          </span>
        </div>
        <p className="text-[11px] font-medium text-gray-400">
          Made {formatWhen(booking.createdAt)}{booking.createdByName ? ` by ${booking.createdByName}` : ''}
        </p>
      </header>

      <div className="grid gap-5 px-5 py-4 md:grid-cols-12">
        {/* customer */}
        <div className="md:col-span-3">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Customer</p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-black text-indigo-700">{initials(booking.customer.name)}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900">{booking.customer.name || '--'}</p>
              <p className="text-xs text-gray-600">{booking.customer.phone}</p>
            </div>
          </div>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${booking.customer.registered ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {booking.customer.registered ? 'Has the app' : 'Not registered yet'}
          </span>
        </div>

        {/* trip */}
        <div className="md:col-span-5">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">{booking.title}</p>
          {route ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <p className="line-clamp-2 text-[13px] font-medium text-gray-800">{route[0]}</p>
              </div>
              <div className="ml-[4px] h-3 border-l-2 border-dashed border-gray-200" />
              <div className="flex items-start gap-2.5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                <p className="line-clamp-2 text-[13px] font-medium text-gray-800">{route[1] || '--'}</p>
              </div>
            </div>
          ) : (
            <p className="flex items-start gap-2 text-[13px] font-medium text-gray-800"><MapPin size={14} className="mt-0.5 shrink-0 text-gray-400" />{booking.subtitle || '--'}</p>
          )}
          {booking.detail ? <p className="mt-2 text-xs capitalize text-gray-500">{booking.detail}</p> : null}
          {booking.notes ? <p className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs italic text-gray-500">&ldquo;{booking.notes}&rdquo;</p> : null}
        </div>

        {/* when and money */}
        <div className="md:col-span-2">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">When</p>
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900"><CalendarClock size={14} className="text-gray-400" />{formatDay(booking.when)}</p>
          <p className="ml-[22px] text-xs font-semibold text-gray-500">{formatTime(booking.when)}</p>
          <p className="mt-3 text-xl font-black text-gray-900">{money(booking.amount)}</p>
          <p className="text-[11px] font-semibold uppercase text-gray-400">{[booking.payment?.method, booking.payment?.status].filter(Boolean).join(' · ') || '--'}</p>
          {booking.payment?.due > 0 ? <p className="text-[11px] font-bold text-rose-600">Due {money(booking.payment.due)}</p> : null}
        </div>

        {/* driver */}
        <div className="md:col-span-2">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Driver</p>
          {booking.kind !== 'ride' ? (
            <p className="text-xs text-gray-300">Not needed</p>
          ) : driver ? (
            <>
              <p className="text-sm font-bold text-gray-900">{driver.name}</p>
              <p className="text-xs text-gray-500">{driver.phone}</p>
              <p className="text-xs text-gray-500">{driver.vehicleNumber}</p>
              {!booking.driver ? <p className="mt-1 text-[10px] font-bold text-amber-600">Picked, assigned once confirmed</p> : null}
            </>
          ) : (
            <p className="text-xs font-semibold text-gray-400">No driver yet</p>
          )}
        </div>
      </div>

      {booking.activationNote || (booking.confirmation === 'cancelled' && booking.cancelReason) ? (
        <div className={`mx-5 mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${booking.confirmation === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
          {booking.confirmation === 'cancelled'
            ? `Cancelled${booking.cancelledBy ? ` by ${booking.cancelledBy === 'user' ? 'the customer' : 'admin'}` : ''}: ${booking.cancelReason}`
            : booking.activationNote}
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/70 px-5 py-3" onClick={(event) => event.stopPropagation()}>
        <ContactButtons booking={booking} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpen} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50">
            <Eye size={13} /> Full details
          </button>
          {booking.kind === 'ride' && booking.canAssignDriver ? (
            <button
              type="button"
              onClick={() => (booking.driverBlockedReason && booking.confirmation === 'confirmed' ? onBlockedAssign(booking) : onAssign(booking))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
            >
              <UserCheck size={13} /> {driver ? 'Change driver' : 'Assign driver'}
            </button>
          ) : null}
          {booking.canCancel ? (
            <button type="button" onClick={() => onCancel(booking)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600 hover:bg-rose-50">
              <XCircle size={13} /> Cancel
            </button>
          ) : null}
          {booking.canConfirm ? (
            <button type="button" onClick={() => onConfirm(booking)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm
            </button>
          ) : null}
        </div>
      </footer>
    </article>
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
  const [detailKey, setDetailKey] = useState(null);
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
        const response = await adminService.getAdminBookings({ confirmation: tab === 'all' ? '' : tab, type, search, from, to, page, limit: 10 });
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
  const { current_page: current = 1, last_page: last = 1, total = 0, per_page: perPage = 10 } = data.paginator || {};
  const from1 = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to1 = Math.min(total, current * perPage);
  const filtered = Boolean(search || type || from || to);
  const detail = detailKey ? data.results.find((item) => item.key === detailKey) : null;

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
            <button type="button" onClick={() => { setNotice(''); setCreateOpen(true); }} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
              <Plus size={16} /> Create booking
            </button>
          </>
        )}
      />

      <p className="-mt-3 mb-5 max-w-3xl text-sm text-gray-500">
        Bookings you make for customers. Each starts as <b>awaiting</b>: call or WhatsApp the customer, then confirm it or cancel it with a reason. They see it in their app and can confirm or cancel it there too, until it starts.
      </p>

      {/* stage cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const active = tab === stage.key;
          const tone = STAGE_TONE[stage.tone];
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => setTab(stage.key)}
              className={`rounded-2xl border bg-white p-4 text-left transition ${active ? `ring-2 ${tone.ring} border-transparent` : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-500">{stage.label}</span>
              </div>
              <p className={`mt-2 text-3xl font-black ${tone.num}`}>{stage.key === 'all' ? counts.all ?? 0 : counts[stage.key] ?? 0}</p>
              <p className="text-[11px] font-medium text-gray-400">{stage.hint}</p>
            </button>
          );
        })}
      </div>

      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button>
        </div>
      ) : null}
      {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div> : null}

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search phone, name, booking id or address" className={`${adminInputClass} pl-9`} />
        </div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={`${adminInputClass} mt-1 min-w-[160px]`}>
            {TYPES.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Made from
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={`${adminInputClass} mt-1`} />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Made to
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={`${adminInputClass} mt-1`} />
        </label>
        {filtered ? (
          <button type="button" onClick={() => { setSearchInput(''); setType(''); setFrom(''); setTo(''); }} className="h-[42px] rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Clear
          </button>
        ) : null}
      </div>

      {/* bookings */}
      {loading && data.results.length === 0 ? (
        <div className="flex justify-center rounded-2xl border border-gray-200 bg-white py-20"><Loader2 className="animate-spin text-gray-300" size={30} /></div>
      ) : data.results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <ClipboardList size={36} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm font-bold text-gray-500">
            {filtered ? 'No bookings match these filters.' : tab === 'awaiting' ? 'Nothing is waiting for confirmation.' : 'No bookings here yet.'}
          </p>
          {!filtered && tab === 'awaiting' ? <p className="mt-1 text-xs text-gray-400">Use &ldquo;Create booking&rdquo; to book something for a customer.</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          {data.results.map((booking) => (
            <BookingCard
              key={booking.key}
              booking={booking}
              busy={busyKey === booking.key}
              onOpen={() => setDetailKey(booking.key)}
              onConfirm={confirm}
              onCancel={setCancelFor}
              onAssign={setAssignFor}
              onBlockedAssign={(item) => setError(`${item.driverBlockedReason} A driver can be assigned once they register with this number.`)}
            />
          ))}
        </div>
      )}

      {total > 0 ? (
        <div className="mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs font-semibold text-gray-500">Showing {from1} to {to1} of {total} bookings</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 disabled:opacity-40"><ChevronLeft size={13} /> Previous</button>
            <span className="text-xs font-bold text-gray-500">Page {current} of {last}</span>
            <button type="button" disabled={current >= last} onClick={() => setPage(current + 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 disabled:opacity-40">Next <ChevronRight size={13} /></button>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <CreateAdminBookingModal
          onClose={() => setCreateOpen(false)}
          onCreated={(booking) => {
            setTab('awaiting');
            afterChange(`${booking?.code || 'Booking'} is created for ${booking?.customer?.name || 'the customer'}. Call or WhatsApp them, then confirm or cancel it.`);
          }}
        />
      ) : null}
      {detail ? (
        <BookingDrawer
          booking={detail}
          busy={busyKey === detail.key}
          onClose={() => setDetailKey(null)}
          onConfirm={confirm}
          onCancel={(item) => { setDetailKey(null); setCancelFor(item); }}
          onAssign={(item) => { setDetailKey(null); setAssignFor(item); }}
        />
      ) : null}
      {cancelFor ? <CancelModal booking={cancelFor} onClose={() => setCancelFor(null)} onDone={afterChange} /> : null}
      {assignFor ? <AssignDriverModal booking={assignFor} onClose={() => setAssignFor(null)} onChanged={afterChange} /> : null}
    </div>
  );
};

export default AdminBookings;
