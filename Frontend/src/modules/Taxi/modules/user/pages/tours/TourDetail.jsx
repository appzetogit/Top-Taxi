import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  MapPin,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import tourService from '../../services/tourService';

const getRoutePrefix = (pathname = '') => (pathname.startsWith('/taxi/user') ? '/taxi/user' : '');

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const TourDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const routePrefix = getRoutePrefix(location.pathname);
  const packageId = location.state?.packageId || params.id;

  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [openDay, setOpenDay] = useState(null);
  const [selectedDepartureId, setSelectedDepartureId] = useState('');
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!packageId) {
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
        if (!active) return;
        setPkg(data);
        const firstAvailable = (data?.upcomingDates || []).find((d) => d.seatsLeft > 0);
        setSelectedDepartureId(firstAvailable?.id || '');
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
  }, [packageId, navigate, routePrefix]);

  const selectedDeparture = useMemo(
    () => (pkg?.upcomingDates || []).find((d) => d.id === selectedDepartureId) || null,
    [pkg, selectedDepartureId],
  );

  const hasAnySeatsLeft = useMemo(
    () => (pkg?.upcomingDates || []).some((d) => d.seatsLeft > 0),
    [pkg],
  );

  const galleryPreview = useMemo(() => {
    if (!pkg) return [];
    const images = [pkg.coverImage, ...(pkg.galleryImages || [])].filter(Boolean);
    return images.slice(0, 5);
  }, [pkg]);

  const handleBookNow = () => {
    if (!selectedDeparture) return;
    navigate(`${routePrefix}/tours/${pkg.id}/book`, {
      state: { packageId: pkg.id, departureId: selectedDeparture.id },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen max-w-lg mx-auto items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="min-h-screen max-w-lg mx-auto bg-slate-50 p-6">
        <button onClick={() => navigate(-1)} className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <ArrowLeft size={18} />
        </button>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-600">
          {error || 'Tour package not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen max-w-lg mx-auto bg-slate-50 font-sans pb-32">
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-white/92 px-4 pb-3 pt-10 shadow-sm backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <ArrowLeft size={18} className="text-slate-900" />
        </button>
        <h1 className="truncate text-base font-black text-slate-900">{pkg.destination}</h1>
      </div>

      {/* Gallery */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 h-48 overflow-hidden rounded-2xl bg-slate-100">
            {galleryPreview[0] ? (
              <img src={galleryPreview[0]} alt={pkg.destination} className="h-full w-full object-cover" />
            ) : null}
          </div>
          {galleryPreview.slice(1, 3).map((img, index) => (
            <div key={index} className="h-24 overflow-hidden rounded-2xl bg-slate-100">
              <img src={img} alt={`${pkg.destination} ${index + 2}`} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
        {(pkg.galleryImages || []).length > 0 ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="mt-2 text-xs font-bold text-primary-orange/90 underline"
          >
            View all photos ({(pkg.galleryImages || []).length})
          </button>
        ) : null}
      </div>

      {/* Title + quick facts */}
      <div className="px-4 pt-4">
        <h2 className="text-xl font-black text-slate-900">{pkg.destination}</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-1"><MapPin size={13} /> {pkg.location}</span>
          {pkg.durationLabel ? <span className="flex items-center gap-1"><Clock3 size={13} /> {pkg.durationLabel}</span> : null}
          {pkg.ageRangeLabel ? <span>Age: {pkg.ageRangeLabel}</span> : null}
          {pkg.happyTravellersCount ? <span>{pkg.happyTravellersCount}+ happy travellers</span> : null}
        </div>
      </div>

      {/* Overview */}
      {pkg.overview ? (
        <div className="px-4 pt-5">
          <h3 className="text-sm font-black text-slate-900">Trip Overview</h3>
          <p className={`mt-2 text-sm text-slate-600 ${overviewExpanded ? '' : 'line-clamp-3'}`}>{pkg.overview}</p>
          <button
            type="button"
            onClick={() => setOverviewExpanded((v) => !v)}
            className="mt-1 text-xs font-bold text-primary-orange/90"
          >
            {overviewExpanded ? 'View Less' : 'View More'}
          </button>
        </div>
      ) : null}

      {/* Highlights */}
      {(pkg.highlights || []).length ? (
        <div className="px-4 pt-5">
          <h3 className="text-sm font-black text-slate-900">Trip Highlights</h3>
          <ul className="mt-2 space-y-1.5">
            {pkg.highlights.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /> {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Itinerary */}
      {(pkg.itinerary || []).length ? (
        <div className="px-4 pt-5">
          <h3 className="text-sm font-black text-slate-900">Itinerary</h3>
          <div className="mt-2 space-y-2">
            {pkg.itinerary.map((day) => {
              const isOpen = openDay === day.day;
              return (
                <div key={day.day} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setOpenDay(isOpen ? null : day.day)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-primary-orange/90">Day {day.day}</p>
                      <p className="text-sm font-bold text-slate-900">{day.title}</p>
                    </div>
                    <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen ? (
                    <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{day.description}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Upcoming Dates */}
      <div className="px-4 pt-5">
        <h3 className="text-sm font-black text-slate-900">Upcoming Dates</h3>
        {(pkg.upcomingDates || []).length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-slate-400">No upcoming departures</p>
        ) : (
          <div className="mt-2 space-y-2">
            {pkg.upcomingDates.map((departure) => {
              const soldOut = departure.seatsLeft === 0;
              const selected = selectedDepartureId === departure.id;
              return (
                <button
                  type="button"
                  key={departure.id}
                  disabled={soldOut}
                  onClick={() => setSelectedDepartureId(departure.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    soldOut
                      ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                      : selected
                        ? 'border-primary-orange/40 bg-primary-orange/5'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-primary-orange/90' : 'border-slate-300'}`}>
                      {selected ? <span className="h-2 w-2 rounded-full bg-primary-orange/90" /> : null}
                    </span>
                    <div>
                      <p className="flex items-center gap-1 text-sm font-bold text-slate-900">
                        <Calendar size={13} /> {formatDate(departure.startDate)} - {formatDate(departure.endDate)}
                      </p>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-bold ${soldOut ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {soldOut ? (
                      <>
                        <XCircle size={13} /> Sold out
                      </>
                    ) : (
                      <>
                        <Users size={13} /> {departure.seatsLeft} / {departure.totalSeats} left
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Inclusion / Exclusion */}
      <div className="grid grid-cols-1 gap-4 px-4 pt-5 sm:grid-cols-2">
        {(pkg.inclusions || []).length ? (
          <div>
            <h3 className="text-sm font-black text-slate-900">Inclusions</h3>
            <ul className="mt-2 space-y-1.5">
              {pkg.inclusions.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /> {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(pkg.exclusions || []).length ? (
          <div>
            <h3 className="text-sm font-black text-slate-900">Exclusions</h3>
            <ul className="mt-2 space-y-1.5">
              {pkg.exclusions.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" /> {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Sticky price box */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-lg -translate-x-1/2 border-t border-slate-100 bg-white px-4 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Starting From</p>
            <p className="text-lg font-black text-slate-900">₹{pkg.pricePerPerson}<span className="text-xs font-semibold text-slate-400">/person</span></p>
            {selectedDeparture ? (
              <p className="mt-0.5 text-xs font-semibold text-slate-500">{formatDate(selectedDeparture.startDate)}</p>
            ) : null}
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={handleBookNow}
            disabled={!hasAnySeatsLeft || !selectedDeparture}
            className="rounded-[14px] bg-slate-900 px-6 py-3 text-sm font-black text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] disabled:opacity-50"
          >
            {hasAnySeatsLeft ? 'Book Now' : 'Sold out'}
          </motion.button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="mb-3 flex h-9 w-9 items-center justify-center self-end rounded-full bg-white/10 text-white"
          >
            <X size={18} />
          </button>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {(pkg.galleryImages || []).map((img, index) => (
              <img key={index} src={img} alt={`Gallery ${index + 1}`} className="w-full rounded-xl object-contain" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TourDetail;
