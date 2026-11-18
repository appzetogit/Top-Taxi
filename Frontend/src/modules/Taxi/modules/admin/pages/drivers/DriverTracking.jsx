import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, InfoWindow, MarkerF, PolylineF } from '@react-google-maps/api';
import { Clock, MapPin, Phone, RefreshCw, Search } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';

const REFRESH_MS = 10000;

const TABS = [
  { key: 'waiting', label: 'Waiting for Trip', color: '#10B981' },
  { key: 'history', label: 'History', color: '#3B82F6' },
  { key: 'on_trip', label: 'On Trip', color: '#F59E0B' },
  { key: 'offline', label: 'Offline', color: '#6B7280' },
];
const TAB_BY_KEY = Object.fromEntries(TABS.map((tab) => [tab.key, tab]));
const STALE_COLOR = '#94A3B8';
const CANCELLED_COLOR = '#EF4444';

const HISTORY_WINDOWS = [
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 72, label: 'Last 3 days' },
  { hours: 168, label: 'Last 7 days' },
];

const MAP_STYLE = { width: '100%', height: '100%' };
const MAP_OPTIONS = {
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  fullscreenControl: true,
};

const timeAgo = (value) => {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';

const hasPoint = (place) => Number.isFinite(place?.lat) && Number.isFinite(place?.lng);

const dot = (color, scale = 8, opacity = 1) => ({
  path: window.google.maps.SymbolPath.CIRCLE,
  scale,
  fillColor: color,
  fillOpacity: opacity,
  strokeColor: '#ffffff',
  strokeWeight: 3,
});

const DriverTracking = () => {
  const [tab, setTab] = useState('waiting');
  const [hours, setHours] = useState(24);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ counts: {}, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const mapRef = useRef(null);
  const requestRef = useRef(0);
  const refitRef = useRef(true);

  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A new tab, search or window starts a fresh view: forget the selection and re-centre the map.
  useEffect(() => {
    setSelectedId(null);
    refitRef.current = true;
  }, [tab, search, hours]);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const requestId = ++requestRef.current;
      if (!quiet) setLoading(true);
      try {
        const response = await adminService.getDriverTracking({ status: tab, search, hours });
        if (requestId !== requestRef.current) return;
        setData(response?.data || { counts: {}, results: [] });
        setRefreshedAt(new Date());
        setError('');
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(err?.message || 'Could not load driver locations');
      } finally {
        // Not gated on `quiet`: a background refresh can supersede a visible load, and must still clear it.
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [tab, search, hours],
  );

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const isHistory = tab === 'history';
  const rows = data.results || [];
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const accent = TAB_BY_KEY[tab].color;

  // What goes on the map for each row of the current tab.
  const markers = useMemo(() => {
    if (isHistory) {
      return rows
        .filter((row) => hasPoint(row.drop))
        .map((row) => ({
          id: row.id,
          position: { lat: row.drop.lat, lng: row.drop.lng },
          color: row.status === 'cancelled' ? CANCELLED_COLOR : accent,
          opacity: 1,
        }));
    }
    return rows
      .filter((row) => hasPoint(row.position))
      .map((row) => ({
        id: row.id,
        position: row.position,
        color: row.locationStale ? STALE_COLOR : accent,
        opacity: row.locationStale ? 0.7 : 1,
      }));
  }, [rows, isHistory, accent]);

  // The selected row's trip, drawn as pickup -> drop.
  const route = useMemo(() => {
    const trip = isHistory ? selected : selected?.trip;
    if (!trip || !hasPoint(trip.pickup) || !hasPoint(trip.drop)) return null;
    return { pickup: trip.pickup, drop: trip.drop };
  }, [selected, isHistory]);

  const selectedPosition = useMemo(() => {
    if (!selected) return null;
    if (isHistory) return hasPoint(selected.drop) ? { lat: selected.drop.lat, lng: selected.drop.lng } : null;
    return hasPoint(selected.position) ? selected.position : null;
  }, [selected, isHistory]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const points = [...markers.map((marker) => marker.position)];
    if (route) points.push(route.pickup, route.drop);
    if (!points.length) {
      map.setCenter(INDIA_CENTER);
      map.setZoom(5);
      return;
    }
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(15);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 64);
  }, [markers, route]);

  // Re-fit only when the view changed, never on a background refresh, so panning is not undone every 10 s.
  useEffect(() => {
    if (!isLoaded || !refitRef.current || loading) return;
    refitRef.current = false;
    fitAll();
  }, [isLoaded, loading, markers, fitAll]);

  const selectRow = (row) => {
    setSelectedId(row.id);
    const map = mapRef.current;
    const trip = isHistory ? row : row.trip;
    const target = isHistory ? row.drop : row.position;
    if (!map || !window.google) return;
    if (trip && hasPoint(trip.pickup) && hasPoint(trip.drop)) {
      const bounds = new window.google.maps.LatLngBounds();
      [trip.pickup, trip.drop, hasPoint(row.position) ? row.position : null].filter(Boolean).forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 80);
    } else if (hasPoint(target)) {
      map.panTo(target);
      map.setZoom(Math.max(map.getZoom() || 0, 15));
    }
  };

  const total = data.counts?.[tab] ?? rows.length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-gray-900">Driver Tracking</h1>
          <p className="text-xs font-semibold text-gray-500">
            Live positions refresh every {REFRESH_MS / 1000}s
            {refreshedAt ? ` · updated ${refreshedAt.toLocaleTimeString('en-IN')}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-bold transition-colors ${
                active ? 'border-transparent text-white shadow' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
              style={active ? { backgroundColor: item.color } : undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: active ? '#fff' : item.color }} />
              {item.label}
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/25' : 'bg-gray-100'}`}>
                {data.counts?.[item.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="flex h-[640px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 p-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={isHistory ? 'Search trip, driver, rider' : 'Search name, phone, vehicle no.'}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            {isHistory && (
              <select
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
                className="rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-700"
              >
                {HISTORY_WINDOWS.map((option) => (
                  <option key={option.hours} value={option.hours}>{option.label}</option>
                ))}
              </select>
            )}
          </div>

          <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
            {total} {isHistory ? 'trips' : 'drivers'} found
            {rows.length < total ? ` · showing ${rows.length}` : ''}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error && <p className="p-4 text-sm font-semibold text-rose-600">{error}</p>}
            {!error && !loading && rows.length === 0 && (
              <p className="p-6 text-center text-sm font-semibold text-gray-400">No record found</p>
            )}
            {rows.map((row) => {
              const isSelected = row.id === selectedId;
              const title = isHistory ? row.driver?.name || 'Unassigned' : row.name;
              const trip = isHistory ? row : row.trip;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectRow(row)}
                  className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    isSelected ? 'bg-indigo-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-gray-900">{title}</p>
                      <p className="truncate text-xs font-semibold text-gray-500">
                        {isHistory
                          ? `${row.requestId} · ${row.driver?.vehicleNumber || row.driver?.vehicleType || ''}`
                          : [row.vehicleNumber, row.vehicleType].filter(Boolean).join(' · ') || 'No vehicle details'}
                      </p>
                    </div>
                    {isHistory ? (
                      <span
                        className="shrink-0 rounded px-2 py-0.5 text-[10px] font-black uppercase text-white"
                        style={{ backgroundColor: row.status === 'cancelled' ? CANCELLED_COLOR : '#10B981' }}
                      >
                        {row.status}
                      </span>
                    ) : row.locationStale ? (
                      <span className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">
                        Signal lost
                      </span>
                    ) : null}
                  </div>

                  {(isHistory ? row.driver?.phone : row.phone) && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <Phone size={11} /> {isHistory ? row.driver.phone : row.phone}
                    </p>
                  )}

                  {trip && (
                    <div className="mt-2 space-y-0.5 text-xs text-gray-600">
                      {!isHistory && <p className="font-bold text-gray-700">{trip.requestId}</p>}
                      <p className="truncate"><span className="font-bold text-emerald-600">From</span> {trip.pickup?.address || '-'}</p>
                      <p className="truncate"><span className="font-bold text-rose-600">To</span> {trip.drop?.address || '-'}</p>
                      {trip.rider?.name && <p>Rider: {trip.rider.name}</p>}
                    </div>
                  )}

                  <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-gray-400">
                    <Clock size={11} />
                    {isHistory
                      ? `${formatDateTime(row.completedAt || row.createdAt)}${row.fare ? ` · ₹${row.fare}` : ''}`
                      : row.position
                        ? `Location ${timeAgo(row.locationUpdatedAt)}`
                        : 'No location reported yet'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative h-[640px] overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loadError ? (
            <div className="flex h-full items-center justify-center font-semibold uppercase text-rose-500">Maps load failed</div>
          ) : !HAS_VALID_GOOGLE_MAPS_KEY ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm font-semibold text-gray-500">
              Google Maps key is not configured. Add it under Settings → Integration → Map to see drivers on the map.
            </div>
          ) : !isLoaded ? (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">Loading map…</div>
          ) : (
            <GoogleMap
              mapContainerStyle={MAP_STYLE}
              center={INDIA_CENTER}
              zoom={5}
              options={MAP_OPTIONS}
              onLoad={(map) => { mapRef.current = map; }}
              onUnmount={() => { mapRef.current = null; }}
              onClick={() => setSelectedId(null)}
            >
              {markers.map((marker) => (
                <MarkerF
                  key={marker.id}
                  position={marker.position}
                  icon={dot(marker.color, marker.id === selectedId ? 11 : 8, marker.opacity)}
                  zIndex={marker.id === selectedId ? 10 : 1}
                  onClick={() => setSelectedId(marker.id)}
                />
              ))}

              {route && (
                <>
                  <PolylineF
                    path={[route.pickup, route.drop]}
                    options={{ strokeColor: accent, strokeOpacity: 0.8, strokeWeight: 4, geodesic: true }}
                  />
                  <MarkerF position={route.pickup} icon={dot('#10B981', 7)} title="Pickup" />
                  <MarkerF position={route.drop} icon={dot('#EF4444', 7)} title="Drop" />
                </>
              )}

              {selected && selectedPosition && (
                <InfoWindow position={selectedPosition} onCloseClick={() => setSelectedId(null)}>
                  <div className="min-w-[190px] p-1">
                    <p className="text-sm font-black text-gray-900">
                      {isHistory ? selected.driver?.name || 'Unassigned' : selected.name}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {isHistory
                        ? `${selected.requestId} · ${selected.status}`
                        : [selected.vehicleNumber, selected.vehicleType].filter(Boolean).join(' · ')}
                    </p>
                    {!isHistory && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                        <MapPin size={11} /> {selected.locationStale ? 'Last seen ' : 'Updated '}
                        {timeAgo(selected.locationUpdatedAt)}
                      </p>
                    )}
                    {(isHistory ? selected : selected.trip) && (
                      <p className="mt-1 text-[11px] text-gray-600">
                        {(isHistory ? selected : selected.trip).pickup?.address || '-'} →{' '}
                        {(isHistory ? selected : selected.trip).drop?.address || '-'}
                      </p>
                    )}
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          )}

          {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY && (
            <button
              type="button"
              onClick={fitAll}
              className="absolute bottom-4 left-4 rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow hover:bg-gray-50"
            >
              Fit all
            </button>
          )}
          {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY && !loading && !markers.length && rows.length > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-white/95 px-4 py-2 text-xs font-bold text-gray-500 shadow">
              These drivers have not reported a location yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverTracking;
