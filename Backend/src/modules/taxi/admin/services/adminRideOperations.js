/*
 * The admin Trips, Deliveries and Ongoing pages.
 *
 * All three list rides, so they share one query builder. Before this, each page
 * loaded every ride into memory, filtered it in JavaScript and sliced one page
 * out of it -- the pages never asked for page 2, so anything past the first
 * `limit` rides could not be reached at all. Here the filter, the counts and the
 * paging run in MongoDB.
 *
 * kind:
 *   trips       - passenger rides (parcel and intercity have their own lists)
 *   deliveries  - parcel jobs
 *   ongoing     - rides that are not finished yet, of any service type
 */
import mongoose from 'mongoose';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { UserWallet } from '../../user/models/UserWallet.js';
import { Delivery } from '../../user/models/Delivery.js';
import { Driver } from '../../driver/models/Driver.js';
import { ApiError } from '../../../../utils/ApiError.js';

const CODE_PREFIX = { ride: 'REQ', parcel: 'DEL', intercity: 'INT' };
const SERVICE_LABEL = { ride: 'Ride', parcel: 'Parcel delivery', intercity: 'Intercity' };
const ACTIVE_STATUSES = ['searching', 'accepted', 'ongoing'];

// Tab -> the Mongo condition on `status`. "On Trip" is a driver on the way or a trip under way.
const TAB_STATUS = {
  completed: { status: 'completed' },
  cancelled: { status: 'cancelled' },
  upcoming: { status: 'searching' },
  accepted: { status: 'accepted' },
  ongoing: { status: 'ongoing' },
  on_trip: { status: { $in: ['accepted', 'ongoing'] } },
};
const TABS_BY_KIND = {
  trips: ['all', 'completed', 'cancelled', 'upcoming', 'on_trip'],
  deliveries: ['all', 'completed', 'cancelled', 'upcoming', 'on_trip'],
  ongoing: ['all', 'accepted', 'upcoming', 'ongoing'],
};

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => Math.round(num(value) * 100) / 100;
const text = (value) => String(value ?? '').trim();
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const rideRequestCode = (ride) =>
  `${CODE_PREFIX[ride.serviceType] || 'REQ'}_${String(ride._id).slice(-12).toUpperCase()}`;

const normalizeTab = (value) => {
  const tab = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  return tab === 'on_trip' || tab === 'ontrip' ? 'on_trip' : tab || 'all';
};

