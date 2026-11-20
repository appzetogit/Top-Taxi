# Creating a booking for a customer — Flutter implementation guide (ADMIN / support app)

This is the **admin side**: support staff create a booking *for* a customer. The web admin already does this (Admin Bookings → Create booking); this guide is for building the same screens in a Flutter admin app.

> The **customer app** side (seeing the booking, Confirm / Cancel) is a separate guide: `docs/admin-booking-flutter.md`. Do not mix them up.

- API base: `https://gogo.org.in/api/v1`. Every admin call below is under `/taxi/admin/...`.
- Success: `{ "success": true, "data": ... }`. Errors: non-2xx with the reason in `message`. **Show `message` to the admin as is** — the server's wording is already plain.
- Auth: `Authorization: Bearer <admin accessToken>`. Login: `POST /food/auth/admin/login` with `{ "email", "password" }` → `data.accessToken`.
- Types you can create: `daily_cab`, `outstation`, `airport`, `parcel`, `rental`, `tour`. (Pooling and Bus are not made this way.)

---

## How it works (read first)

1. The admin fills the form and saves. The booking is created as **awaiting confirmation**. It is **not instant**: the time must be **at least 5 minutes ahead** (`400` with a message otherwise).
2. The admin **calls / WhatsApps the customer**, then taps **Confirm** (customer agreed) or **Cancel** (reason required). The customer can also confirm or cancel in their own app. Whoever acts first settles it; the second gets `409`.
3. Confirm and cancel work only until the booking starts. Use the row's `canConfirm` / `canCancel` flags — don't work it out in the app.
4. The customer is notified in their app (push) if registered. If their number is **not registered**, the booking is saved against the phone number and appears when they register. Rides for an unregistered customer **cannot be given a driver** yet (the API says so).
5. **The app never calculates a price.** Fares, rental price and advance all come from the server. Show what it returns.

---

## 1. Create — one endpoint for every type

`POST /taxi/admin/admin-bookings`

Common fields (all types):

```json
{
  "type": "daily_cab",
  "customer": { "name": "Ravi Kumar", "phone": "9876543210" },
  "notes": "Optional text, shown to the customer"
}
```

- `customer.name`: 2+ characters. `customer.phone`: 10-digit Indian mobile (the server strips +91/0).
- Time: rides use top-level `scheduledAt` (ISO-8601 UTC string, e.g. `"2026-11-21T09:30:00.000Z"`); rental uses `pickupDateTime`/`returnDateTime`; tour uses the chosen departure.

**Response `data`** is one booking row (same shape as the list, section 2). Show "Booking `<code>` created. Call the customer, then confirm or cancel it."

### 1a. Ride types: `daily_cab`, `outstation`, `airport`, `parcel`

```json
{
  "type": "daily_cab",
  "customer": { "name": "Ravi Kumar", "phone": "9876543210" },
  "scheduledAt": "2026-11-21T09:30:00.000Z",
  "notes": "",
  "ride": {
    "vehicleTypeId": "<id from the quote>",
    "pickup": { "address": "Koramangala, Bengaluru", "lat": 12.9352, "lng": 77.6245 },
    "drop":   { "address": "Indiranagar, Bengaluru", "lat": 12.9784, "lng": 77.6408 },
    "paymentMethod": "cash",
    "passengers": 1
  }
}
```

Extra per type:

| Type | Add to `ride` |
|---|---|
| `outstation` | `fromCity`, `toCity`, `tripType` (`"one-way"` or `"round-trip"`), `passengers` |
| `airport` | `airportId`, `airportDirection` (`"pickup"` = from airport, `"drop"` = to airport). Only the **non-airport** end is a `pickup`/`drop` place; the airport end is taken from the airport itself |
| `parcel` | top-level `parcel` object (below) |

`parcel` (type `parcel` only):

```json
{ "category": "Documents", "goodsTypeId": "<id>", "weightSlotId": "<id>", "deliveryScope": "city",
  "description": "", "senderName": "...", "senderMobile": "10 digits",
  "receiverName": "...", "receiverMobile": "10 digits" }
```
`deliveryScope`: `"city"` or `"outstation"`. `category` = the chosen goods type's name. Names 2+ chars, mobiles exactly 10 digits.

