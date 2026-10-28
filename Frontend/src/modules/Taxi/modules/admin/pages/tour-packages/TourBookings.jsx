import React, { useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';
import AdminPageHeader from '../../components/ui/AdminPageHeader.jsx';
import { adminCardClass, adminInputClass, adminLabelClass, adminPageContainerClass } from '../../components/ui/adminUi.js';

const STATUS_OPTIONS = ['', 'pending', 'partial', 'paid', 'failed', 'expired'];

const STATUS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  partial: 'bg-sky-50 text-sky-700',
  paid: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  expired: 'bg-gray-100 text-gray-500',
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const TourBookings = () => {
  const [packages, setPackages] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState({ totalBookings: 0, totalCollected: 0, totalOutstanding: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [packageFilter, setPackageFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    adminService
      .getTourPackages()
      .then((response) => {
        if (!mounted) return;
        setPackages(response?.data?.results || response?.results || []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

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
        const data = response?.data || response || {};
        setBookings(Array.isArray(data.bookings) ? data.bookings : []);
        setSummary(data.summary || { totalBookings: 0, totalCollected: 0, totalOutstanding: 0 });
      })
      .catch((error) => {
        if (!mounted) return;
        setErrorMessage(error?.message || 'Could not load tour bookings.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [statusFilter, packageFilter]);

  const packageOptions = useMemo(() => packages.map((pkg) => ({ id: pkg.id, label: pkg.destination })), [packages]);

  return (
    <div className={adminPageContainerClass}>
      <AdminPageHeader module="Price Management" page="Tour Bookings" />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Bookings</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.totalBookings || 0}</p>
        </div>
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Collected</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">₹{summary.totalCollected || 0}</p>
        </div>
        <div className={adminCardClass}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total Outstanding</p>
          <p className="mt-1 text-2xl font-bold text-rose-600">₹{summary.totalOutstanding || 0}</p>
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

      {errorMessage ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{errorMessage}</div>
      ) : null}

      {loading ? (
        <div className={adminCardClass}>Loading tour bookings...</div>
      ) : bookings.length === 0 ? (
        <div className={adminCardClass}>No tour bookings found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Payment Status</th>
                <th className="px-4 py-3">Booking Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{booking.customerName}</p>
                    <p className="text-xs text-gray-500">{booking.customerPhone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{booking.packageSnapshot?.destination || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(booking.departureSnapshot?.startDate)} - {formatDate(booking.departureSnapshot?.endDate)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">₹{booking.totalAmount}</td>
                  <td className="px-4 py-3 text-emerald-600">₹{booking.amountPaid}</td>
                  <td className="px-4 py-3 text-rose-600">₹{booking.balanceAmount}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS_BADGE[booking.paymentStatus] || 'bg-gray-100 text-gray-500'}`}>
                      {booking.paymentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{booking.status}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(booking.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TourBookings;