// A bare YYYY-MM-DD is a calendar day in India, where the apps and the admins are.
const parseDay = (value, endOfDay) => {
  const raw = text(value);
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const point = (geo) => {
  const [lng, lat] = Array.isArray(geo?.coordinates) ? geo.coordinates.map(Number) : [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
};

const place = (address, geo, fallback) => {
  const p = point(geo);
  return {
    address: text(address) || (p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : fallback),
    ...(p || {}),
  };
};

/** One status the admin can read, from the ride's two status fields. */
const describeStatus = (ride) => {
  const status = text(ride.status).toLowerCase();
  const live = text(ride.liveStatus).toLowerCase();
  if (status === 'completed') return { tripStatus: 'COMPLETED', statusLabel: 'Completed' };
  if (status === 'cancelled') return { tripStatus: 'CANCELLED', statusLabel: 'Cancelled' };
  if (status === 'ongoing' || live === 'started') return { tripStatus: 'ONGOING', statusLabel: 'Trip started' };
  if (status === 'accepted') {
    return live === 'arrived'
      ? { tripStatus: 'ACCEPTED', statusLabel: 'Driver at pickup' }
      : { tripStatus: 'ACCEPTED', statusLabel: 'Driver on the way' };
  }
  const scheduled = ride.scheduledAt && new Date(ride.scheduledAt).getTime() > Date.now();
  return { tripStatus: 'UPCOMING', statusLabel: scheduled ? 'Scheduled' : 'Searching for driver' };
};

const describePayment = (ride) => {
  const method = text(ride.paymentMethod).toLowerCase() === 'online' ? 'ONLINE' : 'CASH';
  const collected = text(ride.driverPaymentCollection?.status).toUpperCase();
  let status = collected;
  if (!status && method === 'CASH') status = text(ride.status).toLowerCase() === 'completed' ? 'COLLECTED' : 'PENDING';
  return { paymentOption: method, paymentStatus: status };
};

const userSummary = (user) =>
  user
    ? {
        id: String(user._id),
        name: text(user.name),
        phone: text(user.phone),
        email: text(user.email),
        profileImage: text(user.profileImage),
      }
    : null;

const driverSummary = (driver) =>
  driver
    ? {
        id: String(driver._id),
        name: text(driver.name),
        phone: text(driver.phone),
        email: text(driver.email),
        profileImage: text(driver.profileImage),
        vehicleType: text(driver.vehicleType),
        vehicleNumber: text(driver.vehicleNumber),
        vehicleColor: text(driver.vehicleColor),
        vehicleMake: text(driver.vehicleMake),
        vehicleModel: text(driver.vehicleModel),
        rating: num(driver.rating),
      }
    : null;

export const toRideRow = (ride) => {
  const parcel = { ...(ride.deliveryId?.parcel || {}), ...(ride.parcel || {}) };
  const user = userSummary(ride.userId);
  const driver = driverSummary(ride.driverId);
  const { tripStatus, statusLabel } = describeStatus(ride);
  const serviceType = ride.serviceType || 'ride';
  const pickup = place(ride.pickupAddress, ride.pickupLocation, 'Pickup');
  const drop = place(ride.dropAddress, ride.dropLocation, 'Drop');
  const intercity = ride.intercity || {};

  return {
    id: String(ride._id),
    requestId: rideRequestCode(ride),
    serviceType,
    serviceLabel: SERVICE_LABEL[serviceType] || 'Ride',
    date: ride.createdAt,
    scheduledAt: ride.scheduledAt || null,
    userName: user?.name || text(parcel.senderName) || 'Unknown User',
    driverName: driver?.name || 'Unassigned',
    user,
    driver,
    transportType:
      text(intercity.vehicleName) || driver?.vehicleType || text(ride.vehicleIconType) || SERVICE_LABEL[serviceType] || 'Taxi',
    tripStatus,
    statusLabel,
    rideStatus: ride.status,
    liveStatus: ride.liveStatus,
    ...describePayment(ride),
    fare: money(ride.fare),
    baseFare: money(ride.baseFare || ride.fare),
    waitingChargeAmount: money(ride.waitingChargeAmount),
    distanceChargeAmount: money(ride.distanceChargeAmount),
    timeChargeAmount: money(ride.timeChargeAmount),
    pickup,
    drop,
    pickupLabel: pickup.address,
    dropLabel: drop.address,
    pickupLocation: ride.pickupLocation,
    dropLocation: ride.dropLocation,
    distanceKm: money(num(ride.estimatedDistanceMeters) / 1000),
    durationMinutes: Math.round(num(ride.estimatedDurationMinutes)),
    acceptedAt: ride.acceptedAt || null,
    startedAt: ride.startedAt || null,
    completedAt: ride.completedAt || null,
    routeLabel: [text(intercity.fromCity), text(intercity.toCity)].filter(Boolean).join(' -> '),
    parcel: {
      category: text(parcel.category),
      weight: text(parcel.weightSlotLabel) || text(parcel.weight),
      senderName: text(parcel.senderName),
      senderMobile: text(parcel.senderMobile),
      receiverName: text(parcel.receiverName),
      receiverMobile: text(parcel.receiverMobile),
    },
    lastDriverLocation: ride.lastDriverLocation || null,
    cancelled_by: ride.cancelled_by || '',
    cancellation_reason: ride.cancellation_reason || '',
    cancellation_charge: money(ride.cancellation_charge),
    cancellation_status: ride.cancellation_status || 'none',
    pending_cancellation_due: money(ride.pending_cancellation_due),
    recovery_status: ride.recovery_status || 'none',
    recovered_in_ride: ride.recovered_in_ride ? String(ride.recovered_in_ride) : null,
    recovered_at: ride.recovered_at || null,
    cancellation_time: ride.cancellation_time || null,
    recovered_cancellation_due: money(ride.recovered_cancellation_due),
  };
};

const USER_SELECT = 'name phone email profileImage';
const DRIVER_SELECT = 'name phone email profileImage vehicleType vehicleNumber vehicleColor vehicleMake vehicleModel rating';

/** People matching a search term, as ids, so rides can be found by who rode or drove them. */
const peopleMatching = async (regex) => {
  const [users, drivers] = await Promise.all([
    User.find({ $or: [{ name: regex }, { phone: regex }, { email: regex }] }).select('_id').limit(300).lean(),
    Driver.find({ $or: [{ name: regex }, { phone: regex }, { vehicleNumber: regex }] }).select('_id').limit(300).lean(),
  ]);
  return { userIds: users.map((u) => u._id), driverIds: drivers.map((d) => d._id) };
};

const buildSearchCondition = async (term) => {
  const search = text(term);
  if (!search) return null;
  const regex = new RegExp(escapeRegex(search), 'i');
  const { userIds, driverIds } = await peopleMatching(regex);
  const conditions = [
    { pickupAddress: regex },
    { dropAddress: regex },
    { 'parcel.senderName': regex },
    { 'parcel.senderMobile': regex },
    { 'parcel.receiverName': regex },
    { 'parcel.receiverMobile': regex },
    { 'intercity.fromCity': regex },
    { 'intercity.toCity': regex },
  ];
  if (userIds.length) conditions.push({ userId: { $in: userIds } });
  if (driverIds.length) conditions.push({ driverId: { $in: driverIds } });

  // The request id shown on screen is REQ_/DEL_/INT_ + the last 12 hex digits of the ride id.
  const code = search.replace(/^(REQ|DEL|INT)_/i, '');
  if (/^[0-9a-f]{3,24}$/i.test(code)) {
    conditions.push({
      $expr: {
        $regexMatch: {
          input: { $substrCP: [{ $toString: '$_id' }, 12, 12] },
          regex: code.toLowerCase(),
        },
      },
    });
  }
  return { $or: conditions };
};

const baseConditionFor = (kind) => {
  if (kind === 'deliveries') return { serviceType: 'parcel' };
  if (kind === 'ongoing') return { status: { $in: ACTIVE_STATUSES } };
  return { serviceType: { $nin: ['parcel', 'intercity'] }, adminHiddenAt: null };
};

/** Everything except the tab, so the tab badges can count against the same filters. */
const buildFilterConditions = async (kind, query) => {
  const conditions = [baseConditionFor(kind)];

  const payment = text(query.payment).toLowerCase();
  if (payment === 'cash' || payment === 'online') conditions.push({ paymentMethod: payment });

  const serviceType = text(query.serviceType).toLowerCase();
  if (kind === 'ongoing' && CODE_PREFIX[serviceType]) conditions.push({ serviceType });

  const status = text(query.status).toLowerCase();
  if (TAB_STATUS[status]) conditions.push(TAB_STATUS[status]);

  const from = parseDay(query.from, false);
  const to = parseDay(query.to, true);
  if (from || to) {
    conditions.push({ createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
  }

  if (text(query.vehicle)) {
    conditions.push({ vehicleIconType: new RegExp(`^${escapeRegex(text(query.vehicle))}$`, 'i') });
  }

  const search = await buildSearchCondition(query.search);
  if (search) conditions.push(search);

  return conditions;
};

export const listAdminRides = async (kind, query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 10));
  const tabs = TABS_BY_KIND[kind] || TABS_BY_KIND.trips;
  const requestedTab = normalizeTab(query.tab);
  const tab = tabs.includes(requestedTab) ? requestedTab : 'all';

  const filters = await buildFilterConditions(kind, query);
  const scoped = (extra) => ({ $and: extra ? [...filters, extra] : filters });

  const [rides, total, ...tabCounts] = await Promise.all([
    Ride.find(scoped(TAB_STATUS[tab]))
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('deliveryId', 'parcel')
      .populate('userId', USER_SELECT)
      .populate('driverId', DRIVER_SELECT)
      .lean(),
    Ride.countDocuments(scoped(TAB_STATUS[tab])),
    ...tabs.map((key) => Ride.countDocuments(scoped(TAB_STATUS[key]))),
  ]);

  return {
    results: rides.map(toRideRow),
    paginator: {
      current_page: page,
      per_page: limit,
      total,
      last_page: Math.max(1, Math.ceil(total / limit)),
    },
    counts: Object.fromEntries(tabs.map((key, index) => [key, tabCounts[index]])),
    tab,
  };
};

/* ---------------------------------------------------------------- details */

const timelineOf = (ride) =>
  [
    { key: 'created', label: 'Booking created', at: ride.createdAt },
    ride.scheduledAt && { key: 'scheduled', label: 'Scheduled pickup time', at: ride.scheduledAt },
    { key: 'accepted', label: 'Driver accepted', at: ride.acceptedAt },
    { key: 'arrived', label: 'Driver reached pickup', at: ride.arrivedAt },
    { key: 'started', label: 'Trip started', at: ride.startedAt },
    { key: 'destination', label: 'Reached destination', at: ride.destinationArrivedAt },
    { key: 'completed', label: 'Trip completed', at: ride.completedAt },
    text(ride.status).toLowerCase() === 'cancelled' && {
      key: 'cancelled',
      label: `Cancelled${ride.cancelled_by ? ` by ${ride.cancelled_by}` : ''}`,
      at: ride.cancellation_time || ride.updatedAt,
    },
  ]
    .filter((entry) => entry && entry.at)
    .map((entry) => ({ ...entry, at: new Date(entry.at) }))
    .sort((a, b) => a.at - b.at);

const fareLines = (ride) => {
  const snapshot = ride.pricingSnapshot || {};
  const lines = [
    { key: 'base', label: 'Base fare', amount: num(ride.baseFare || snapshot.starting_fare) },
    { key: 'distance', label: 'Distance charge', amount: num(ride.distanceChargeAmount) },
    { key: 'time', label: 'Time charge', amount: num(ride.timeChargeAmount) },
    { key: 'waiting', label: 'Waiting charge', amount: num(ride.waitingChargeAmount) },
    { key: 'additional', label: 'Additional charge', amount: num(ride.additionalCharge) },
    { key: 'admin', label: 'Admin extra charge', amount: num(ride.adminExtraCharge) },
    { key: 'insurance', label: 'Ride insurance', amount: num(ride.insurance_fee) },
    { key: 'weight', label: 'Parcel weight charge', amount: num(ride.parcel?.weightCharge) },
    { key: 'tip', label: 'Tip to driver', amount: num(ride.feedback?.tipAmount) },
    { key: 'promo', label: `Promo ${text(ride.promo?.code)}`.trim(), amount: -num(ride.promo?.discount_amount) },
    { key: 'due', label: 'Previous cancellation due', amount: num(ride.recovered_cancellation_due) },
  ];
  return lines
    .filter((line) => line.amount !== 0)
    .map((line) => ({ ...line, amount: money(line.amount) }));
};

export const getAdminRideDetails = async (rideId) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }

  const ride = await Ride.findById(rideId)
    .populate('deliveryId')
    .populate('userId', `${USER_SELECT} gender createdAt`)
    .populate('driverId', `${DRIVER_SELECT} gender city isOnline createdAt wallet`)
    .lean();

  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  const row = toRideRow(ride);
  const userId = ride.userId?._id;
  const driverId = ride.driverId?._id;

  const [userWallet, userRides, userCompleted, userCancelled, driverCompleted, driverCancelled] = await Promise.all([
    userId ? UserWallet.findOne({ userId }).select('balance').lean() : null,
    userId ? Ride.countDocuments({ userId }) : 0,
    userId ? Ride.countDocuments({ userId, status: 'completed' }) : 0,
    userId ? Ride.countDocuments({ userId, status: 'cancelled' }) : 0,
    driverId ? Ride.countDocuments({ driverId, status: 'completed' }) : 0,
    driverId ? Ride.countDocuments({ driverId, status: 'cancelled' }) : 0,
  ]);

  const collection = ride.driverPaymentCollection || {};
  const snapshot = ride.pricingSnapshot || {};
  const parcel = { ...(ride.deliveryId?.parcel || {}), ...(ride.parcel || {}) };
  const lines = fareLines(ride);

  return {
    ...row,
    user: ride.userId
      ? {
          ...row.user,
          gender: text(ride.userId.gender),
          joinedAt: ride.userId.createdAt || null,
          walletBalance: money(userWallet?.balance),
          totalRides: userRides,
          completedRides: userCompleted,
          cancelledRides: userCancelled,
        }
      : null,
    driver: ride.driverId
      ? {
          ...row.driver,
          gender: text(ride.driverId.gender),
          city: text(ride.driverId.city),
          isOnline: Boolean(ride.driverId.isOnline),
          joinedAt: ride.driverId.createdAt || null,
          walletBalance: money(ride.driverId.wallet?.balance),
          completedTrips: driverCompleted,
          cancelledTrips: driverCancelled,
        }
      : null,
    timeline: timelineOf(ride),
    fareBreakdown: {
      lines,
      fare: money(ride.fare),
      total: money(num(ride.fare) + num(ride.recovered_cancellation_due)),
      surgePercent: num(snapshot.surge_percent),
      surgeName: text(snapshot.surge_zone_name || snapshot.surge_slot_name),
      promoCode: text(ride.promo?.code),
      fareBeforeDiscount: money(ride.promo?.fare_before_discount),
    },
    payment: {
      method: row.paymentOption,
      status: row.paymentStatus,
      provider: text(collection.provider),
      providerPaymentId: text(collection.providerPaymentId),
      amount: money(collection.amount),
      paidAt: collection.paidAt || null,
      subscriptionUsed: Boolean(ride.subscriptionUsage && Object.keys(ride.subscriptionUsage).length),
    },
    earnings: {
      commission: money(ride.commissionAmount),
      driverEarnings: money(ride.driverEarnings),
      incentive: money(ride.driverIncentiveAmount),
      creditedAt: ride.driverEarningsCreditedAt || null,
    },
    feedback: ride.feedback?.rating != null || text(ride.feedback?.comment)
      ? {
          rating: ride.feedback.rating,
          comment: text(ride.feedback.comment),
          tipAmount: money(ride.feedback.tipAmount),
          submittedAt: ride.feedback.submittedAt || null,
        }
      : null,
    parcelDetails: row.serviceType === 'parcel'
      ? {
          ...row.parcel,
          description: text(parcel.description),
          deliveryCategory: text(parcel.deliveryCategory),
          deliveryScope: text(parcel.deliveryScope),
          photos: [...(parcel.photos || []), ...(parcel.pickupPhotos || [])].filter(Boolean),
          deliveryPhotos: (parcel.deliveryPhotos || []).filter(Boolean),
        }
      : null,
    intercityDetails: row.serviceType === 'intercity'
      ? {
          from: text(ride.intercity?.fromCity),
          to: text(ride.intercity?.toCity),
          tripType: text(ride.intercity?.tripType),
          travelDate: ride.intercity?.travelDate || null,
          passengers: num(ride.intercity?.passengers),
          distance: num(ride.intercity?.distance),
        }
      : null,
    extras: {
      bookingMode: text(ride.bookingMode),
      isPoolRide: Boolean(ride.isPoolRide),
      poolSeats: num(ride.poolSeats),
      userMaxBidFare: money(ride.userMaxBidFare),
      biddingStatus: text(ride.biddingStatus),
      messageCount: Array.isArray(ride.messages) ? ride.messages.length : 0,
    },
  };
};
