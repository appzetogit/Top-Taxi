import crypto from 'node:crypto';
import {
  SHARE_TOKEN_PATTERN,
  createRideShareLink,
  getSharedRideSnapshot,
} from '../services/rideShareService.js';

const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

/** POST /taxi/rides/:rideId/share — rider creates the safety-share link. */
export const createShareLink = async (req, res) => {
  const data = await createRideShareLink({ rideId: req.params.rideId, userId: req.auth.sub });
  res.json({ success: true, message: 'Share link ready', data });
};

/** GET /taxi/share/:token — public JSON polled by the tracking page. */
export const getSharedRide = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const snapshot = await getSharedRideSnapshot(req.params.token);
  if (!snapshot) {
    return res.status(404).json({ success: false, message: 'Tracking link not found', data: { expired: true } });
  }
  if (snapshot.expired) {
    return res.status(410).json({ success: false, message: 'This ride has ended. The tracking link has expired.', data: snapshot });
  }
  return res.json({ success: true, data: snapshot });
};

/**
 * GET /taxi/share/view/:token — the web page the link opens
 * (nginx maps https://<host>/track/ride/<token> here).
 *
 * Self-contained: Leaflet + OpenStreetMap tiles, so no Maps API key ships to
 * the public. It polls the JSON endpoint; every value is written with
 * textContent, never as HTML.
 */
