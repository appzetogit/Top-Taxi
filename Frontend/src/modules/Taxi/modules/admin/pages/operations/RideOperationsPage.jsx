import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Filter,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { adminService } from '../../services/adminService';

/*
 * One list page for Trips, Deliveries and Ongoing: tabs with counts, working
 * filters, search, real paging, and a details drawer with the whole ride.
 * Each page passes only what differs (title, tabs, which API, extra columns).
 */

const STATUS_STYLES = {
  COMPLETED: 'bg-teal-500 text-white',
  CANCELLED: 'bg-rose-500 text-white',
  UPCOMING: 'bg-amber-400 text-white',
  ACCEPTED: 'bg-emerald-500 text-white',
  ONGOING: 'bg-blue-500 text-white',
};

const PAYMENT_STYLES = {
  CASH: 'bg-orange-100 text-orange-700',
  ONLINE: 'bg-indigo-100 text-indigo-700',
};

const PAYMENT_STATE_STYLES = {
  PAID: 'text-emerald-600',
  COLLECTED: 'text-emerald-600',
  PENDING: 'text-amber-600',
  CREATED: 'text-amber-600',
  FAILED: 'text-rose-600',
};

const TYPE_STYLES = {
  daily_cab: 'bg-slate-100 text-slate-600',
  outstation: 'bg-cyan-100 text-cyan-700',
  airport: 'bg-sky-100 text-sky-700',
  parcel: 'bg-violet-100 text-violet-700',
};

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const mapsLink = (place) =>
  Number.isFinite(place?.lat) && Number.isFinite(place?.lng)
    ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
    : null;

const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

/* ------------------------------------------------------------------ pieces */

const StatusBadge = ({ row }) => (
  <div>
    <span className={`inline-block rounded px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS_STYLES[row.tripStatus] || 'bg-slate-200 text-slate-700'}`}>
      {row.tripStatus || 'UNKNOWN'}
    </span>
    {row.statusLabel && row.statusLabel.toUpperCase() !== row.tripStatus && (
      <p className="mt-1 text-[11px] font-semibold text-slate-400">{row.statusLabel}</p>
    )}
  </div>
);

const PaymentBadge = ({ method, status }) => (
  <div>
    <span className={`inline-block rounded px-2.5 py-1 text-[10px] font-bold uppercase ${PAYMENT_STYLES[method] || 'bg-slate-100 text-slate-600'}`}>
      {method || '--'}
    </span>
    {status && (
      <p className={`mt-1 text-[11px] font-bold uppercase ${PAYMENT_STATE_STYLES[status] || 'text-slate-400'}`}>{status}</p>
    )}
  </div>
);

const Person = ({ person, fallback, sub }) =>
  person?.name ? (
    <div className="min-w-[130px]">
      <p className="font-bold text-slate-800">{person.name}</p>
      {person.phone && <p className="text-[12px] text-slate-500">{person.phone}</p>}
      {sub && <p className="text-[11px] font-semibold text-slate-400">{sub}</p>}
    </div>
  ) : (
    <span className="text-slate-400">{fallback}</span>
  );

const Avatar = ({ name, image }) =>
  image ? (
    <img src={image} alt="" className="h-12 w-12 rounded-full object-cover" />
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-base font-black text-slate-600">
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );

const Field = ({ label, children }) =>
  children || children === 0 ? (
    <div className="flex items-start justify-between gap-4 py-1.5 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-bold text-slate-800">{children}</span>
    </div>
  ) : null;

const Card = ({ title, children, tone = 'text-slate-400' }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h3 className={`mb-2 text-[11px] font-black uppercase tracking-wider ${tone}`}>{title}</h3>
    {children}
  </section>
);

