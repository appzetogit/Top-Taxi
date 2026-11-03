# Rental — Flutter implementation guide (Gogo customer app, taxi module)

Vehicle rental by package ("8 Hours", "12 Hours", "24 Hours"...): the customer picks a vehicle and a package, a pickup hub, uploads KYC, pays an **advance**, and the rest is paid at pickup/return. Admin (and the service centre) assigns the vehicle and closes the booking. While the rental is running the customer app sends its live location so admin can watch it.

There are three panels. **The Flutter developer builds the customer app (section 4 to 9).** Sections 10 and 11 describe the service-centre and admin sides so the whole flow is understood; the admin panel is web only.

| Panel | Who | Where it lives |
|---|---|---|
| Customer | rider app user | Flutter app (this guide) |
| Service centre | service centre owner + its staff (hands over / receives the vehicle, inspection, biometrics) | driver app, roles `service_center` and `service_center_staff` |
| Admin | Gogo admin | web panel: Taxi → Price Management → Rental & Packages |

- API base: `https://gogo.org.in/api/v1`
- Customer rental endpoints: `/taxi/users/...` (full example: `https://gogo.org.in/api/v1/taxi/users/rental-vehicles`)
- Success: `{ "success": true, "data": ... }`, lists in `data.results`. Errors: non-2xx with the text in `message` — show it as is.
- Auth: `Authorization: Bearer <user JWT>`. Public endpoints are marked.
- Dates/times: ISO-8601 (UTC) strings. Money: rupees (plain numbers), except Razorpay's `amount` in the order response, which is **paise**.

---

## How it behaves (read first)

- **The server prices the booking. The app only shows a preview.** On `POST /rental-bookings` the server recomputes `totalCost` and `payableNow` from the vehicle's package and advance setting and **ignores** any `totalCost`, `payableNow`, `paymentStatus` the app sends. If your preview disagrees with the server, the payment check fails (402).
- **Pay first, then create the booking.** There is no "pending payment" booking. The order is: (optional quote) → pay advance (wallet or Razorpay) → `POST /rental-bookings` with proof of payment → booking exists with `status: "pending"`.
- **The server verifies the payment itself** (Razorpay signature + order amount + order belongs to this user; or the wallet debit for this booking reference). A forged or too-small payment is rejected, and one payment can buy **only one** booking.
- **Advance may be zero.** If the admin has the vehicle's advance switched off, `payableNow` is `0`; skip payment and create the booking with no payment object (`paymentStatus: "not_required"`). Today all live vehicles have the advance **off**.
- **The rest of the rent is paid offline** at pickup/return (cash/UPI at the service centre). There is no in-app balance payment for rental.
- **A booking cannot be edited or cancelled by the customer.** Re-posting the same `bookingReference` returns the saved booking unchanged (HTTP 200). There is no customer cancel endpoint; admin or the service centre cancels.
- **Live tracking** only runs while the booking is `assigned`, `confirmed` or `end_requested`.
- **Ending the ride** from the app only sends an end *request*; admin/service centre completes it and fixes the final charge.
- KYC is mandatory in the app UI: driving licence + Aadhaar photo. The server stores the image URLs; it does not block the booking if they are missing, so enforce it in the app.

---

## 1. Flow at a glance

```
Home "Rental" tile (service_type: "rental")
  → Vehicle list                 GET  /rental-vehicles
  → Vehicle detail + package     (data already in the list)
  → Pickup hub                   GET  /service-locations   (+ /service-stores)
  → Pickup / return time         (client; total preview)
  → KYC photos                   POST /common/upload/image  (x2)
  → Pay advance (if payableNow > 0)
        wallet:    POST /rental-advance/wallet
        razorpay:  POST /rental-advance/razorpay/order → Razorpay SDK → (optional) /verify
  → Create booking               POST /rental-bookings
  → Confirmation screen
My bookings                      GET  /rental-bookings
Active rental (ride screen)      GET  /rental-bookings/active
  → location updates             POST /rental-bookings/:id/location   (every 15 s / 50 m)
  → End ride                     POST /rental-bookings/:id/end
```

The home tile comes from the admin "App Modules" list; a module with `service_type: "rental"` opens the rental flow (add that case next to `normal`, `outstation`, `tours`, `delivery`).

