/*
 * Place search for the admin's booking form, done on the server.
 *
 * The browser's Places widget needs the legacy Places API on the browser key, and
 * fails with "This page can't load Google Maps correctly" when that is not
 * enabled. The server key already has Places (New), so the search goes through
 * here and the form never depends on the browser key.
 */
import { ApiError } from '../../../../utils/ApiError.js';
import { getGoogleMapsApiKey } from '../../../../core/settings/mapSettings.service.js';

const text = (value) => String(value ?? '').trim();

const serverKey = async () => text(process.env.GOOGLE_MAPS_API_KEY) || text(await getGoogleMapsApiKey());

const callGoogle = async (url, init, fieldMask) => {
  const key = await serverKey();
  if (!key) throw new ApiError(503, 'Place search is not set up: there is no Google Maps key on the server.');

  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    });
  } catch {
    throw new ApiError(502, 'Could not reach Google Maps. Try again in a moment.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(502, `Google Maps refused the search: ${body?.error?.message || response.status}`);
  }
  return body;
};

export const searchPlaces = async (query) => {
  const input = text(query);
  if (input.length < 2) return { results: [] };

  const body = await callGoogle(
    'https://places.googleapis.com/v1/places:autocomplete',
    { method: 'POST', body: JSON.stringify({ input, languageCode: 'en' }) },
    'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat',
  );

  return {
    results: (body.suggestions || [])
      .map((item) => item.placePrediction)
      .filter(Boolean)
      .slice(0, 6)
      .map((prediction) => ({
        placeId: prediction.placeId,
        label: prediction.text?.text || '',
        main: prediction.structuredFormat?.mainText?.text || prediction.text?.text || '',
        secondary: prediction.structuredFormat?.secondaryText?.text || '',
      })),
  };
};

export const getPlaceDetails = async (placeId) => {
  const id = text(placeId);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new ApiError(400, 'Choose a place from the list.');

  const body = await callGoogle(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
    { method: 'GET' },
    'id,displayName,formattedAddress,location',
  );
  const lat = Number(body.location?.latitude);
  const lng = Number(body.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new ApiError(404, 'That place has no location. Choose another.');

  const name = body.displayName?.text || '';
  const address = body.formattedAddress || '';
  return { address: name && address && !address.startsWith(name) ? `${name}, ${address}` : address || name, lat, lng };
};
