import React, { useEffect, useMemo, useState } from 'react';
import { Bike, Car, CheckCircle2, Loader2, MapPinned, Package, Plane, Route, Ticket, X } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { describeApiError } from '../../../../shared/utils/apiError';
import { adminInputClass, adminLabelClass } from '../../components/ui/adminUi.js';
import PlaceField from './PlaceField.jsx';

/*
 * Make a booking for a customer. Six kinds, one form:
 * what to book -> who for -> when -> the details of that kind -> save.
 *
 * Nothing here works out a price. A cab, outstation, airport or parcel trip is
 * quoted by the server (the same fare the customer's app would show), and a
 * rental or tour is priced from its package when it is saved; the figures on
 * screen are a preview of that.
 */

const TYPES = [
  { value: 'daily_cab', label: 'Daily Cab', hint: 'City ride', icon: Car },
  { value: 'outstation', label: 'Outstation', hint: 'City to city', icon: Route },
  { value: 'airport', label: 'Airport Taxi', hint: 'Pick up or drop', icon: Plane },
  { value: 'parcel', label: 'Parcel Delivery', hint: 'Courier', icon: Package },
  { value: 'rental', label: 'Rental', hint: 'Hourly package', icon: Bike },
  { value: 'tour', label: 'Tour', hint: 'Package departure', icon: Ticket },
];
const RIDE_TYPES = ['daily_cab', 'outstation', 'airport', 'parcel'];
const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const inMinutes = (minutes) => toLocalInput(new Date(Date.now() + minutes * 60000));

const toList = (response) =>
  [response?.data?.results, response?.data?.data?.results, response?.data?.data, response?.data, response?.results, response].find(Array.isArray) || [];
const idOf = (item) => String(item?.id || item?._id || '');