---

## 2. Booking lifecycle

```
pending ──(admin confirms)──▶ confirmed ──(vehicle assigned)──▶ assigned
   │                                  │                           │
   └───────────── (any of these, customer taps End) ───────────────┤
                                                                   ▼
                                                            end_requested ──(admin/centre)──▶ completed
Any state ──(admin / service centre)──▶ cancelled
```

| `status` | Meaning | Customer can |
|---|---|---|
| `pending` | Saved, waiting for admin | wait |
| `confirmed` | Admin accepted | live tracking starts; **End ride** |
| `assigned` | Vehicle / staff assigned | live tracking; **End ride** |
| `end_requested` | Customer asked to end; waiting for admin to close | wait (tracking still sends) |
| `completed` | Closed; `finalCharge` and `finalElapsedMinutes` are final | view receipt |
| `cancelled` | Cancelled by admin/centre | view (`adminNote` may say why) |

`paymentStatus`: `not_required` (no advance due), `paid` (advance collected). Bookings created through this API are only ever one of these two.

---

## 3. Endpoints

### 3.1 Vehicles — public

`GET /taxi/users/rental-vehicles`

```json
{
  "success": true,
  "data": { "results": [ {
    "id": "6ae45235fec0435dfe5f1492",
    "name": "MINI BUS - -AC",
    "short_description": "21+1 Seats Local Rental",
    "vehicleCategory": "Car",
    "image": "https://gogo.org.in/uploads/...jpg",
    "coverImage": "...", "galleryImages": [],
    "capacity": 21, "luggageCapacity": 0,
    "amenities": ["AC"],
    "serviceStoreIds": [],
    "advancePayment": { "enabled": false, "paymentMode": "percentage", "amount": 20, "label": "Advance booking payment", "notes": "" },
    "pricing": [
      { "id": "pkg-8h-80k", "label": "8 Hours / 80 km", "durationHours": 8, "price": 8000,
        "includedKm": 80, "extraHourPrice": 400, "extraKmPrice": 0, "active": true }
    ]
  } ] }
}
```

- `pricing[]` are the packages. Show only `active: true`. The package `id` is what you send when booking.
- `advancePayment`: `enabled` false → nothing to pay now. Otherwise `paymentMode`:
  - `full` → advance = total
  - `percentage` → advance = `total × amount / 100` (`amount` is a percent, max 100)
  - `fixed` → advance = `min(amount, total)`

### 3.2 Pickup hub — public

`GET /taxi/users/service-locations` → `data.results[]`: `id`, `name`, `address`, `country`, `latitude`, `longitude`, `active`, `status`. These are the hubs (cities) the customer collects the vehicle from.

`GET /taxi/users/service-stores` → `data.results[]`: `id`, `name`, `address`, `latitude`, `longitude`, `service_location_id`, `owner_name`, `owner_phone`. These are the actual pickup points inside a hub (service centres). **Today this list is empty** and `serviceStoreIds` on vehicles is empty too, so just let the customer pick a service location. When stores exist and a vehicle has `serviceStoreIds`, show only the stores in that list (and the locations they belong to).

Sort hubs by distance from the customer's GPS if you have it; send the chosen one as `serviceLocation` (section 3.7).

### 3.3 Price preview (client side only)

```
hours       = (returnDateTime - pickupDateTime) in hours
extraHours  = ceil(max(0, hours - package.durationHours))
totalCost   = package.price + extraHours * package.extraHourPrice
advance     = see advancePayment modes above
balance     = totalCost - advance          // paid at pickup
```

Round to 2 decimals. Return must be after pickup. The server does the same maths with the vehicle's own data and is the one that counts.

### 3.4 Upload KYC photo — auth

`POST /taxi/common/upload/image`

```json
{ "image": "data:image/jpeg;base64,/9j/4AAQ...", "folder": "rental-kyc" }
```

Response data contains `url`. Do this once for the driving licence and once for Aadhaar, then send the URLs in the booking (3.7). Compress the image first (the JSON body has a size limit).

### 3.5 Quote request — optional

Customer wants a custom price instead of a package: `POST /taxi/users/rental-quote-requests` (works logged in or out).