const SummaryCard = ({ label, value, tone = 'text-slate-900', hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
    <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
    {hint && <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{hint}</p>}
  </div>
);

const TypeBadge = ({ row }) => (
  <div>
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLES[row.bookingType] || TYPE_STYLES.daily_cab}`}>
      {row.bookingTypeLabel || row.serviceLabel}
    </span>
    {(row.tags || []).length > 0 && (
      <div className="mt-1 flex flex-wrap gap-1">
        {row.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{tag}</span>
        ))}
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------ drawer */

const RideDetailsDrawer = ({ rideId, onClose }) => {
  const [ride, setRide] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    adminService
      .getRideRequestDetails(rideId)
      .then((response) => {
        if (active) setRide(response?.data || null);
      })
      .catch((err) => {
        if (active) setError(errorText(err, 'Could not load this booking'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rideId]);

  React.useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cancelled = ride?.tripStatus === 'CANCELLED';

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        className="h-full w-full max-w-[560px] overflow-y-auto bg-slate-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{ride?.bookingTypeLabel || 'Booking'} details</p>
            <h2 className="text-lg font-black text-slate-900">{ride?.requestId || '...'}</h2>
          </div>
          <div className="flex items-center gap-3">
            {ride && <StatusBadge row={ride} />}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
              <X size={20} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-24">
            <Loader2 className="animate-spin text-slate-300" size={32} />
          </div>
        )}
        {error && <p className="p-6 text-sm font-semibold text-rose-600">{error}</p>}

        {ride && (
          <div className="space-y-4 p-5">
            <Card title="Trip">
              {ride.tags?.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {ride.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">{tag}</span>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Pickup</p>
                    <p className="text-[13px] font-semibold text-slate-800">{ride.pickup?.address || '--'}</p>
                    {mapsLink(ride.pickup) && (
                      <a href={mapsLink(ride.pickup)} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-indigo-600">
                        Open in Maps
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Drop</p>
                    <p className="text-[13px] font-semibold text-slate-800">{ride.drop?.address || '--'}</p>
                    {mapsLink(ride.drop) && (
                      <a href={mapsLink(ride.drop)} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-indigo-600">
                        Open in Maps
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <Field label="Vehicle type">{ride.transportType}</Field>
                <Field label="Est. distance">{ride.distanceKm ? `${ride.distanceKm} km` : ''}</Field>
                <Field label="Est. duration">{ride.durationMinutes ? `${ride.durationMinutes} min` : ''}</Field>
                <Field label="Booked on">{formatDateTime(ride.date)}</Field>
                <Field label="Scheduled for">{ride.scheduledAt ? formatDateTime(ride.scheduledAt) : ''}</Field>
                <Field label="Booking mode">{ride.extras?.bookingMode}</Field>
                <Field label="Pool ride">{ride.extras?.isPoolRide ? `Yes, ${ride.extras.poolSeats} seat(s)` : ''}</Field>
              </div>
            </Card>

            <Card title="Rider">
              {ride.user ? (
                <div>
                  <div className="flex items-center gap-3">
                    <Avatar name={ride.user.name} image={ride.user.profileImage} />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-black text-slate-900">{ride.user.name || 'Unknown'}</p>
                      {ride.user.phone && (
                        <a href={`tel:${ride.user.phone}`} className="flex items-center gap-1 text-[12px] font-semibold text-indigo-600">
                          <Phone size={12} /> {ride.user.phone}
                        </a>
                      )}
                      {ride.user.email && (
                        <p className="flex items-center gap-1 truncate text-[12px] text-slate-500"><Mail size={12} /> {ride.user.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <Field label="Gender">{ride.user.gender}</Field>
                    <Field label="Member since">{ride.user.joinedAt ? formatDateTime(ride.user.joinedAt) : ''}</Field>
                    <Field label="Wallet balance">{money(ride.user.walletBalance)}</Field>
                    <Field label="Total bookings">{ride.user.totalRides}</Field>
                    <Field label="Completed / cancelled">{`${ride.user.completedRides} / ${ride.user.cancelledRides}`}</Field>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Rider account not found.</p>
              )}
            </Card>

            <Card title="Driver">
              {ride.driver ? (
                <div>
                  <div className="flex items-center gap-3">
                    <Avatar name={ride.driver.name} image={ride.driver.profileImage} />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-black text-slate-900">{ride.driver.name || 'Unknown'}</p>
                      {ride.driver.phone && (
                        <a href={`tel:${ride.driver.phone}`} className="flex items-center gap-1 text-[12px] font-semibold text-indigo-600">
                          <Phone size={12} /> {ride.driver.phone}
                        </a>
                      )}
                      {ride.driver.email && (
                        <p className="flex items-center gap-1 truncate text-[12px] text-slate-500"><Mail size={12} /> {ride.driver.email}</p>
                      )}
                    </div>
                    {ride.driver.rating > 0 && (
                      <span className="ml-auto flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-black text-amber-600">
                        <Star size={12} fill="currentColor" /> {Number(ride.driver.rating).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <Field label="Vehicle">{[ride.driver.vehicleMake, ride.driver.vehicleModel].filter(Boolean).join(' ')}</Field>
                    <Field label="Vehicle number">{ride.driver.vehicleNumber}</Field>
                    <Field label="Vehicle type / colour">{[ride.driver.vehicleType, ride.driver.vehicleColor].filter(Boolean).join(' · ')}</Field>
                    <Field label="City">{ride.driver.city}</Field>
                    <Field label="Status">{ride.driver.isOnline ? 'Online' : 'Offline'}</Field>
                    <Field label="Wallet balance">{money(ride.driver.walletBalance)}</Field>
                    <Field label="Completed / cancelled trips">{`${ride.driver.completedTrips} / ${ride.driver.cancelledTrips}`}</Field>
                    <Field label="Partner since">{ride.driver.joinedAt ? formatDateTime(ride.driver.joinedAt) : ''}</Field>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No driver has been assigned.</p>
              )}
            </Card>

            {ride.parcelDetails && (
              <Card title="Parcel">
                <Field label="Category">{ride.parcelDetails.category}</Field>
                <Field label="Weight">{ride.parcelDetails.weight}</Field>
                <Field label="Description">{ride.parcelDetails.description}</Field>
                <Field label="Sender">{[ride.parcelDetails.senderName, ride.parcelDetails.senderMobile].filter(Boolean).join(' · ')}</Field>
                <Field label="Receiver">{[ride.parcelDetails.receiverName, ride.parcelDetails.receiverMobile].filter(Boolean).join(' · ')}</Field>
                {[...ride.parcelDetails.photos, ...ride.parcelDetails.deliveryPhotos].length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[...ride.parcelDetails.photos, ...ride.parcelDetails.deliveryPhotos].map((src) => (
                      <a key={src} href={src} target="_blank" rel="noreferrer">
                        <img src={src} alt="Parcel" className="h-16 w-16 rounded-lg object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {ride.intercityDetails && (
              <Card title="Intercity">
                <Field label="Route">{[ride.intercityDetails.from, ride.intercityDetails.to].filter(Boolean).join(' → ')}</Field>
                <Field label="Trip type">{ride.intercityDetails.tripType}</Field>
                <Field label="Travel date">{ride.intercityDetails.travelDate ? formatDateTime(ride.intercityDetails.travelDate) : ''}</Field>
                <Field label="Passengers">{ride.intercityDetails.passengers || ''}</Field>
              </Card>
            )}

            <Card title="Fare">
              {ride.fareBreakdown.lines.length === 0 && <Field label="Fare">{money(ride.fare)}</Field>}
              {ride.fareBreakdown.lines.map((line) => (
                <Field key={line.key} label={line.label}>
                  <span className={line.amount < 0 ? 'text-emerald-600' : ''}>{line.amount < 0 ? `- ${money(-line.amount)}` : money(line.amount)}</span>
                </Field>
              ))}
              {ride.fareBreakdown.surgePercent > 0 && (
                <Field label="Surge">{`${ride.fareBreakdown.surgePercent}%${ride.fareBreakdown.surgeName ? ` (${ride.fareBreakdown.surgeName})` : ''}`}</Field>
              )}
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[15px] font-black text-slate-900">
                <span>Total</span>
                <span>{money(ride.fareBreakdown.total)}</span>
              </div>
            </Card>

            <Card title="Payment">
              <Field label="Method">{ride.payment.method}</Field>
              <Field label="Status">{ride.payment.status}</Field>
              <Field label="Gateway">{ride.payment.provider}</Field>
              <Field label="Payment id">{ride.payment.providerPaymentId}</Field>
              <Field label="Collected">{ride.payment.amount ? money(ride.payment.amount) : ''}</Field>
              <Field label="Paid at">{ride.payment.paidAt ? formatDateTime(ride.payment.paidAt) : ''}</Field>
              <Field label="Subscription used">{ride.payment.subscriptionUsed ? 'Yes' : ''}</Field>
            </Card>

            {(ride.earnings.commission > 0 || ride.earnings.driverEarnings > 0) && (
              <Card title="Earnings split">
                <Field label="Platform commission">{money(ride.earnings.commission)}</Field>
                <Field label="Driver earnings">{money(ride.earnings.driverEarnings)}</Field>
                <Field label="Driver incentive">{ride.earnings.incentive ? money(ride.earnings.incentive) : ''}</Field>
                <Field label="Credited at">{ride.earnings.creditedAt ? formatDateTime(ride.earnings.creditedAt) : ''}</Field>
              </Card>
            )}

            {ride.feedback && (
              <Card title="Rider feedback">
                <Field label="Rating">{ride.feedback.rating != null ? `${ride.feedback.rating} / 5` : ''}</Field>
                <Field label="Comment">{ride.feedback.comment}</Field>
                <Field label="Tip">{ride.feedback.tipAmount ? money(ride.feedback.tipAmount) : ''}</Field>
              </Card>
            )}

            {cancelled && (
              <Card title="Cancellation" tone="text-rose-500">
                <Field label="Cancelled by"><span className="capitalize">{ride.cancelled_by || 'unknown'}</span></Field>
                <Field label="Reason">{ride.cancellation_reason || 'Not given'}</Field>
                <Field label="Time">{formatDateTime(ride.cancellation_time)}</Field>
                <Field label="Cancellation fee">{money(ride.cancellation_charge)}</Field>
                <Field label="Fee status">{ride.cancellation_charge > 0 ? ride.cancellation_status : ''}</Field>
                <Field label="Recovered in ride">{ride.recovered_in_ride ? `REQ_${String(ride.recovered_in_ride).slice(-12).toUpperCase()}` : ''}</Field>
              </Card>
            )}

            <Card title="Timeline">
              <ol className="space-y-3">
                {ride.timeline.map((entry) => (
                  <li key={entry.key} className="flex items-start gap-3">
                    <Clock size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="flex flex-1 items-center justify-between gap-3 text-[13px]">
                      <span className="font-semibold text-slate-700">{entry.label}</span>
                      <span className="text-slate-500">{formatDateTime(entry.at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        )}
      </aside>
    </div>
  );
};

/* -------------------------------------------------------------- pagination */

const pageWindow = (current, last) => {
  const pages = new Set([1, last, current - 1, current, current + 1]);
  return [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
};

const Pagination = ({ paginator, onPage }) => {
  const { current_page: current = 1, last_page: last = 1, total = 0, per_page: perPage = 10 } = paginator || {};
  const from = total === 0 ? 0 : (current - 1) * perPage + 1;
  const to = Math.min(total, current * perPage);
  const pages = pageWindow(current, last);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 sm:flex-row">
      <p className="text-[13px] font-medium text-slate-500">
        Showing {from} to {to} of {total} entries
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
          className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-bold text-slate-600 disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Previous
        </button>
        {pages.map((page, index) => (
          <React.Fragment key={page}>
            {index > 0 && page - pages[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <button
              type="button"
              onClick={() => onPage(page)}
              className={`h-9 min-w-[36px] rounded-lg px-3 text-[13px] font-bold ${
                page === current ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {page}
            </button>
          </React.Fragment>
        ))}
        <button
          type="button"
          disabled={current >= last}
          onClick={() => onPage(current + 1)}
          className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-bold text-slate-600 disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- page */

