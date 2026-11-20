import crypto from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { Ride } from '../models/Ride.js';
import { RideShareLink } from '../models/RideShareLink.js';

/** A share link never outlives this, even on a very long trip. */
const SHARE_LINK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const FINISHED = new Set(['completed', 'cancelled']);
const SHAREABLE_LIVE = new Set(['accepted', 'arriving', 'arrived', 'started']);

export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAGE_LABELS = {
  accepted: 'Driver assigned, heading to pickup',
  arriving: 'Driver on the way to pickup',
  arrived: 'Driver has reached the pickup point',
  started: 'Trip in progress',
};

/**
 * Public origin the link points at. RIDE_SHARE_BASE_URL wins; otherwise the
 * first FRONTEND_URL entry (the same host that serves the web app).
 */
const shareBaseUrl = () => {
  const raw = process.env.RIDE_SHARE_BASE_URL
    || String(process.env.FRONTEND_URL || '').split(',')[0]
    || 'https://gogo.org.in';
  return raw.trim().replace(/\/+$/, '');
};

export const buildShareUrl = (token) => `${shareBaseUrl()}/track/ride/${token}`;

const isFinished = (ride) =>
  FINISHED.has(String(ride?.status || '').toLowerCase())
  || FINISHED.has(String(ride?.liveStatus || '').toLowerCase());

/** "Manju N." — enough to recognise the driver, not a full identity. */
const shortName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Your driver';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

const vehicleOf = (driver) => ({
  color: String(driver?.vehicleColor || '').trim(),
  make: String(driver?.vehicleMake || '').trim(),
  model: String(driver?.vehicleModel || '').trim(),
  number: String(driver?.vehicleNumber || '').trim().toUpperCase(),
  type: String(driver?.vehicleType || '').trim(),
});

const vehicleLine = (v) => [v.color, v.make, v.model].filter(Boolean).join(' ');

/** The text the rider sends, e.g. "Your Driver is Manju N. silver Kia Carens, Vehicle Number: KA51AJ5148. Track with link: …". */
export const buildShareMessage = ({ driver, url }) => {
  const v = vehicleOf(driver);
  const line = vehicleLine(v);
  const parts = [`Your Driver is ${shortName(driver?.name)}.`];
  if (line) parts.push(`${line}${v.number ? ',' : '.'}`);
  if (v.number) parts.push(`Vehicle Number: ${v.number}.`);
  parts.push(`Track with link: ${url}`);
  return parts.join(' ');
};

const point = (geo) => {
  const c = geo?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

/**
 * Creates (or returns the still-valid) share link for the rider's own ride.
 * Only once a driver is assigned and before the ride has ended.
 */
export const createRideShareLink = async ({ rideId, userId }) => {
  if (!rideId || !/^[0-9a-f]{24}$/i.test(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }

  const ride = await Ride.findById(rideId)
    .select('userId driverId status liveStatus')
    .populate('driverId', 'name vehicleColor vehicleMake vehicleModel vehicleNumber vehicleType')
    .lean();

  if (!ride) throw new ApiError(404, 'Ride not found');
  if (String(ride.userId) !== String(userId)) {
    throw new ApiError(403, 'You can only share your own ride');
  }
  if (isFinished(ride)) throw new ApiError(409, 'This ride has already ended');
  if (!ride.driverId || !SHAREABLE_LIVE.has(String(ride.liveStatus || '').toLowerCase())) {
    throw new ApiError(409, 'You can share the ride once a driver has been assigned');
  }

  const now = new Date();
  let link = await RideShareLink.findOne({
    rideId: ride._id,
    userId: ride.userId,
    revokedAt: null,
    expiresAt: { $gt: now },
  }).lean();

  if (!link) {
    link = await RideShareLink.create({
      token: crypto.randomUUID(),
      rideId: ride._id,
      userId: ride.userId,
      expiresAt: new Date(now.getTime() + SHARE_LINK_MAX_AGE_MS),
    });
  }

  const url = buildShareUrl(link.token);
  return {
    token: link.token,
    url,
    expiresAt: link.expiresAt,
    message: buildShareMessage({ driver: ride.driverId, url }),
  };
};

/**
 * What an anonymous viewer of the link may see. Deliberately minimal: no phone
 * numbers, OTP, fare, payment or rider identity beyond what the rider chose to
 * share by sending the link.
 *
 * Returns `{ expired: true }` once the ride has ended or the link is past its
 * lifetime, and `null` for a token that never existed.
 */
export const getSharedRideSnapshot = async (token) => {
  if (!SHARE_TOKEN_PATTERN.test(String(token || ''))) return null;

  const link = await RideShareLink.findOne({ token }).lean();
  if (!link) return null;

  const now = new Date();
  if (link.revokedAt || link.expiresAt <= now) return { expired: true };

  const ride = await Ride.findById(link.rideId)
    .select('status liveStatus serviceType pickupLocation pickupAddress dropLocation dropAddress lastDriverLocation acceptedAt arrivedAt startedAt completedAt estimatedDistanceMeters estimatedDurationMinutes driverId')
    .populate('driverId', 'name profileImage rating vehicleColor vehicleMake vehicleModel vehicleNumber vehicleType')
    .lean();

  if (!ride || isFinished(ride)) return { expired: true, endedAt: ride?.completedAt || null };

  // Best-effort view counter; never blocks the response.
  RideShareLink.updateOne({ _id: link._id }, { $set: { lastViewedAt: now }, $inc: { viewCount: 1 } }).catch(() => {});

  const driver = ride.driverId || {};
  const live = String(ride.liveStatus || ride.status || '').toLowerCase();
  const loc = point(ride.lastDriverLocation);
  const photo = String(driver.profileImage || '');

  return {
    expired: false,
    stage: live,
    stageLabel: STAGE_LABELS[live] || 'Ride in progress',
    serviceType: ride.serviceType || 'ride',
    driver: {
      name: shortName(driver.name),
      rating: Number(driver.rating || 0) || null,
      photo: /^https:\/\//i.test(photo) ? photo : null,
    },
    vehicle: vehicleOf(driver),
    pickup: { address: ride.pickupAddress || '', ...(point(ride.pickupLocation) || {}) },
    drop: { address: ride.dropAddress || '', ...(point(ride.dropLocation) || {}) },
    driverLocation: loc
      ? {
          ...loc,
          heading: Number.isFinite(Number(ride.lastDriverLocation?.heading)) ? Number(ride.lastDriverLocation.heading) : null,
          updatedAt: ride.lastDriverLocation?.updatedAt || null,
        }
      : null,
    acceptedAt: ride.acceptedAt || null,
    arrivedAt: ride.arrivedAt || null,
    startedAt: ride.startedAt || null,
    estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
    estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
    linkExpiresAt: link.expiresAt,
    serverTime: now,
  };
};