```json
{
  "vehicleTypeId": "6ae4...", "contactName": "Rahul", "contactPhone": "9876543210",
  "contactEmail": "r@x.com", "requestedHours": 12, "seatsNeeded": 4, "luggageNeeded": 2,
  "pickupDateTime": "2026-11-20T04:30:00.000Z", "returnDateTime": "2026-11-20T16:30:00.000Z",
  "pickupLocation": "Indiranagar", "dropLocation": "Mysuru", "specialRequirements": "child seat"
}
```

Required: `vehicleTypeId`, `contactName` (≥2 chars), `contactPhone` (10 digits). Returns 201 with the saved request (`status: "pending"`); admin answers from the web panel. There is no endpoint for the customer to read the answer yet.

### 3.6 Pay the advance — auth

First generate `bookingReference` yourself (`RNT-` + 6 random upper-case chars). Use the **same** reference for the payment and the booking.

**A) Wallet** — balance from `GET /taxi/users/wallet`.

`POST /taxi/users/rental-advance/wallet`

```json
{ "amount": 200, "bookingReference": "RNT-AB12CD" }
```

Response 201: `data: { provider: "wallet", status: "paid", amount, paymentId: "RNT-AB12CD", referenceKey, bookingReference, balance }`. Errors: `400 Insufficient wallet balance`. Calling it twice with the same reference debits once. `amount` must equal the advance you previewed (a smaller debit will not unlock the booking).

**B) Razorpay**

1. `POST /taxi/users/rental-advance/razorpay/order`

```json
{ "amount": 200, "vehicleId": "6ae4...", "vehicleName": "MINI BUS", "pickup": "2026-11-20T04:30:00.000Z", "returnTime": "2026-11-20T16:30:00.000Z" }
```

Response 201: `data: { keyId, orderId, amount /*paise*/, currency, bookingReference }`. Use the returned `bookingReference` for the booking.

2. Open the Razorpay SDK with `keyId`, `orderId`, `amount` exactly as returned.
3. On success you get `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`. You can call `POST /rental-advance/razorpay/verify` with those three for an early check (response 201, `data.status: "paid"`), but it is **optional** — the booking call verifies the payment again anyway.
4. If the app is killed after paying, persist the three values locally before calling `POST /rental-bookings` and retry on next launch (same `bookingReference`; a repeat is safe).

### 3.7 Create the booking — auth

`POST /taxi/users/rental-bookings`

```json
{
  "bookingReference": "RNT-AB12CD",
  "vehicleTypeId": "6ae45235fec0435dfe5f1492",
  "pickupDateTime": "2026-11-20T04:30:00.000Z",
  "returnDateTime": "2026-11-20T16:30:00.000Z",
  "selectedPackage": { "id": "pkg-8h-80k" },
  "serviceLocation": {
    "id": "6ae45235fec0435dfe5f1446", "name": "Bengaluru", "address": "334, 9th A Main Rd...",
    "city": "Bengaluru", "latitude": 12.9716, "longitude": 77.5946, "distanceKm": 3.2
  },
  "paymentMethod": "upi",
  "paymentMethodLabel": "UPI",
  "payment": {
    "provider": "razorpay",
    "razorpay_order_id": "order_N1", "razorpay_payment_id": "pay_N1", "razorpay_signature": "..."
  },
  "kycCompleted": true,
  "kycDocuments": {
    "drivingLicense": { "imageUrl": "https://gogo.org.in/uploads/...", "fileName": "dl.jpg", "uploadedAt": "2026-11-03T10:00:00.000Z" },
    "aadhaarCard":    { "imageUrl": "https://gogo.org.in/uploads/...", "fileName": "aadhaar.jpg", "uploadedAt": "2026-11-03T10:00:00.000Z" }
  }
}
```

- Wallet payment: `"payment": { "provider": "wallet" }` (the server finds your debit by `bookingReference`).
- No advance due: omit `payment`.
- `selectedPackage.id` is required and must be an active package of that vehicle. The rest of `selectedPackage` is ignored.
- `serviceLocation` is stored for the admin/service centre and for the tracking zone check.

Response **201** (new) or **200** (same `bookingReference` already saved): the booking object (section 5).