`paymentMethod`: `"cash"` (paid to the driver) or `"online"`.

**Always quote first (section 3)** and send the `vehicleTypeId` the admin picked. The server prices the trip itself; a vehicle with no price for that trip is rejected (`400`).

### 1b. Rental

```json
{
  "type": "rental",
  "customer": { "name": "...", "phone": "..." },
  "rental": {
    "vehicleTypeId": "<rental vehicle id>",
    "packageId": "<package id from that vehicle>",
    "pickupDateTime": "2026-11-21T09:30:00.000Z",
    "returnDateTime": "2026-11-21T17:30:00.000Z",
    "serviceLocation": { "id": "<hub id>", "name": "...", "address": "...", "city": "...", "latitude": 0, "longitude": 0 },
    "advance": { "received": true, "mode": "cash", "reference": "optional" }
  }
}
```

- `returnDateTime` must be after `pickupDateTime`; pickup at least 5 min ahead.
- `serviceLocation` = the pickup hub, copied from `GET /taxi/admin/service-locations` (send `id`, name, address, city, latitude, longitude as that list gives them).
- Price and **advance amount are computed by the server** from the vehicle's package/advance setting. `advance` only records that the admin **already collected** it by hand. Omit `advance` if not collected yet. `mode`: `cash | upi | bank_transfer | card | other`.
- Show the computed total/advance from the response (`amount`, `payment`). Optionally show an estimate before submit using the package's price and the hours between pickup and return, but the server's figure is final.

### 1c. Tour

```json
{
  "type": "tour",
  "customer": { "name": "...", "phone": "..." },
  "tour": {
    "packageId": "<tour package id>",
    "departureId": "<departure id>",
    "personCount": 2,
    "initialPayment": { "amount": 5000, "mode": "cash" }
  }
}
```

- `personCount` ≥ 1 and ≤ the departure's seats left. Seats are **held immediately**; cancelling the booking releases them.
- `initialPayment` is optional: money the admin already collected by hand (`mode`: `cash | upi | bank_transfer | card | other`). Omit if none.
- Total = price per person × persons (from the package). Show `pricePerPerson × personCount` as a preview only.

---

## 2. Lists the form needs (all GET, admin token)

| For | Call | Use |
|---|---|---|
| Airports | `/taxi/admin/airports` | airport dropdown (`_id`/`id` → `airportId`) |
| Goods types | `/taxi/admin/goods-types` | parcel "what is being sent"; each has a `weight_slots` array → pick one as `weightSlotId` |
| Rental vehicles + packages | `/taxi/admin/types/rental-vehicles` | vehicle dropdown, then its packages |
| Pickup hubs | `/taxi/admin/service-locations` | rental `serviceLocation` |
| Tour packages + departures | `/taxi/admin/types/tour-packages` | package dropdown, then upcoming departures (with seats left) |

Ride vehicles are **not** in a list — they come from the quote (section 3).

---

## 3. Quote (rides only) — get the fares, then pick a vehicle

`POST /taxi/admin/admin-bookings/quote`

```json
{ "type": "daily_cab",
  "ride": { "pickup": {"address":"..","lat":0,"lng":0}, "drop": {"address":"..","lat":0,"lng":0},
            "airportId": "", "airportDirection": "pickup",
            "weightSlotId": "", "goodsTypeId": "" } }
```
(For `airport` send `airportId` + `airportDirection` and only the non-airport place. For `parcel` send `weightSlotId` + `goodsTypeId`.)

`data`:

```json
{ "zone": { "id": "...", "name": "Bengaluru" },
  "pickup": {...}, "drop": {...},
  "vehicles": [ { "vehicleTypeId": "...", "name": "Sedan", "image": "...", "capacity": 4,
                  "available": true, "fare": 118, "distanceKm": 6.2, "durationMinutes": 22 } ] }
```
Show each vehicle with its `fare` (the figure the admin tells the customer). Disable vehicles with `available: false` or `fare: null`. If `zone` is null the pickup is outside every service area — show the server's message / an empty state. Re-quote whenever pickup, drop, airport or parcel weight changes, and clear the chosen vehicle.

---

## 4. Place search (pickup / drop)

Do **not** use a Google Places SDK in the app; search goes through our server:

