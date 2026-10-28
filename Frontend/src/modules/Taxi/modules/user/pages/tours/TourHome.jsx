import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, Loader2, MapPin, Users } from 'lucide-react';
import tourService from '../../services/tourService';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
};

const TourHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = getRoutePrefix(location.pathname);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await tourService.listPackages();
        const results = response?.data?.results || response?.results || [];
        if (active) setPackages(Array.isArray(results) ? results : []);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load tour packages');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const handleSelect = (pkg) => {
    navigate(`${routePrefix}/tours/${pkg.id}`, { state: { packageId: pkg.id } });
  };

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-[linear-gradient(180deg,#fff7ed_0%,#fffaf7_16%,#f8fafc_100%)] font-sans pb-10">
      <div className="sticky top-0 z-20 border-b border-primary-orange/10/70 bg-white/92 px-4 pb-4 pt-10 shadow-[0_6px_20px_rgba(15,23,42,0.05)] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm active:scale-95 transition-all"
          >
            <ArrowLeft size={18} className="text-slate-900" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-black text-slate-900">Tour Packages</h1>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{packages.length} destinations</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 pt-5">
        {loading ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-12 text-slate-500 shadow-sm">
            <Loader2 size={32} className="mx-auto animate-spin text-slate-400" />
            <p className="mt-4 text-center text-sm font-bold text-slate-400">Finding tour packages...</p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-600">{error}</div>
        ) : null}

        {!loading && !error && packages.length === 0 ? (
          <div className="rounded-3xl border border-slate-100 bg-white p-12 text-center shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">No tour packages available</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">Check back soon for new destinations.</p>
          </div>
        ) : null}

        {!loading && !error
          ? packages.map((pkg, index) => (
              <motion.button
                key={pkg.id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleSelect(pkg)}
                className="w-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-transform active:scale-[0.98]"
              >
                <div className="h-40 w-full overflow-hidden bg-slate-100">
                  {pkg.coverImage ? (
                    <img src={pkg.coverImage} alt={pkg.destination} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-300">
                      <MapPin size={32} />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="text-base font-black text-slate-900">{pkg.destination}</h3>
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
                    <MapPin size={12} /> {pkg.location}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Starting from</p>
                      <p className="text-lg font-black text-slate-900">₹{pkg.pricePerPerson}<span className="text-xs font-semibold text-slate-400">/person</span></p>
                    </div>
                    {pkg.durationLabel ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">{pkg.durationLabel}</span>
                    ) : null}
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {pkg.nextDeparture ? (
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <Calendar size={13} className="text-slate-400" />
                        <span>{formatDate(pkg.nextDeparture.startDate)} - {formatDate(pkg.nextDeparture.endDate)}</span>
                        <span className="ml-auto flex items-center gap-1 text-primary-orange/90">
                          <Users size={12} /> {pkg.nextDeparture.seatsLeft} seats left
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-400">No upcoming departures</p>
                    )}
                  </div>
                </div>
              </motion.button>
            ))
          : null}
      </div>
    </div>
  );
};

export default TourHome;