| Status | `message` | What to do |
|---|---|---|
| 400 | Valid pickup date and time is required / Return date and time must be after pickup | fix the form |
| 400 | A rental package must be selected / The selected rental package is not available... | refresh vehicles, re-pick |
| 400 | Invalid payment signature | payment data corrupted; do not retry blindly |
| 402 | An advance payment of Rs.X is required to book this rental | payment missing or smaller than X; show X |
| 403 | This payment does not belong to this booking | payment made for another user/purpose |
| 404 | Rental vehicle not found | vehicle was disabled; go back to the list |
| 409 | This payment has already been used for a booking | already booked; open My bookings |

### 3.8 My bookings — auth

`GET /taxi/users/rental-bookings?page=1&limit=10` → `data: { results: [booking], pagination: { page, limit, total, totalPages, hasNextPage, hasPrevPage } }`. Max `limit` is 20. Newest-updated first.

### 3.9 Active rental — auth

`GET /taxi/users/rental-bookings/active` → `data: booking` (with `rideMetrics`) or `data: null`.

It returns the latest booking whose status is `assigned`, `confirmed` or `end_requested`. Call it on app start and on resume; when it is non-null show the "Rental in progress" card and start location tracking (3.10).

`rideMetrics` (live bill, recalculated on every call):

```json
{ "hourlyRate": 1000, "includedHours": 8, "basePrice": 8000, "extraHourRate": 400,
  "elapsedMinutes": 312, "elapsedHours": 5.2, "currentCharge": 8000, "remainingDue": 8000 }
```

- Clock starts at `assignedAt`, else `pickupDateTime`, else `createdAt`.
- `currentCharge` = package price, plus every started hour beyond `includedHours` at `extraHourRate`; never below `payableNow`.
- `remainingDue` = `currentCharge - payableNow` = what the customer still pays offline.

### 3.10 Live location — auth

`POST /taxi/users/rental-bookings/:id/location`

```json
{ "status": "active", "coordinates": [77.5946, 12.9716], "heading": 90, "speed": 8.3,
  "accuracyMeters": 12, "capturedAt": "2026-11-20T05:00:00.000Z" }
```

- `coordinates` is **[longitude, latitude]** (GeoJSON order) and is required when `status` is `active`.
- `status`: `active` (position sent), `location_off` (GPS/permission turned off — send it without coordinates), `tracking_stopped`.
- Send at most one update per **15 s**, and only if the user moved **≥ 50 m** (the web app does exactly this). Use high accuracy, a foreground service on Android, and background location permission.
- If no position arrives for **2 minutes** the booking shows `trackingStatus: "location_off"` to admin.
- Errors: `409 Rental tracking is only available while the booking is active` (booking not confirmed/assigned yet or already ended) — stop sending.
- Response `data` is the tracking snapshot (zone status, distance from hub). Admin gets a live alert when the renter leaves the allowed zone (the service-location zone, or a 25 km radius around the hub when no zone is set). Tell the customer this in the UI, plus when tracking is off.

### 3.11 End ride — auth

`POST /taxi/users/rental-bookings/:id/end` (empty body)

Allowed only when `status` is `assigned` or `confirmed`, otherwise `409 This rental ride cannot be ended right now`. On success the booking becomes `end_requested` with `finalCharge` and `finalElapsedMinutes` frozen at that moment, and admin is asked to review. Show a "waiting for admin to complete" state and keep sending location while `GET /rental-bookings/active` still returns this booking (it does for `end_requested`). Once admin completes it, `active` returns `null`; open the booking from `GET /rental-bookings` to show the final receipt. There is no single-booking GET for customers.

When admin sets `completed`, `finalCharge` is what the customer pays at the counter minus the advance already paid.

---

## 4. Booking object