1. `GET /taxi/admin/admin-bookings/places?q=koramangala` (type-ahead, debounce ~300 ms, min 2 chars) → `data.results: [{ placeId, label, main, secondary }]` (max 6).
2. On pick: `GET /taxi/admin/admin-bookings/places/<placeId>` → `data: { address, lat, lng }`.
3. Use that `{ address, lat, lng }` as `pickup` / `drop`. A place with no coordinates is rejected ("Choose the pickup location from the search results") — never send hand-typed addresses without lat/lng.

---

## 5. List and act on bookings

`GET /taxi/admin/admin-bookings?confirmation=awaiting|confirmed|cancelled&type=&search=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10`
(omit `confirmation` for all). `data`: `{ results: [...], counts: { awaiting, confirmed, cancelled, all }, paginator: { current_page, last_page, total, per_page } }`.
Refresh about every 20 s while the screen is open.

Row fields: `key, kind (ride|rental|tour), id, code, bookingType, bookingTypeLabel, customer{name,phone,registered}, confirmation, displayStatus, canConfirm, canCancel, canAssignDriver, driverBlockedReason, cancelReason, cancelledBy, notes, createdAt, createdByName, when, title, subtitle (rides: "pickup → drop"), detail, amount, payment{method,status,due}, driver, preAssignedDriver, activationNote, sections[]`.

`sections` = `[{ title, rows: [[label, value], ...] }]` — render the **full details** screen straight from this (Trip, Parcel, Fare and payment, Driver incl. trip OTP, Rental, Tour, Booking history). No need to hard-code fields.

Actions (use `kind` and `id` from the row):

| Action | Call |
|---|---|
| Confirm | `POST /taxi/admin/admin-bookings/{kind}/{id}/confirm` (ask "Has the customer agreed?" first) |
| Cancel | `POST /taxi/admin/admin-bookings/{kind}/{id}/cancel` body `{ "reason": "..." }` (reason 3+ chars, customer sees it) |
| Drivers of the pickup zone (rides) | `GET /taxi/admin/admin-bookings/ride/{id}/drivers?search=` |
| Assign driver | `POST /taxi/admin/admin-bookings/ride/{id}/assign-driver` body `{ "driverId": "..." }` |
| Remove driver | `POST /taxi/admin/admin-bookings/ride/{id}/unassign-driver` |

Driver notes: before confirmation a picked driver is only stored (`preAssignedDriver`); they are assigned and notified at confirmation. After confirmation, assigning is immediate. If `driverBlockedReason` is set (customer not registered) show it instead of the assign button.

**Call / WhatsApp the customer** (use `customer.phone`, last 10 digits):
- Call: `tel:+91<phone>`
- WhatsApp: `https://wa.me/91<phone>?text=<url-encoded message>` — suggested text: *"Hello {name}, this is Gogo support. We have booked a {type label} for you on {date time}. Please reply YES to confirm it or NO to cancel it."* Open with `url_launcher` (`LaunchMode.externalApplication`).

---

## 6. Errors you will meet (show `message` as is)

| Status | Meaning |
|---|---|
| 400 | Missing/invalid field, time less than 5 min ahead, place without coordinates, vehicle has no price for this trip |
| 401/403 | Admin not logged in / no permission (admin-bookings access) |
| 404 | Vehicle, package, airport or booking not found |
| 409 | Already confirmed/cancelled/started; not enough tour seats; customer not registered (driver assign) |

---

## 7. Test checklist

- [ ] Daily cab: search both places, get fares, pick vehicle, create → appears under **Awaiting**.
- [ ] Time < 5 min ahead is refused with the server's message.
- [ ] Airport both directions; outstation round trip; parcel with sender/receiver validation.
- [ ] Rental: price and advance shown from the response; "advance collected" recorded.
- [ ] Tour: seats-left respected; booking more than left refused; cancelling releases seats.
- [ ] Unregistered phone: booking created; driver assign shows the "not registered" message.
- [ ] Confirm and Cancel (with reason); both hidden once `canConfirm`/`canCancel` is false.
- [ ] Call and WhatsApp open the dialer / WhatsApp with the right number.
- [ ] Customer app (other guide) shows the booking and the admin sees the customer's confirm/cancel after refresh.