const EMPTY_FILTERS = { from: '', to: '', payment: '', type: '' };
const REFRESH_MS = 15000;

const RideOperationsPage = ({
  title,
  breadcrumb,
  tabs,
  loadRows,
  searchPlaceholder = 'Search id, rider, driver, address',
  emptyText = 'No bookings found.',
  autoRefresh = false,
  // { key, label, options: [{ value, label }] }: which server filter the type dropdown drives.
  typeFilter = null,
  summary = 'revenue',
  extraColumns = [],
  onDelete,
  deleteQuestion,
}) => {
  const [tab, setTab] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [filters, setFilters] = React.useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = React.useState(false);
  const [data, setData] = React.useState({ results: [], paginator: {}, counts: {} });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  const [deletingId, setDeletingId] = React.useState(null);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any change to what is being asked for starts again from page 1.
  React.useEffect(() => {
    setPage(1);
  }, [tab, search, limit, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const load = React.useCallback(
    async ({ quiet = false } = {}) => {
      const requestId = ++requestRef.current;
      if (!quiet) setLoading(true);
      try {
        const { type, ...rest } = filters;
        const response = await loadRows({ page, limit, tab, search, ...rest, ...(typeFilter && type ? { [typeFilter.key]: type } : {}) });
        if (requestId !== requestRef.current) return;
        const payload = response?.data || {};
        setData({ results: payload.results || [], paginator: payload.paginator || {}, counts: payload.counts || {} });
        setError('');
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setData((current) => ({ ...current, results: [] }));
        setError(errorText(err, 'Could not load the list'));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [loadRows, page, limit, tab, search, filters, typeFilter],
  );

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const handleDelete = async (row) => {
    if (!window.confirm(deleteQuestion ? deleteQuestion(row) : `Delete ${row.requestId}?`)) return;
    setDeletingId(row.id);
    try {
      await onDelete(row);
      await load({ quiet: true });
    } catch (err) {
      window.alert(errorText(err, 'Could not delete this booking'));
    } finally {
      setDeletingId(null);
    }
  };

  const headings = ['Request Id', 'Booked', 'User', 'Driver', ...extraColumns.map((c) => c.header), 'Pickup → Drop', 'Fare', 'Payment', 'Status', 'Action'];
  const colSpan = headings.length;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 font-sans">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between rounded-t-xl bg-white px-4 py-2">
          <h1 className="text-[20px] font-black uppercase tracking-tight text-slate-800">{title}</h1>
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
            <span>{breadcrumb[0]}</span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="text-slate-500">{breadcrumb[1]}</span>
          </div>
        </div>

        {summary === 'revenue' ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <SummaryCard label="Bookings" value={data.counts?.all ?? 0} hint="matching the filters" />
            <SummaryCard label="Completed" value={data.summary?.completedRides ?? 0} tone="text-teal-600" />
            <SummaryCard label="Revenue" value={money(data.summary?.completedFare)} tone="text-emerald-600" hint="completed trips" />
            <SummaryCard label="Cash" value={money(data.summary?.cashFare)} tone="text-orange-600" />
            <SummaryCard label="Online" value={money(data.summary?.onlineFare)} tone="text-indigo-600" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Active now" value={data.counts?.all ?? 0} />
            <SummaryCard label="Searching driver" value={data.counts?.upcoming ?? 0} tone="text-amber-600" />
            <SummaryCard label="Driver on the way" value={data.counts?.accepted ?? 0} tone="text-emerald-600" />
            <SummaryCard label="Trip started" value={data.counts?.ongoing ?? 0} tone="text-blue-600" />
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-4 border-b border-slate-100 px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2 text-[14px] font-medium text-slate-500">
                <span>show</span>
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="h-9 w-16 rounded-md border border-slate-200 bg-white px-2 text-[13px] outline-none"
                >
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>entries</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {tabs.map((item) => {
                  const active = tab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setTab(item.key)}
                      className={`flex items-center gap-2 border-b-2 pb-1 text-[14px] font-bold transition-colors ${
                        active ? 'border-indigo-600 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {item.label}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                        {data.counts?.[item.key] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="h-10 w-64 rounded-full border border-slate-200 bg-white pl-9 pr-4 text-[13px] outline-none focus:border-slate-300"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters((value) => !value)}
                  className="flex items-center gap-2 rounded-lg bg-[#f46b45] px-4 py-2.5 text-[13px] font-bold text-white shadow-sm"
                >
                  <Filter size={16} /> Filters
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-white px-1.5 text-[11px] font-black text-[#f46b45]">{activeFilterCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => load()}
                  title="Refresh"
                  aria-label="Refresh"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {typeFilter && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{typeFilter.label}</span>
                {typeFilter.options.map((option) => {
                  const active = filters.type === option.value;
                  return (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      onClick={() => setFilter('type', option.value)}
                      className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition-colors ${
                        active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}

            {showFilters && (
              <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                <label className="text-[12px] font-bold text-slate-500">
                  From date
                  <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className="mt-1 block h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800" />
                </label>
                <label className="text-[12px] font-bold text-slate-500">
                  To date
                  <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className="mt-1 block h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800" />
                </label>
                <label className="text-[12px] font-bold text-slate-500">
                  Payment
                  <select value={filters.payment} onChange={(e) => setFilter('payment', e.target.value)} className="mt-1 block h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800">
                    <option value="">All</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                  </select>
                </label>
                {typeFilter && (
                  <label className="text-[12px] font-bold text-slate-500">
                    {typeFilter.label}
                    <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className="mt-1 block h-10 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-800">
                      {typeFilter.options.map((option) => (
                        <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  disabled={activeFilterCount === 0}
                  className="h-10 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-600 disabled:opacity-40"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead>
                <tr className="bg-slate-50">
                  {headings.map((heading) => (
                    <th key={heading} className="whitespace-nowrap border-b border-slate-100 px-5 py-4 text-[13px] font-bold text-slate-900">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading && data.results.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="py-20 text-center">
                      <Loader2 className="mx-auto animate-spin text-slate-300" size={32} />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={colSpan} className="py-20 text-center text-[14px] font-medium text-red-500">{error}</td>
                  </tr>
                ) : data.results.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="py-20 text-center text-[14px] font-medium text-slate-400">
                      {search || activeFilterCount ? 'No bookings match these filters.' : emptyText}
                    </td>
                  </tr>
                ) : (
                  data.results.map((row) => (
                    <tr key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer align-top transition-colors hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <p className="whitespace-nowrap text-[13px] font-bold text-indigo-700">{row.requestId}</p>
                        <div className="mt-1"><TypeBadge row={row} /></div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-[13px] font-medium text-slate-600">
                        {formatTime(row.date)}
                        {row.scheduledAt && <p className="text-[11px] font-bold text-amber-600">For {formatTime(row.scheduledAt)}</p>}
                      </td>
                      <td className="px-5 py-4 text-[13px]"><Person person={row.user} fallback={row.userName} /></td>
                      <td className="px-5 py-4 text-[13px]">
                        <Person person={row.driver} fallback="Unassigned" sub={row.driver?.vehicleNumber} />
                      </td>
                      {extraColumns.map((column) => (
                        <td key={column.header} className="px-5 py-4 text-[13px] text-slate-600">{column.render(row)}</td>
                      ))}
                      <td className="min-w-[220px] max-w-[300px] px-5 py-4 text-[12px] text-slate-600">
                        <p className="flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0 text-emerald-500" /><span className="line-clamp-2">{row.pickupLabel}</span></p>
                        <p className="mt-1 flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0 text-rose-500" /><span className="line-clamp-2">{row.dropLabel}</span></p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-[13px] font-black text-slate-800">{money(row.fare)}</td>
                      <td className="px-5 py-4"><PaymentBadge method={row.paymentOption} status={row.paymentStatus} /></td>
                      <td className="px-5 py-4"><StatusBadge row={row} /></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            title="View details"
                            aria-label={`View ${row.requestId}`}
                            className="text-slate-400 hover:text-indigo-600"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(row.id);
                            }}
                          >
                            <Eye size={18} />
                          </button>
                          {onDelete && (
                            <button
                              type="button"
                              title="Delete"
                              aria-label={`Delete ${row.requestId}`}
                              disabled={deletingId === row.id}
                              className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(row);
                              }}
                            >
                              {deletingId === row.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination paginator={data.paginator} onPage={setPage} />
        </div>
      </div>

      {selectedId && <RideDetailsDrawer rideId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
};

export default RideOperationsPage;