```json
{
  "id": "66f2...", "bookingReference": "RNT-AB12CD", "userId": "66a1...",
  "vehicleTypeId": "6ae4...", "vehicleName": "MINI BUS - -AC", "vehicleCategory": "Car", "vehicleImage": "https://...",
  "selectedPackage": { "packageId": "pkg-8h-80k", "label": "8 Hours / 80 km", "durationHours": 8, "price": 8000, "extraHourPrice": 400 },
  "serviceLocation": { "locationId": "6ae4...", "name": "Bengaluru", "address": "...", "city": "Bengaluru", "latitude": 12.9716, "longitude": 77.5946, "distanceKm": 3.2 },
  "pickupDateTime": "2026-11-20T04:30:00.000Z", "returnDateTime": "2026-11-20T16:30:00.000Z",
  "requestedHours": 12,
  "totalCost": 9600, "payableNow": 0,
  "advancePaymentLabel": "Advance booking payment",
  "paymentStatus": "not_required", "paymentMethod": "upi", "paymentMethodLabel": "UPI",
  "payment": { "provider": "manual", "status": "not_required", "amount": 0, "currency": "INR", "orderId": "", "paymentId": "", "signature": "" },
  "contactName": "Rahul", "contactPhone": "9876543210", "contactEmail": "r@x.com",
  "kycCompleted": true,
  "kycDocuments": { "drivingLicense": { "imageUrl": "...", "fileName": "dl.jpg", "uploadedAt": "..." }, "aadhaarCard": { "imageUrl": "...", "fileName": "...", "uploadedAt": "..." } },
  "assignedVehicle": { "vehicleId": "", "name": "", "vehicleCategory": "", "image": "" },
  "status": "pending", "adminNote": "",
  "assignedAt": null, "completionRequestedAt": null, "completedAt": null,
  "finalCharge": 0, "finalElapsedMinutes": 0,
  "createdAt": "2026-11-03T10:00:00.000Z", "updatedAt": "...",
  "rentalTracking": { "enabled": false, "trackingStatus": "inactive", "zoneStatus": "unknown", "isStale": true,
                      "lastLocationAt": null, "currentLocation": null, "distanceFromHubMeters": null,
                      "geofenceRadiusMeters": null, "hubName": "Bengaluru", "alerts": [], "history": [] }
}
```

- Show `assignedVehicle` (the actual vehicle given) once `assignedAt` is set; before that show the booked `vehicleName`.
- `adminNote` is a message from admin; show it if not empty.
- Do not log or display `payment.signature`.

---

## 5. Dart models

