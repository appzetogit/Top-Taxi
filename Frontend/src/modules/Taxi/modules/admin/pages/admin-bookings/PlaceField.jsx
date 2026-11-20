import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MapPin } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { describeApiError } from '../../../../shared/utils/apiError';
import { adminInputClass, adminLabelClass } from '../../components/ui/adminUi.js';

/*
 * A place the admin picks for a booking: { address, lat, lng }.
 *
 * Search-as-you-type through the server (Google Places), so it does not depend on
 * the browser's Maps key. A place is only "set" once it was picked from the list;
 * typing over it clears it, so an edited address is never sent with old coordinates.
 */
const PlaceField = ({ label, value, onChange, disabled = false }) => {
  const [text, setText] = useState(value?.address || '');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const hasPoint = Number.isFinite(value?.lat) && Number.isFinite(value?.lng);

  // The parent can reset the field (new booking, airport chosen): follow it.
  useEffect(() => {
    setText(value?.address || '');
  }, [value?.address]);

  useEffect(() => {
    const term = text.trim();
    if (!open || hasPoint || term.length < 3) {
      setOptions([]);
      return undefined;
    }
    const requestId = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await adminService.searchBookingPlaces(term);
        if (requestId !== requestRef.current) return;
        setOptions(response?.data?.results || []);
        setError('');
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setOptions([]);
        setError(describeApiError(err, 'Could not search places.'));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [text, open, hasPoint]);

  const handleType = (event) => {
    setText(event.target.value);
    setOpen(true);
    onChange({ address: event.target.value, lat: null, lng: null });
  };

  const pick = async (option) => {
    setOpen(false);
    setOptions([]);
    setLoading(true);
    try {
      const response = await adminService.getBookingPlace(option.placeId);
      const place = response?.data;
      setText(place.address);
      onChange({ address: place.address, lat: place.lat, lng: place.lng });
      setError('');
    } catch (err) {
      setError(describeApiError(err, 'Could not get that place.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <label className={adminLabelClass}>{label}</label>
      <input
        type="text"
        value={text}
        onChange={handleType}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        placeholder="Search a place, then pick it from the list"
        className={adminInputClass}
        autoComplete="off"
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {options.map((option) => (
            <li key={option.placeId}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(option)} className="block w-full px-3 py-2 text-left hover:bg-gray-50">
                <span className="block text-sm font-semibold text-gray-900">{option.main}</span>
                <span className="block text-[11px] text-gray-500">{option.secondary}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${error ? 'text-rose-600' : hasPoint ? 'text-emerald-600' : 'text-gray-400'}`}>
        {loading ? <Loader2 size={12} className="animate-spin" /> : hasPoint ? <Check size={12} /> : <MapPin size={12} />}
        {error || (hasPoint ? `Location set (${value.lat.toFixed(4)}, ${value.lng.toFixed(4)})` : 'Location not set yet')}
      </p>
    </div>
  );
};

export default PlaceField;