export const renderSharedRidePage = async (req, res) => {
  const token = String(req.params.token || '');
  const valid = SHARE_TOKEN_PATTERN.test(token);
  const nonce = crypto.randomBytes(16).toString('base64');

  // Replace the API-wide `default-src 'self'` CSP with one this page needs.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
      `style-src 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
      "img-src 'self' data: https://tile.openstreetmap.org https:",
      "connect-src 'self'",
      "font-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'strict-origin');
  res.type('html');
  res.status(valid ? 200 : 404).send(pageHtml({ nonce, token: valid ? token : '' }));
};

const pageHtml = ({ nonce, token }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Live ride tracking</title>
<link rel="stylesheet" href="${LEAFLET_CSS}" crossorigin="anonymous">
<style nonce="${nonce}">
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--brand:#ff5200;--ok:#10b981;--bad:#ef4444}
  @media (prefers-color-scheme: dark){:root{--ink:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--bg:#0b1120;--card:#111827}}
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .app{display:flex;flex-direction:column;height:100%}
  header{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
  header b{font-size:17px;color:var(--brand)}header span{color:var(--muted);font-size:13px}
  .live{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--ok)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);animation:p 1.4s infinite}@keyframes p{50%{opacity:.25}}
  #map{flex:1;min-height:260px}
  .sheet{background:var(--card);border-top:1px solid var(--line);padding:14px 16px calc(14px + env(safe-area-inset-bottom))}
  .stage{font-weight:800;font-size:17px;margin:0 0 10px}
  .drv{display:flex;align-items:center;gap:12px}
  .av{width:48px;height:48px;border-radius:50%;background:#fff7ed;object-fit:cover;flex:none;display:flex;align-items:center;justify-content:center;font-size:22px}
  .drv .n{font-weight:700;font-size:16px}.drv .v{color:var(--muted);font-size:13px}
  .plate{margin-left:auto;border:1.5px solid #1e293b;background:#fff8dc;color:#0f172a;border-radius:6px;padding:5px 8px;font-weight:800;letter-spacing:.06em;font-size:13px;white-space:nowrap}
  .route{margin-top:12px;border-top:1px solid var(--line);padding-top:10px;font-size:13.5px}
  .route div{display:flex;gap:8px;margin:5px 0}.route i{width:10px;height:10px;border-radius:50%;margin-top:4px;flex:none}
  .muted{color:var(--muted);font-size:12px;margin-top:8px}
  .end{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;gap:8px}
  .end .big{font-size:48px}.end h1{font-size:20px;margin:0}.end p{color:var(--muted);margin:0;max-width:320px}
  .hidden{display:none!important}
  .car{font-size:26px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}
  .pin{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  .ok{background:#10b981}.bad{background:#ff5200}
</style>
</head>
<body>
<div class="app">
  <header><b>Gogo</b><span>Live ride tracking</span><div class="live" id="live"><span class="dot"></span>LIVE</div></header>
  <div id="map"></div>
  <div class="sheet" id="sheet">
    <p class="stage" id="stage">Loading ride…</p>
    <div class="drv">
      <div class="av" id="av">👤</div>
      <div><div class="n" id="dname">—</div><div class="v" id="vline"></div></div>
      <div class="plate hidden" id="plate"></div>
    </div>
    <div class="route">
      <div><i class="ok"></i><span id="pickup">—</span></div>
      <div><i class="bad"></i><span id="drop">—</span></div>
    </div>
    <div class="muted" id="updated"></div>
    <div class="muted">In an emergency call 112.</div>
  </div>
  <div class="end hidden" id="ended">
    <div class="big">✅</div>
    <h1>This ride has ended</h1>
    <p>The tracking link has expired. Live location is only shared while the ride is in progress.</p>
  </div>
</div>
<script src="${LEAFLET_JS}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
(function(){
  var TOKEN = ${JSON.stringify(token)};
  var API = '/api/v1/taxi/share/' + encodeURIComponent(TOKEN);
  var $ = function(id){ return document.getElementById(id); };

  var map = null, carMarker = null, pickupMarker = null, dropMarker = null, fitted = false, timer = null;

  function ended(){
    if (timer) clearInterval(timer);
    $('map').classList.add('hidden'); $('sheet').classList.add('hidden'); $('live').classList.add('hidden');
    $('ended').classList.remove('hidden');
  }
  if (!TOKEN) { ended(); return; }

  function ensureMap(lat, lng){
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([lat, lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }
  function dot(cls){
    return L.divIcon({ className: 'pin ' + cls, iconSize: [16,16], iconAnchor: [8,8] });
  }
  // Frame car + pickup + drop. Only counts once the map has a real size: a fit
  // done while the container is 0px (backgrounded tab, mid-layout) lands at
  // world zoom and would otherwise stick.
  function fitAll(){
    if (!map) return;
    var size = map.getSize();
    if (!size.x || !size.y) return;
    var pts = [];
    [carMarker, pickupMarker, dropMarker].forEach(function(m){ if (m) pts.push(m.getLatLng()); });
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16, animate: false });
    else if (pts.length) map.setView(pts[0], 15, { animate: false });
    else return;
    fitted = true;
  }
  window.addEventListener('resize', function(){
    if (!map) return;
    map.invalidateSize(false);
    if (map.getZoom() < 5) fitted = false;
    if (!fitted) fitAll();
  });
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') { if (map && map.getZoom() < 5) fitted = false; poll(); }
  });
  var carIcon = function(){ return L.divIcon({ className: 'car', iconSize: [26,26], iconAnchor: [13,13], html: '🚕' }); };

  function ago(iso){
    if (!iso) return '';
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'Location updated just now';
    var m = Math.round(s / 60);
    return 'Location updated ' + m + ' min ago';
  }

  function render(d){
    $('stage').textContent = d.stageLabel || 'Ride in progress';
    $('dname').textContent = (d.driver && d.driver.name) ? d.driver.name + (d.driver.rating ? '  ★ ' + Number(d.driver.rating).toFixed(1) : '') : 'Your driver';
    var v = d.vehicle || {};
    $('vline').textContent = [v.color, v.make, v.model].filter(Boolean).join(' ') + (v.type ? ' · ' + v.type : '');
    if (v.number) { $('plate').textContent = v.number; $('plate').classList.remove('hidden'); }
    var av = $('av');
    if (d.driver && d.driver.photo && !av.querySelector('img')) {
      var img = document.createElement('img'); img.className = 'av'; img.alt = ''; img.src = d.driver.photo;
      img.onerror = function(){ av.textContent = '👤'; };
      av.textContent = ''; av.appendChild(img);
    }
    $('pickup').textContent = (d.pickup && d.pickup.address) || '—';
    $('drop').textContent = (d.drop && d.drop.address) || '—';
    $('updated').textContent = d.driverLocation ? ago(d.driverLocation.updatedAt) : 'Waiting for the driver\\'s location…';

    var center = d.driverLocation || d.pickup;
    if (!center || center.lat == null) return;
    ensureMap(center.lat, center.lng);
    if (!map) return;
    if (d.pickup && d.pickup.lat != null && !pickupMarker) pickupMarker = L.marker([d.pickup.lat, d.pickup.lng], { icon: dot('ok') }).addTo(map);
    if (d.drop && d.drop.lat != null && !dropMarker) dropMarker = L.marker([d.drop.lat, d.drop.lng], { icon: dot('bad') }).addTo(map);
    if (d.driverLocation) {
      var ll = [d.driverLocation.lat, d.driverLocation.lng];
      if (!carMarker) carMarker = L.marker(ll, { icon: carIcon(), zIndexOffset: 1000 }).addTo(map);
      else carMarker.setLatLng(ll);
    }
    map.invalidateSize(false);
    if (map.getZoom() < 5) fitted = false;
    if (!fitted) {
      fitAll();
    } else if (carMarker) {
      if (!map.getBounds().pad(-0.1).contains(carMarker.getLatLng())) map.panTo(carMarker.getLatLng());
    }
  }

  function poll(){
    fetch(API, { cache: 'no-store', credentials: 'omit' })
      .then(function(r){ if (r.status === 404 || r.status === 410) { ended(); return null; } return r.json(); })
      .then(function(j){ if (j && j.data) { if (j.data.expired) ended(); else render(j.data); } })
      .catch(function(){ $('updated').textContent = 'Reconnecting…'; });
  }
  poll();
  timer = setInterval(poll, 8000);
})();
</script>
</body>
</html>`;