```dart
// lib/modules/taxi/rental/data/rental_models.dart
double _d(dynamic v) => (v is num) ? v.toDouble() : double.tryParse('$v') ?? 0;

class RentalPackage {
  final String id, label;
  final int durationHours;
  final double price, extraHourPrice, includedKm;
  final bool active;
  RentalPackage.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        label = j['label'] ?? '',
        durationHours = (j['durationHours'] ?? 1).toInt(),
        price = _d(j['price']),
        extraHourPrice = _d(j['extraHourPrice']),
        includedKm = _d(j['includedKm']),
        active = j['active'] != false;
}

class RentalAdvance {
  final bool enabled;
  final String mode; // full | percentage | fixed
  final double amount;
  final String label;
  RentalAdvance.fromJson(Map<String, dynamic> j)
      : enabled = j['enabled'] == true,
        mode = j['paymentMode'] ?? 'percentage',
        amount = _d(j['amount']),
        label = j['label'] ?? 'Advance booking payment';

  /// Preview only. The server recomputes this.
  double forTotal(double total) {
    if (!enabled) return 0;
    final v = mode == 'full'
        ? total
        : mode == 'fixed'
            ? (amount < total ? amount : total)
            : total * (amount > 100 ? 100 : amount) / 100;
    return (v * 100).round() / 100;
  }
}

class RentalVehicle {
  final String id, name, shortDescription, category, image;
  final int capacity;
  final List<String> amenities, serviceStoreIds, gallery;
  final List<RentalPackage> packages;
  final RentalAdvance advance;
  RentalVehicle.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? j['_id'],
        name = j['name'] ?? '',
        shortDescription = j['short_description'] ?? '',
        category = j['vehicleCategory'] ?? '',
        image = j['coverImage'] ?? j['image'] ?? '',
        capacity = (j['capacity'] ?? 1).toInt(),
        amenities = List<String>.from(j['amenities'] ?? []),
        serviceStoreIds = List<String>.from(j['serviceStoreIds'] ?? []),
        gallery = List<String>.from(j['galleryImages'] ?? []),
        packages = (j['pricing'] as List? ?? [])
            .map((e) => RentalPackage.fromJson(e)).where((p) => p.active).toList(),
        advance = RentalAdvance.fromJson(j['advancePayment'] ?? {});
}

double rentalTotal(RentalPackage p, DateTime pickup, DateTime ret) {
  final hours = ret.difference(pickup).inMinutes / 60.0;
  final extra = (hours - p.durationHours).clamp(0, double.infinity).ceil();
  return ((p.price + extra * p.extraHourPrice) * 100).round() / 100;
}

class RentalMetrics {
  final double includedHours, basePrice, extraHourRate, elapsedHours, currentCharge, remainingDue;
  final int elapsedMinutes;
  RentalMetrics.fromJson(Map<String, dynamic> j)
      : includedHours = _d(j['includedHours']),
        basePrice = _d(j['basePrice']),
        extraHourRate = _d(j['extraHourRate']),
        elapsedHours = _d(j['elapsedHours']),
        currentCharge = _d(j['currentCharge']),
        remainingDue = _d(j['remainingDue']),
        elapsedMinutes = (j['elapsedMinutes'] ?? 0).toInt();
}

class RentalBooking {
  final String id, bookingReference, vehicleName, vehicleImage, status, paymentStatus, adminNote;
  final String assignedVehicleName, hubName;
  final DateTime? pickup, returnAt, assignedAt, completedAt;
  final double totalCost, payableNow, finalCharge;
  final RentalMetrics? metrics;
  final bool trackingEnabled;

  RentalBooking.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        bookingReference = j['bookingReference'] ?? '',
        vehicleName = j['vehicleName'] ?? '',
        vehicleImage = j['vehicleImage'] ?? '',
        status = j['status'] ?? 'pending',
        paymentStatus = j['paymentStatus'] ?? 'pending',
        adminNote = j['adminNote'] ?? '',
        assignedVehicleName = j['assignedVehicle']?['name'] ?? '',
        hubName = j['serviceLocation']?['name'] ?? '',
        pickup = DateTime.tryParse('${j['pickupDateTime']}'),
        returnAt = DateTime.tryParse('${j['returnDateTime']}'),
        assignedAt = DateTime.tryParse('${j['assignedAt']}'),
        completedAt = DateTime.tryParse('${j['completedAt']}'),
        totalCost = _d(j['totalCost']),
        payableNow = _d(j['payableNow']),
        finalCharge = _d(j['finalCharge']),
        trackingEnabled = j['rentalTracking']?['enabled'] == true,
        metrics = j['rideMetrics'] == null ? null : RentalMetrics.fromJson(j['rideMetrics']);

  bool get isRunning => const ['confirmed', 'assigned', 'end_requested'].contains(status);
  bool get canEnd => const ['confirmed', 'assigned'].contains(status);
}
```

---

## 6. Repository + payment code

```dart
// lib/modules/taxi/rental/data/rental_repository.dart   (api = your existing client, returns unwrapped data)
class RentalRepository {
  static const _b = '/taxi/users';

  Future<List<RentalVehicle>> vehicles() async =>
      ((await api.get('$_b/rental-vehicles'))['results'] as List).map((e) => RentalVehicle.fromJson(e)).toList();

  Future<List<Map<String, dynamic>>> hubs() async =>
      List<Map<String, dynamic>>.from((await api.get('$_b/service-locations'))['results']);

  Future<String> uploadKyc(String base64DataUrl) async =>
      (await api.post('/taxi/common/upload/image', {'image': base64DataUrl, 'folder': 'rental-kyc'}))['url'];

  Future<Map<String, dynamic>> payWithWallet(double amount, String ref) =>
      api.post('$_b/rental-advance/wallet', {'amount': amount, 'bookingReference': ref});

  Future<Map<String, dynamic>> createAdvanceOrder(double amount, RentalVehicle v, DateTime pickup, DateTime ret) =>
      api.post('$_b/rental-advance/razorpay/order', {
        'amount': amount, 'vehicleId': v.id, 'vehicleName': v.name,
        'pickup': pickup.toUtc().toIso8601String(), 'returnTime': ret.toUtc().toIso8601String(),
      });

  Future<RentalBooking> createBooking(Map<String, dynamic> body) async =>
      RentalBooking.fromJson(await api.post('$_b/rental-bookings', body));

  Future<List<RentalBooking>> myBookings({int page = 1}) async =>
      ((await api.get('$_b/rental-bookings', query: {'page': page, 'limit': 10}))['results'] as List)
          .map((e) => RentalBooking.fromJson(e)).toList();

  Future<RentalBooking?> active() async {
    final d = await api.get('$_b/rental-bookings/active');
    return d == null ? null : RentalBooking.fromJson(d);
  }

  Future<void> sendLocation(String id, Map<String, dynamic> body) =>
      api.post('$_b/rental-bookings/$id/location', body);

  Future<RentalBooking> endRide(String id) async =>
      RentalBooking.fromJson(await api.post('$_b/rental-bookings/$id/end', {}));
}
```

