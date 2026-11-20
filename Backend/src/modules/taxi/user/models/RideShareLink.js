import mongoose from 'mongoose';

/**
 * A public, read-only link a rider sends to family/friends so they can follow
 * the trip live (safety share).
 *
 * Kept out of the Ride document on purpose: the token is a capability that
 * grants anonymous read access, so it lives in its own small collection that
 * can be revoked or expired without touching the ride.
 *
 * The link is only ever served while the ride is in progress; once the ride is
 * completed or cancelled the public endpoint answers "expired" whatever
 * `expiresAt` says. `expiresAt` is a hard upper bound (and the TTL that
 * deletes stale rows).
 */
const rideShareLinkSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    rideId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastViewedAt: { type: Date, default: null },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Remove rows a day after they stop working; the link itself is dead long before.
rideShareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const RideShareLink =
  mongoose.models.TaxiRideShareLink || mongoose.model('TaxiRideShareLink', rideShareLinkSchema);
