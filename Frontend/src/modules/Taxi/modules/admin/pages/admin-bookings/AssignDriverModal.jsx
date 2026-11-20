import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Phone, Search, Star, X } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { describeApiError } from '../../../../shared/utils/apiError';
import { adminInputClass } from '../../components/ui/adminUi.js';

/*
 * Give a booked ride to a driver. Only drivers of the pickup's zone with a
 * suitable vehicle are listed; the server checks the same again on save.
 *
 * Before the customer has confirmed, the pick is only remembered and nobody is
 * told. Once it is confirmed, the pick is assigned straight away and the driver
 * is notified.
 */
const AssignDriverModal = ({ booking, onClose, onChanged }) => {
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ zone: null, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const confirmed = booking.confirmation === 'confirmed';
  const current = booking.driver || booking.preAssignedDriver || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminService.getAdminBookingDrivers(booking.id, search.trim());
      setData(response?.data || { zone: null, results: [] });
      setError('');
    } catch (err) {
      setError(describeApiError(err, 'Could not load the drivers.'));
    } finally {
      setLoading(false);
    }
  }, [booking.id, search]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const assign = async (driver) => {
    setBusyId(driver.id);
    setError('');
    try {
      const response = await adminService.assignAdminBookingDriver(booking.id, driver.id);
      const result = response?.data || {};
      onChanged(
        result.assigned
          ? `${driver.name} is assigned and has been notified.`
          : `${driver.name} is picked. They will be assigned when the customer confirms the booking.`,
      );
    } catch (err) {
      setError(describeApiError(err, 'Could not assign this driver.'));
    } finally {
      setBusyId('');
    }
  };

  const remove = async () => {
    setBusyId('remove');
    setError('');
    try {
      await adminService.unassignAdminBookingDriver(booking.id);
      onChanged('The driver was removed from this booking.');
    } catch (err) {
      setError(describeApiError(err, 'Could not remove the driver.'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Assign a driver</h2>
            <p className="text-xs text-gray-500">
              {booking.code} · {booking.subtitle}
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              {data.zone ? `Drivers of the ${data.zone.name} zone` : 'Drivers'}
              {confirmed ? '' : ' · picked now, assigned once the customer confirms'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {current ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
            <div className="text-sm">
              <p className="font-bold text-gray-900">{booking.driver ? 'Assigned' : 'Picked'}: {current.name}</p>
              <p className="text-xs text-gray-500">{[current.phone, current.vehicleNumber].filter(Boolean).join(' · ')}</p>
            </div>
            <button
              type="button"
              onClick={remove}
              disabled={busyId === 'remove'}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
            >
              {busyId === 'remove' ? 'Removing...' : 'Remove'}
            </button>
          </div>
        ) : null}

        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or vehicle number"
            className={`${adminInputClass} pl-9`}
          />
        </div>

        {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{error}</div> : null}

        <div className="max-h-[360px] space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-300" size={26} /></div>
          ) : data.results.length === 0 ? (
            <p className="py-8 text-center text-sm font-medium text-gray-400">No drivers of this zone are available for this vehicle.</p>
          ) : (
            data.results.map((driver) => (
              <div key={driver.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <p className="flex items-center gap-2 font-bold text-gray-900">
                    <span className="truncate">{driver.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${driver.isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {driver.isOnline ? 'Online' : 'Offline'}
                    </span>
                    {driver.isOnRide ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">On a trip</span> : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1"><Phone size={11} />{driver.phone}</span>
                    <span>{[driver.vehicleNumber, driver.vehicle || driver.vehicleType].filter(Boolean).join(' · ')}</span>
                    {driver.rating > 0 ? <span className="inline-flex items-center gap-1"><Star size={11} className="text-amber-500" />{Number(driver.rating).toFixed(1)}</span> : null}
                    {driver.distanceKm != null ? <span>{driver.distanceKm} km from pickup</span> : null}
                  </p>
                  {driver.hasScheduleConflict ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                      <AlertTriangle size={11} /> Has another trip around this time
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => assign(driver)}
                  disabled={Boolean(busyId) || driver.isCurrent || driver.hasScheduleConflict}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyId === driver.id ? <Loader2 size={13} className="animate-spin" /> : driver.isCurrent ? 'Selected' : confirmed ? 'Assign' : 'Pick'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AssignDriverModal;