Razorpay (`razorpay_flutter`):

```dart
final order = await repo.createAdvanceOrder(advance, vehicle, pickup, ret);
final ref = order['bookingReference'];
final rz = Razorpay();
rz.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) async {
  // persist r.orderId / r.paymentId / r.signature locally first
  final booking = await repo.createBooking({
    ...bookingBody,                       // vehicleTypeId, times, package, hub, kyc ...
    'bookingReference': ref,
    'paymentMethod': 'upi', 'paymentMethodLabel': 'UPI',
    'payment': {
      'provider': 'razorpay',
      'razorpay_order_id': r.orderId, 'razorpay_payment_id': r.paymentId, 'razorpay_signature': r.signature,
    },
  });
});
rz.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) => showError(r.message));
rz.open({'key': order['keyId'], 'order_id': order['orderId'], 'amount': order['amount'], 'currency': order['currency'], 'name': vehicle.name});
```

---

## 7. Screens (customer app)

1. **Rental list** — vehicle cards: image, name, capacity, "from ₹X" (cheapest active package), amenities.
2. **Vehicle detail** — gallery, amenities, package chips (label, price, included hours/km, extra hour rate), advance note ("Pay ₹X now" or "No advance"), pickup hub picker (nearest first).
3. **Schedule** — pickup and return date-time (return after pickup, pickup in the future — the server does not check "future"). Live preview: hours, extra hours, total, advance, balance at pickup.
4. **KYC** — camera/gallery for driving licence and Aadhaar, upload both, show previews, block "Continue" until both uploaded.
5. **Payment** — summary + method: wallet (show balance, disable if insufficient) or online (Razorpay). If `advance == 0`, skip straight to booking with a "Confirm booking" button.
6. **Confirmation** — booking reference, vehicle, package, hub, times, advance paid, "balance paid at pickup", status `pending` ("Waiting for confirmation").
7. **My bookings** — list with status chips; tap → detail with the booking object (admin note, assigned vehicle, final charge when completed).
8. **Rental in progress** (when `/active` is non-null) — assigned vehicle, elapsed time, live bill (`currentCharge`, `remainingDue`), tracking status (green when sending, warning when location off), **End ride** button (only `canEnd`), and the "waiting for admin" state for `end_requested`.

---

## 8. Edge cases

- **Advance changed by admin between preview and pay** → 402 with the new amount; refresh vehicles and re-preview.
- **Duplicate tap / retry** → safe: the same `bookingReference` returns the saved booking (200). A different reference with an already-used Razorpay payment gives 409.
- **Paid but booking call failed (network)** → keep the payment values and `bookingReference`, retry on next launch/resume. Do not start a second payment.
- **Location permission denied / GPS off** → send `status: "location_off"` once, tell the user tracking is required during the rental.
- **Booking disappears from `/active`** → it was completed or cancelled; stop the tracker and open the booking detail.
- **No customer cancel, no in-app balance payment, no quote reply screen** — do not build them.

---

## 9. Test checklist

