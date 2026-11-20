import React, { useEffect, useState } from 'react';
import { Autocomplete } from '@react-google-maps/api';
import { Check, MapPin } from 'lucide-react';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../utils/googleMaps';
import { adminInputClass, adminLabelClass } from '../../components/ui/adminUi.js';

/*
 * A place the admin picks for a booking: { address, lat, lng }.
 *
 * Search-as-you-type through Google Places, so the coordinates are real and the
 * zone and fare can be worked out from them. A place is only "set" once it was
 * picked from the suggestions; typing over it clears it, so an address that was
 * edited by hand can never be sent with the old coordinates.
 *
 * With no Maps key the admin can still book: they type the address and its
 * latitude and longitude.
 */
const PlaceField = ({ label, value, onChange, disabled = false }) => {
  const { isLoaded } = useAppGoogleMapsLoader();
  const [autocomplete, setAutocomplete] = useState(null);
  const [text, setText] = useState(value?.address || '');
  const hasPoint = Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
  const useSearch = HAS_VALID_GOOGLE_MAPS_KEY && isLoaded;

  // The parent can reset the field (new booking, airport chosen): follow it.
  useEffect(() => {
    setText(value?.address || '');
  }, [value?.address]);

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const lat = place?.geometry?.location?.lat?.();
    const lng = place?.geometry?.location?.lng?.();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const address = String(place.formatted_address || place.name || '').trim();
    setText(address);
    onChange({ address, lat, lng });
  };

  const handleType = (event) => {
    setText(event.target.value);
    if (hasPoint) onChange({ address: event.target.value, lat: null, lng: null });
    else onChange({ ...(value || {}), address: event.target.value });
  };

  return (
    <div>
      <label className={adminLabelClass}>{label}</label>
      {useSearch ? (
        <Autocomplete onLoad={setAutocomplete} onPlaceChanged={handlePlaceChanged}>
          <input
            type="text"
            value={text}
            onChange={handleType}
            disabled={disabled}
            placeholder="Search a place, then pick it from the list"
            className={adminInputClass}
          />
        </Autocomplete>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={text}
            onChange={handleType}
            disabled={disabled}
            placeholder="Address"
            className={adminInputClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              step="any"
              placeholder="Latitude"
              value={Number.isFinite(value?.lat) ? value.lat : ''}
              onChange={(e) => onChange({ ...(value || {}), address: text, lat: e.target.value === '' ? null : Number(e.target.value) })}
              className={adminInputClass}
            />
            <input
              type="number"
              step="any"
              placeholder="Longitude"
              value={Number.isFinite(value?.lng) ? value.lng : ''}
              onChange={(e) => onChange({ ...(value || {}), address: text, lng: e.target.value === '' ? null : Number(e.target.value) })}
              className={adminInputClass}
            />
          </div>
        </div>
      )}
      <p className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${hasPoint ? 'text-emerald-600' : 'text-gray-400'}`}>
        {hasPoint ? <Check size={12} /> : <MapPin size={12} />}
        {hasPoint ? `Location set (${value.lat.toFixed(4)}, ${value.lng.toFixed(4)})` : 'Location not set yet'}
      </p>
    </div>
  );
};

export default PlaceField;