const Field = ({ label, error, hint, children }) => (
  <div>
    <label className={adminLabelClass}>{label}</label>
    {children}
    {hint ? <p className="mt-1 text-[11px] font-medium text-gray-400">{hint}</p> : null}
    {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
  </div>
);

const Section = ({ title, children }) => (
  <section className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
    <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">{title}</h3>
    {children}
  </section>
);

const EMPTY_PLACE = { address: '', lat: null, lng: null };
const hasPoint = (place) => Number.isFinite(place?.lat) && Number.isFinite(place?.lng);

/* ------------------------------------------------------------- ride kinds */

const RideSection = ({ type, ride, setRide, parcel, setParcel, airports, goodsTypes, quote, setQuote, errors }) => {
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const update = (patch) => {
    setRide((current) => ({ ...current, ...patch }));
    setQuote(null);
    setQuoteError('');
  };
  const selectedGoods = goodsTypes.find((item) => idOf(item) === parcel.goodsTypeId) || null;
  const slots = selectedGoods?.weight_slots || [];

  const tripReady =
    type === 'airport'
      ? Boolean(ride.airportId) && hasPoint(ride.airportDirection === 'drop' ? ride.pickup : ride.drop)
      : hasPoint(ride.pickup) && hasPoint(ride.drop);

  const getFares = async () => {
    setQuoting(true);
    setQuoteError('');
    try {
      const response = await adminService.quoteAdminBooking({
        type,
        ride: {
          pickup: ride.pickup,
          drop: ride.drop,
          airportId: ride.airportId,
          airportDirection: ride.airportDirection,
          weightSlotId: parcel.weightSlotId,
          goodsTypeId: parcel.goodsTypeId,
        },
      });
      setQuote(response?.data || null);
    } catch (error) {
      setQuote(null);
      setQuoteError(describeApiError(error, 'Could not get the fares for this trip.'));
    } finally {
      setQuoting(false);
    }
  };

  return (
    <>
      <Section title="Trip">
        {type === 'airport' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Airport" error={errors.airport}>
                <select value={ride.airportId} onChange={(e) => update({ airportId: e.target.value })} className={adminInputClass}>
                  <option value="">Choose the airport</option>
                  {airports.map((airport) => (
                    <option key={idOf(airport)} value={idOf(airport)}>{airport.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Direction">
                <select value={ride.airportDirection} onChange={(e) => update({ airportDirection: e.target.value })} className={adminInputClass}>
                  <option value="pickup">Pick up from the airport</option>
                  <option value="drop">Drop at the airport</option>
                </select>
              </Field>
            </div>
            {ride.airportDirection === 'drop' ? (
              <PlaceField label="Pickup location" value={ride.pickup} onChange={(place) => update({ pickup: place })} />
            ) : (
              <PlaceField label="Drop location" value={ride.drop} onChange={(place) => update({ drop: place })} />
            )}
            {errors.trip ? <p className="text-xs font-medium text-rose-600">{errors.trip}</p> : null}
          </>
        ) : (
          <>
            <PlaceField label="Pickup location" value={ride.pickup} onChange={(place) => update({ pickup: place })} />
            <PlaceField label="Drop location" value={ride.drop} onChange={(place) => update({ drop: place })} />
            {errors.trip ? <p className="text-xs font-medium text-rose-600">{errors.trip}</p> : null}
          </>
        )}

        {type === 'outstation' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From city" error={errors.fromCity}>
              <input value={ride.fromCity} onChange={(e) => update({ fromCity: e.target.value })} className={adminInputClass} placeholder="Indore" />
            </Field>
            <Field label="To city" error={errors.toCity}>
              <input value={ride.toCity} onChange={(e) => update({ toCity: e.target.value })} className={adminInputClass} placeholder="Bhopal" />
            </Field>
            <Field label="Trip type">
              <select value={ride.tripType} onChange={(e) => update({ tripType: e.target.value })} className={adminInputClass}>
                <option value="one-way">One way</option>
                <option value="round-trip">Round trip</option>
              </select>
            </Field>
            <Field label="Passengers">
              <input type="number" min="1" max="60" value={ride.passengers} onChange={(e) => update({ passengers: e.target.value })} className={adminInputClass} />
            </Field>
          </div>
        ) : null}
      </Section>

      {type === 'parcel' ? (
        <Section title="Parcel">
          <div className="grid grid-cols-2 gap-3">
            <Field label="What is being sent" error={errors.category}>
              <select
                value={parcel.goodsTypeId}
                onChange={(e) => {
                  const goods = goodsTypes.find((item) => idOf(item) === e.target.value);
                  setParcel((current) => ({ ...current, goodsTypeId: e.target.value, category: goods?.goods_type_name || goods?.name || '', weightSlotId: '' }));
                  setQuote(null);
                }}
                className={adminInputClass}
              >
                <option value="">Choose a category</option>
                {goodsTypes.map((goods) => (
                  <option key={idOf(goods)} value={idOf(goods)}>{goods.goods_type_name || goods.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Weight">
              <select
                value={parcel.weightSlotId}
                onChange={(e) => {
                  setParcel((current) => ({ ...current, weightSlotId: e.target.value }));
                  setQuote(null);
                }}
                className={adminInputClass}
                disabled={!slots.length}
              >
                <option value="">{slots.length ? 'Choose the weight' : 'Not needed'}</option>
                {slots.map((slot) => (
                  <option key={slot._id || slot.id} value={slot._id || slot.id}>
                    {slot.label || `${slot.min_kg} - ${slot.max_kg} kg`}{slot.price ? ` (+${money(slot.price)})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Delivery">
              <select value={parcel.deliveryScope} onChange={(e) => setParcel((c) => ({ ...c, deliveryScope: e.target.value }))} className={adminInputClass}>
                <option value="city">Within the city</option>
                <option value="outstation">Outstation</option>
              </select>
            </Field>
            <Field label="Description">
              <input value={parcel.description} onChange={(e) => setParcel((c) => ({ ...c, description: e.target.value }))} className={adminInputClass} placeholder="Optional" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sender name" error={errors.senderName}>
              <input value={parcel.senderName} onChange={(e) => setParcel((c) => ({ ...c, senderName: e.target.value }))} className={adminInputClass} />
            </Field>
            <Field label="Sender mobile" error={errors.senderMobile}>
              <input value={parcel.senderMobile} inputMode="numeric" maxLength={10} onChange={(e) => setParcel((c) => ({ ...c, senderMobile: e.target.value.replace(/\D/g, '') }))} className={adminInputClass} />
            </Field>
            <Field label="Receiver name" error={errors.receiverName}>
              <input value={parcel.receiverName} onChange={(e) => setParcel((c) => ({ ...c, receiverName: e.target.value }))} className={adminInputClass} />
            </Field>
            <Field label="Receiver mobile" error={errors.receiverMobile}>
              <input value={parcel.receiverMobile} inputMode="numeric" maxLength={10} onChange={(e) => setParcel((c) => ({ ...c, receiverMobile: e.target.value.replace(/\D/g, '') }))} className={adminInputClass} />
            </Field>
          </div>
        </Section>
      ) : null}

      <Section title="Vehicle and fare">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-gray-500">The fare is worked out by the server, exactly as the customer's app would.</p>
          <button
            type="button"
            onClick={getFares}
            disabled={!tripReady || quoting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {quoting ? <Loader2 size={14} className="animate-spin" /> : <MapPinned size={14} />} Get fares
          </button>
        </div>
        {quoteError ? <p className="text-xs font-medium text-rose-600">{quoteError}</p> : null}
        {quote ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500">
              {quote.zone ? `Zone: ${quote.zone.name}` : 'No zone covers this pickup'}
              {quote.vehicles?.find((v) => v.available)?.distanceKm != null
                ? ` · about ${quote.vehicles.find((v) => v.available).distanceKm} km`
                : ''}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {quote.vehicles.map((vehicle) => {
                const selected = ride.vehicleTypeId === vehicle.vehicleTypeId;
                return (
                  <button
                    key={vehicle.vehicleTypeId}
                    type="button"
                    disabled={!vehicle.available}
                    onClick={() => setRide((current) => ({ ...current, vehicleTypeId: vehicle.vehicleTypeId }))}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      selected ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                    } ${vehicle.available ? '' : 'cursor-not-allowed opacity-45'}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-gray-900">{vehicle.name}</span>
                      <span className="block text-[11px] font-medium text-gray-500">
                        {vehicle.available ? `${vehicle.capacity || '-'} seats` : 'No price set for this trip'}
                      </span>
                    </span>
                    {vehicle.available ? <span className="shrink-0 text-sm font-black text-gray-900">{money(vehicle.fare)}</span> : null}
                    {selected ? <CheckCircle2 size={16} className="shrink-0 text-indigo-600" /> : null}
                  </button>
                );
              })}
              {quote.vehicles.length === 0 ? <p className="text-xs text-gray-500">No vehicles are set up for this kind of trip.</p> : null}
            </div>
          </div>
        ) : null}
        {errors.vehicle ? <p className="text-xs font-medium text-rose-600">{errors.vehicle}</p> : null}
        <Field label="Payment">
          <select value={ride.paymentMethod} onChange={(e) => setRide((c) => ({ ...c, paymentMethod: e.target.value }))} className={adminInputClass}>
            <option value="cash">Cash to the driver</option>
            <option value="online">Online</option>
          </select>
        </Field>
      </Section>
    </>
  );
};

/* ------------------------------------------------------------------ rental */

const RentalSection = ({ rental, setRental, vehicles, locations, errors }) => {
  const vehicle = vehicles.find((item) => idOf(item) === rental.vehicleTypeId) || null;
  const packages = (vehicle?.pricing || []).filter((item) => item.active !== false);
  const pkg = packages.find((item) => item.id === rental.packageId) || null;

  const preview = useMemo(() => {
    if (!pkg || !rental.pickupDateTime || !rental.returnDateTime) return null;
    const hours = (new Date(rental.returnDateTime) - new Date(rental.pickupDateTime)) / 3600000;
    if (!(hours > 0)) return null;
    const extra = Math.ceil(Math.max(0, hours - pkg.durationHours));
    const total = pkg.price + extra * (pkg.extraHourPrice || 0);
    const advance = vehicle?.advancePayment || {};
    let due = 0;
    if (advance.enabled) {
      due = advance.paymentMode === 'full' ? total : advance.paymentMode === 'fixed' ? Math.min(advance.amount, total) : (total * Math.min(advance.amount, 100)) / 100;
    }
    return { hours, extra, total, advance: Math.round(due * 100) / 100 };
  }, [pkg, vehicle, rental.pickupDateTime, rental.returnDateTime]);

  const set = (patch) => setRental((current) => ({ ...current, ...patch }));

  return (
    <>
      <Section title="Rental">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle" error={errors.vehicle}>
            <select value={rental.vehicleTypeId} onChange={(e) => set({ vehicleTypeId: e.target.value, packageId: '' })} className={adminInputClass}>
              <option value="">Choose a vehicle</option>
              {vehicles.map((item) => (
                <option key={idOf(item)} value={idOf(item)}>{item.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Package" error={errors.package}>
            <select value={rental.packageId} onChange={(e) => set({ packageId: e.target.value })} className={adminInputClass} disabled={!vehicle}>
              <option value="">Choose a package</option>
              {packages.map((item) => (
                <option key={item.id} value={item.id}>{item.label} - {money(item.price)}</option>
              ))}
            </select>
          </Field>
          <Field label="Pickup" error={errors.pickup}>
            <input type="datetime-local" min={inMinutes(5)} value={rental.pickupDateTime} onChange={(e) => set({ pickupDateTime: e.target.value })} className={adminInputClass} />
          </Field>
          <Field label="Return" error={errors.returnAt}>
            <input type="datetime-local" min={rental.pickupDateTime || inMinutes(5)} value={rental.returnDateTime} onChange={(e) => set({ returnDateTime: e.target.value })} className={adminInputClass} />
          </Field>
        </div>
        <Field label="Pickup hub" error={errors.hub}>
          <select value={rental.locationId} onChange={(e) => set({ locationId: e.target.value })} className={adminInputClass}>
            <option value="">Choose the hub</option>
            {locations.map((item) => (
              <option key={idOf(item)} value={idOf(item)}>{item.service_location_name || item.name}</option>
            ))}
          </select>
        </Field>
      </Section>
      <Section title="Price and advance">
        {preview ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">{preview.hours.toFixed(1)} h{preview.extra ? ` (${preview.extra} extra hour${preview.extra > 1 ? 's' : ''})` : ''}</span><span className="font-black text-gray-900">{money(preview.total)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Advance asked for</span><span className="font-bold text-gray-900">{preview.advance > 0 ? money(preview.advance) : 'None'}</span></div>
            <p className="text-[11px] text-gray-400">The server prices the booking from the package when you save it.</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Choose a vehicle, a package and the pickup and return times.</p>
        )}
        {preview && preview.advance > 0 ? (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={rental.advanceReceived} onChange={(e) => set({ advanceReceived: e.target.checked })} />
              Advance collected now
            </label>
            {rental.advanceReceived ? (
              <select value={rental.advanceMode} onChange={(e) => set({ advanceMode: e.target.value })} className={adminInputClass}>
                {PAYMENT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            ) : null}
            {rental.advanceReceived ? (
              <input value={rental.advanceReference} onChange={(e) => set({ advanceReference: e.target.value })} className={`${adminInputClass} col-span-2`} placeholder="Receipt / UPI reference (optional)" />
            ) : null}
          </div>
        ) : null}
      </Section>
    </>
  );
};

/* -------------------------------------------------------------------- tour */

const TourSection = ({ tour, setTour, packages, errors }) => {
  const pkg = packages.find((item) => idOf(item) === tour.packageId) || null;
  const departures = (pkg?.upcomingDates || []).filter((d) => d.active !== false && d.seatsLeft > 0);
  const departure = departures.find((d) => idOf(d) === tour.departureId) || null;
  const total = (pkg?.pricePerPerson || 0) * (Number(tour.personCount) || 0);
  const set = (patch) => setTour((current) => ({ ...current, ...patch }));

  return (
    <Section title="Tour">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Package" error={errors.package}>
          <select value={tour.packageId} onChange={(e) => set({ packageId: e.target.value, departureId: '', personCount: 1 })} className={adminInputClass}>
            <option value="">Choose a package</option>
            {packages.map((item) => (
              <option key={idOf(item)} value={idOf(item)}>{item.destination} - {money(item.pricePerPerson)}/person</option>
            ))}
          </select>
        </Field>
        <Field label="Departure" error={errors.departure}>
          <select value={tour.departureId} onChange={(e) => set({ departureId: e.target.value })} className={adminInputClass} disabled={!pkg}>
            <option value="">{pkg ? 'Choose a date' : 'Choose a package first'}</option>
            {departures.map((d) => (
              <option key={idOf(d)} value={idOf(d)}>
                {new Date(d.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ({d.seatsLeft} seats left)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Persons" error={errors.persons}>
          <input type="number" min="1" max={departure?.seatsLeft || undefined} value={tour.personCount} onChange={(e) => set({ personCount: e.target.value })} className={adminInputClass} />
        </Field>
        <Field label="Total">
          <div className="flex h-[42px] items-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-black text-gray-900">{money(total)}</div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount received now (optional)" error={errors.amount}>
          <input type="number" min="0" step="0.01" value={tour.paymentAmount} onChange={(e) => set({ paymentAmount: e.target.value })} className={adminInputClass} placeholder="0" />
        </Field>
        <Field label="Payment mode">
          <select value={tour.paymentMode} onChange={(e) => set({ paymentMode: e.target.value })} className={adminInputClass}>
            {PAYMENT_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-[11px] font-medium text-gray-400">The seats are held as soon as you save, so nobody else can take them while you confirm.</p>
    </Section>
  );
};

/* ------------------------------------------------------------------- modal */

const CreateAdminBookingModal = ({ onClose, onCreated }) => {
  const [type, setType] = useState('daily_cab');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [when, setWhen] = useState(inMinutes(15));
  const [notes, setNotes] = useState('');
  const [ride, setRide] = useState({
    pickup: EMPTY_PLACE, drop: EMPTY_PLACE, vehicleTypeId: '', paymentMethod: 'cash',
    airportId: '', airportDirection: 'pickup', fromCity: '', toCity: '', tripType: 'one-way', passengers: 1,
  });
  const [parcel, setParcel] = useState({
    category: '', goodsTypeId: '', weightSlotId: '', deliveryScope: 'city', description: '',
    senderName: '', senderMobile: '', receiverName: '', receiverMobile: '',
  });
  const [rental, setRental] = useState({
    vehicleTypeId: '', packageId: '', pickupDateTime: inMinutes(15), returnDateTime: inMinutes(15 + 8 * 60), locationId: '',
    advanceReceived: false, advanceMode: 'cash', advanceReference: '',
  });
  const [tour, setTour] = useState({ packageId: '', departureId: '', personCount: 1, paymentAmount: '', paymentMode: 'cash' });
  const [quote, setQuote] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  const [airports, setAirports] = useState([]);
  const [goodsTypes, setGoodsTypes] = useState([]);
  const [rentalVehicles, setRentalVehicles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [tourPackages, setTourPackages] = useState([]);

  useEffect(() => {
    let active = true;
    const load = async (call, setter) => {
      try {
        const response = await call();
        if (active) setter(toList(response));
      } catch {
        // The kind that needs this list simply shows it empty.
      }
    };
    load(() => adminService.getAirports(), setAirports);
    load(() => adminService.getGoodsTypes(), setGoodsTypes);
    load(() => adminService.getRentalVehicleTypes(), setRentalVehicles);
    load(() => adminService.getServiceLocations(), setLocations);
    load(() => adminService.getTourPackages(), setTourPackages);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Changing the kind starts the trip over: places and fares belong to one kind.
  const pickType = (next) => {
    setType(next);
    setQuote(null);
    setErrors({});
    setRide((current) => ({ ...current, vehicleTypeId: '', pickup: EMPTY_PLACE, drop: EMPTY_PLACE }));
  };

  const isRide = RIDE_TYPES.includes(type);

  const validate = () => {
    const next = {};
    if (customer.name.trim().length < 2) next.name = "Enter the customer's name";
    if (!/^\d{10}$/.test(customer.phone)) next.phone = 'Enter a valid 10-digit mobile number';
    const time = new Date(when).getTime();
    if (isRide && (!when || Number.isNaN(time) || time < Date.now() + 5 * 60000)) {
      next.when = 'Pick a time at least 5 minutes from now';
    }

    if (isRide) {
      if (type === 'airport') {
        if (!ride.airportId) next.airport = 'Choose the airport';
        if (!hasPoint(ride.airportDirection === 'drop' ? ride.pickup : ride.drop)) next.trip = 'Search and pick the other end of the trip';
      } else if (!hasPoint(ride.pickup) || !hasPoint(ride.drop)) {
        next.trip = 'Search and pick both the pickup and the drop';
      }
      if (type === 'outstation') {
        if (!ride.fromCity.trim()) next.fromCity = 'Enter the city';
        if (!ride.toCity.trim()) next.toCity = 'Enter the city';
      }
      if (type === 'parcel') {
        if (!parcel.category) next.category = 'Choose what is being sent';
        if (parcel.senderName.trim().length < 2) next.senderName = 'Required';
        if (parcel.receiverName.trim().length < 2) next.receiverName = 'Required';
        if (!/^\d{10}$/.test(parcel.senderMobile)) next.senderMobile = '10 digits';
        if (!/^\d{10}$/.test(parcel.receiverMobile)) next.receiverMobile = '10 digits';
      }
      if (!ride.vehicleTypeId) next.vehicle = 'Get the fares and choose a vehicle';
    }

    if (type === 'rental') {
      if (!rental.vehicleTypeId) next.vehicle = 'Choose a vehicle';
      if (!rental.packageId) next.package = 'Choose a package';
      if (!rental.pickupDateTime || new Date(rental.pickupDateTime).getTime() < Date.now() + 5 * 60000) next.pickup = 'At least 5 minutes from now';
      if (!rental.returnDateTime || new Date(rental.returnDateTime) <= new Date(rental.pickupDateTime)) next.returnAt = 'After the pickup';
      if (!rental.locationId) next.hub = 'Choose the pickup hub';
    }

    if (type === 'tour') {
      if (!tour.packageId) next.package = 'Choose a package';
      if (tour.packageId && !tour.departureId) next.departure = 'Choose a departure';
      if (!Number.isInteger(Number(tour.personCount)) || Number(tour.personCount) < 1) next.persons = 'At least 1 person';
      if (Number(tour.paymentAmount) < 0) next.amount = 'Cannot be negative';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildPayload = () => {
    const base = { type, customer: { name: customer.name.trim(), phone: customer.phone }, notes: notes.trim() };
    if (isRide) {
      return {
        ...base,
        scheduledAt: new Date(when).toISOString(),
        ride: {
          vehicleTypeId: ride.vehicleTypeId,
          pickup: ride.pickup,
          drop: ride.drop,
          paymentMethod: ride.paymentMethod,
          airportId: ride.airportId,
          airportDirection: ride.airportDirection,
          fromCity: ride.fromCity,
          toCity: ride.toCity,
          tripType: ride.tripType,
          passengers: Number(ride.passengers) || 1,
        },
        parcel: type === 'parcel' ? parcel : undefined,
      };
    }
    if (type === 'rental') {
      const location = locations.find((item) => idOf(item) === rental.locationId) || {};
      return {
        ...base,
        rental: {
          vehicleTypeId: rental.vehicleTypeId,
          packageId: rental.packageId,
          pickupDateTime: new Date(rental.pickupDateTime).toISOString(),
          returnDateTime: new Date(rental.returnDateTime).toISOString(),
          serviceLocation: {
            id: rental.locationId,
            name: location.service_location_name || location.name || '',
            address: location.address || '',
            city: location.name || location.service_location_name || '',
            latitude: location.latitude,
            longitude: location.longitude,
          },
          advance: rental.advanceReceived ? { received: true, mode: rental.advanceMode, reference: rental.advanceReference.trim() } : undefined,
        },
      };
    }
    const amount = Number(tour.paymentAmount) || 0;
    return {
      ...base,
      tour: {
        packageId: tour.packageId,
        departureId: tour.departureId,
        personCount: Number(tour.personCount),
        initialPayment: amount > 0 ? { amount, mode: tour.paymentMode } : undefined,
      },
    };
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await adminService.createAdminBooking(buildPayload());
      onCreated(response?.data || null);
    } catch (error) {
      setSubmitError(describeApiError(error, 'Could not create the booking.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={submit} className="my-4 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Create a booking for a customer</h2>
            <p className="text-xs text-gray-500">It is saved as awaiting. Ask the customer, then confirm it, or cancel it with a reason.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES.map((item) => {
            const Icon = item.icon;
            const active = item.value === type;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => pickType(item.value)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  active ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <Icon size={20} className={active ? 'text-indigo-600' : 'text-gray-400'} />
                <span>
                  <span className="block text-sm font-bold text-gray-900">{item.label}</span>
                  <span className="block text-[11px] font-medium text-gray-500">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          <Section title="Customer">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" error={errors.name}>
                <input value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} className={adminInputClass} />
              </Field>
              <Field label="Mobile number" error={errors.phone}>
                <input value={customer.phone} inputMode="numeric" maxLength={10} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value.replace(/\D/g, '') }))} className={adminInputClass} placeholder="10 digits" />
              </Field>
            </div>
            <p className="text-[11px] font-medium text-gray-400">
              If this number is registered in the app, the booking appears there and the customer is notified. If not, it appears when they register with this number.
            </p>
            {isRide ? (
              <Field label="Pickup date and time" error={errors.when}>
                <input type="datetime-local" min={inMinutes(5)} value={when} onChange={(e) => setWhen(e.target.value)} className={adminInputClass} />
              </Field>
            ) : null}
          </Section>

          {isRide ? (
            <RideSection
              type={type}
              ride={ride}
              setRide={setRide}
              parcel={parcel}
              setParcel={setParcel}
              airports={airports}
              goodsTypes={goodsTypes}
              quote={quote}
              setQuote={setQuote}
              errors={errors}
            />
          ) : null}
          {type === 'rental' ? <RentalSection rental={rental} setRental={setRental} vehicles={rentalVehicles} locations={locations} errors={errors} /> : null}
          {type === 'tour' ? <TourSection tour={tour} setTour={setTour} packages={tourPackages} errors={errors} /> : null}

          <Field label="Notes (optional)">
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={adminInputClass} placeholder="Anything the team should know" />
          </Field>
        </div>

        {submitError ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{submitError}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Create booking
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateAdminBookingModal;