- [ ] Home tile `rental` opens the vehicle list; images load.
- [ ] Package preview matches the server: 12 h trip on an 8 h package with ₹400/extra hour = price + 4 × 400.
- [ ] Vehicle with advance off: no payment screen, booking saved as `not_required`, `payableNow` 0.
- [ ] Advance on (ask admin to enable one vehicle, e.g. 20 %): Razorpay amount equals `total × 20 %`; booking `paymentStatus: "paid"`, `payment.provider: "razorpay"`.
- [ ] Wallet advance: balance drops once; booking `payment.provider: "wallet"`.
- [ ] Re-sending the same booking returns the same id (200), not a second booking.
- [ ] After admin assigns a vehicle: `/active` returns it, location updates return 200, admin tracking screen shows the dot.
- [ ] Turn GPS off: status becomes location_off for admin within 2 min.
- [ ] End ride → `end_requested`, button gone, `finalCharge` set; after admin completes → shows `completed`.
- [ ] 402 / 409 messages are shown to the user as returned.

---

## 10. Service-centre panel (driver app, for reference)

Logged in through the driver auth with role `service_center` (owner) or `service_center_staff`. Base: `/api/v1/taxi/drivers`. A centre sees only bookings whose `serviceCenterIds` include it (the vehicle's service stores that match the booking's hub); a staff member sees only bookings assigned to them.

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /service-center/bookings` | owner, staff | bookings + `permissions` + staff list |
| `PATCH /service-center/bookings/:id` | owner, staff | assign staff, add note, fill inspection, change `status` |
| `GET/PATCH /service-center/bookings/:id/biometrics` | owner, staff | customer's biometric consent and enrolment settings |
| `POST/DELETE /service-center/bookings/:id/biometrics/fingers[/:code]` | owner, staff | capture / delete a fingerprint |
| `POST /service-center/bookings/:id/biometrics/verify` | owner, staff | verify the customer's finger at handover |
| `GET/POST/PATCH/DELETE /service-center/staff[/:id]` + biometrics | owner (staff: own profile) | manage staff |
| `GET/POST/PATCH/DELETE /service-center/vehicles[/:id]` | owner | the centre's vehicles |

Rules enforced by the server on `PATCH /service-center/bookings/:id`:
- Only the owner can assign staff (`assignedStaffId`); assigning staff to a `pending` booking makes it `assigned`.
- Staff can only touch their own assigned bookings, and only set status `assigned`, `confirmed`, `completed` or `end_requested`. Only the owner can set `pending` or `cancelled`.
- **Completing** (`status: "completed"`) needs the return inspection filled first: `returnMeterReading`, `returnFuelLevel`, `returnNotes` and at least one `afterConditionImages` photo, otherwise 400.
- Inspection (`rentalInspection`): before handover checks (`exteriorOk`, `interiorOk`, `dashboardOk`, `tyresOk`, `fuelOk`, `documentsOk`), after return checks (`exteriorChecked`, `interiorChecked`, `dashboardChecked`, `fuelChecked`, `tyresChecked`, `damageReviewed`), pickup/return notes, meter, fuel level and before/after photos.

---

## 11. Admin panel (web, for reference)

Base `/api/v1/taxi/admin`, admin token. Screens: Taxi → Price Management → Rental & Packages.

| Screen | Endpoints |
|---|---|
| Rental vehicles (packages, advance setting, service stores) | `GET/POST /types/rental-vehicles`, `PATCH/DELETE /types/rental-vehicles/:id` |
| Rental package types | `GET/POST /types/rental-packages`, `PATCH/DELETE /types/rental-packages/:id` |
| Booking requests | `GET /rental-booking-requests`, `PATCH /rental-booking-requests/:id` |
| Quote requests | `GET /rental-quote-requests`, `PATCH /rental-quote-requests/:id` |
| Live tracking | `GET /rental-tracking` + socket events `rental:tracking:updated`, `rental:tracking:alert` |

`PATCH /rental-booking-requests/:id` accepts `status`, `assignedVehicleId` (assigning a vehicle also makes the booking `assigned`), `adminNote`, `cancelReason`. Moving to `end_requested` or `completed` freezes `finalCharge` / `finalElapsedMinutes`.

---

## 12. Known limits (so nobody is surprised)

- No stock/availability check: the same vehicle type can be booked by many customers for the same time. Admin assigns real vehicles by hand.
- Cancelling a booking does **not** refund the advance automatically; refunds are handled by hand.
- Admin and the service centre can set any status in any order; the app must handle a booking jumping states.
- The customer cannot read a quote answer in the app yet.
- The pickup time is not checked to be in the future by the server.
