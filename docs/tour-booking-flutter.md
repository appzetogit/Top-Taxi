# Tour Packages — Flutter implementation guide (Gogo customer app, taxi module)

Customer-side flow for browsing tour packages (Goa, Manali, ...), booking a departure, paying (full or a part now) and paying the remaining balance later.

- API base: `https://gogo.org.in/api/v1`
- All tour endpoints live under `/taxi/users/...` (full example: `https://gogo.org.in/api/v1/taxi/users/tour-packages`)
- Success envelope: `{ "success": true, "data": ... }`. Lists come as `data.results`.
- Errors: non-2xx with the human-readable text in `message`. Show it to the user as-is.
- Auth: `Authorization: Bearer <user JWT>` on every endpoint marked **auth**. Browse endpoints are public.

---

## How it behaves (read first)

- **The server prices everything.** Never send amounts. Send only ids, name, phone and person count. Use the `amount` the order endpoint returns.
- **Amounts in the order response are in paise** (Razorpay unit). Booking objects (`totalAmount`, `amountPaid`, `balanceAmount`) are in **rupees**.
- **Upfront amount** depends on the package: `upfrontPayment.paymentMode == "full"` → pay the whole total; `"percentage"` → pay `total * percentage / 100` now, rest later. Show this on the booking screen before the user pays.
- **Seats are taken only after payment is verified**, not when the order is created. An abandoned order costs nothing, but the seat can still run out before the user pays (see edge cases).
- **A booking is `confirmed` as soon as the upfront payment verifies**, even if a balance is pending. There is no auto-cancel for unpaid balance.
- **No cancellation, no enquiry form** — do not build either.
- An unpaid order expires in **15 minutes** (`pending_payment` → `expired`). Just create a fresh order to retry.
- Phone must be exactly **10 digits** (no +91, no spaces).
- Razorpay mock orders (`mock_order_*`) exist only on non-production servers; production always returns real Razorpay orders. Do not special-case them in the app.

---

## 1. Flow at a glance

```
Home "Tours" tile → TourHome (cards) → TourDetail → TourBooking (form)
   → POST /tour-bookings/order → Razorpay checkout → POST /tour-bookings/verify
   → TourConfirm
My bookings → Tours tab → booking row → "Pay remaining balance"
   → POST /tour-bookings/:id/balance/order → Razorpay → POST /tour-bookings/:id/balance/verify
```

The home tile is driven by the admin "App Modules" list: a module with `service_type: "tours"` should open `TourHome`. Add that case next to your other `service_type` switches.

---

## 2. Endpoints

### 2.1 List packages — public

`GET /taxi/users/tour-packages`

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "66f1...",
        "destination": "Goa",
        "location": "Goa, India",
        "coverImage": "https://gogo.org.in/uploads/tours/goa.jpg",
        "pricePerPerson": 12999,
        "durationLabel": "4D/3N",
        "nextDeparture": {
          "id": "66f1...a",
          "startDate": "2026-11-20T00:00:00.000Z",
          "endDate": "2026-11-23T00:00:00.000Z",
          "totalSeats": 20,
          "seatsLeft": 14
        }
      }
    ]
  }
}
```

`nextDeparture` can be `null` (no upcoming date) — show the card as "No upcoming dates" and don't allow booking. Only active packages are returned.

### 2.2 Package detail — public

`GET /taxi/users/tour-packages/:id`

```json
{
  "success": true,
  "data": {
    "id": "66f1...",
    "destination": "Goa",
    "location": "Goa, India",
    "coverImage": "https://gogo.org.in/uploads/tours/goa.jpg",
    "galleryImages": ["https://gogo.org.in/uploads/tours/goa-1.jpg"],
    "pricePerPerson": 12999,
    "durationLabel": "4D/3N",
    "ageRangeLabel": "5 - 60 yrs",
    "happyTravellersCount": 1200,
    "overview": "Long text...",
    "highlights": ["Sunset cruise", "Old Goa churches"],
    "itinerary": [
      { "day": 1, "title": "Arrival", "description": "Pickup and check-in..." }
    ],
    "inclusions": ["Hotel", "Breakfast"],
    "exclusions": ["Flights"],
    "upcomingDates": [
      { "id": "66f1...a", "startDate": "2026-11-20T00:00:00.000Z", "endDate": "2026-11-23T00:00:00.000Z", "totalSeats": 20, "seatsLeft": 14 }
    ],
    "upfrontPayment": { "paymentMode": "percentage", "percentage": 20 }
  }
}
```

`seatsLeft == 0` → show "Sold out" and disable that date.

### 2.3 Create payment order — auth

`POST /taxi/users/tour-bookings/order`

```json
{
  "packageId": "66f1...",
  "departureId": "66f1...a",
  "customerName": "Rahul Sharma",
  "customerPhone": "9876543210",
  "personCount": 2
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "keyId": "rzp_live_xxx",
    "orderId": "order_Nxxxx",
    "amount": 519600,
    "currency": "INR",
    "bookingId": "66f2..."
  }
}
```

`amount` is the **upfront** amount in paise (already full-or-percentage). Open Razorpay with exactly these values.

Errors: `400` validation (bad phone, missing name, personCount < 1), `404` package/departure not found or inactive, `409` `Only N seat(s) left on this departure`.

### 2.4 Verify payment — auth

`POST /taxi/users/tour-bookings/verify`

```json
{
  "razorpay_order_id": "order_Nxxxx",
  "razorpay_payment_id": "pay_Nxxxx",
  "razorpay_signature": "..."
}
```

Response `201` → a booking object (section 3). Booking is now `confirmed`; `paymentStatus` is `paid` (full) or `partial`.

Errors: `400` bad signature, `404` unknown order, and **`409` "Seats are no longer available … Payment was captured — contact support for a refund."** — see edge cases.

### 2.5 Create balance order — auth

`POST /taxi/users/tour-bookings/:id/balance/order` — empty body.

Response `201`: `{ keyId, orderId, amount, currency }` (amount in paise = remaining balance).

`409` if the booking has nothing to pay (`paymentStatus != "partial"` or balance already paid).

### 2.6 Verify balance payment — auth

`POST /taxi/users/tour-bookings/:id/balance/verify` — body is the same Razorpay triple as 2.4.

Response: the updated booking (`paymentStatus: "paid"`, `balanceAmount: 0`).

### 2.7 My bookings — auth

`GET /taxi/users/tour-bookings` → `data.results: [booking]` (newest first).
`GET /taxi/users/tour-bookings/:id` → `data: booking`.

---

## 3. Booking object

```json
{
  "id": "66f2...",
  "bookingCode": "TB-XXXXXX",
  "packageId": "66f1...",
  "packageSnapshot": { "destination": "Goa", "coverImage": "https://...", "durationLabel": "4D/3N" },
  "departureSnapshot": { "startDate": "2026-11-20T00:00:00.000Z", "endDate": "2026-11-23T00:00:00.000Z" },
  "customerName": "Rahul Sharma",
  "customerPhone": "9876543210",
  "personCount": 2,
  "pricePerPerson": 12999,
  "totalAmount": 25998,
  "upfrontRequiredAmount": 5199.6,
  "paymentStatus": "partial",
  "amountPaid": 5199.6,
  "balanceAmount": 20798.4,
  "balancePaymentStatus": "pending",
  "status": "confirmed",
  "createdAt": "2026-10-28T10:00:00.000Z"
}
```

| Field | Values | Meaning |
|---|---|---|
| `status` | `pending_payment` | Order created, not paid yet. Hide from "My bookings" or show as "Payment pending". |
| | `confirmed` | Upfront paid, seats held. |
| | `completed` | Trip done (set by admin). |
| | `cancelled` / `expired` | Payment failed/seat conflict, or 15-min hold lapsed. |
| `paymentStatus` | `pending`, `partial`, `paid`, `failed`, `expired` | `partial` = balance still due. |
| `balancePaymentStatus` | `not_required`, `pending`, `paid`, `failed` | |

Show **"Pay remaining balance ₹{balanceAmount}"** only when `paymentStatus == "partial" && balanceAmount > 0`.

`amountPaid` includes payments the admin recorded manually (cash/UPI), so it can exceed what Razorpay charged. Admin can also create a booking on the customer's behalf; if the phone matches the user's account it appears in their list and the balance button works the same way.

---

## 4. Dart models

```dart
// lib/modules/taxi/tours/data/tour_models.dart
double _d(dynamic v) => (v is num) ? v.toDouble() : double.tryParse('$v') ?? 0;

class TourDeparture {
  final String id;
  final DateTime startDate, endDate;
  final int totalSeats, seatsLeft;
  TourDeparture.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        startDate = DateTime.parse(j['startDate']),
        endDate = DateTime.parse(j['endDate']),
        totalSeats = j['totalSeats'] ?? 0,
        seatsLeft = j['seatsLeft'] ?? 0;
  bool get soldOut => seatsLeft <= 0;
}

class TourPackageSummary {
  final String id, destination, location, coverImage, durationLabel;
  final double pricePerPerson;
  final TourDeparture? nextDeparture;
  TourPackageSummary.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        destination = j['destination'] ?? '',
        location = j['location'] ?? '',
        coverImage = j['coverImage'] ?? '',
        durationLabel = j['durationLabel'] ?? '',
        pricePerPerson = _d(j['pricePerPerson']),
        nextDeparture = j['nextDeparture'] == null
            ? null
            : TourDeparture.fromJson(j['nextDeparture']);
}

class TourItineraryDay {
  final int day;
  final String title, description;
  TourItineraryDay.fromJson(Map<String, dynamic> j)
      : day = j['day'] ?? 0,
        title = j['title'] ?? '',
        description = j['description'] ?? '';
}

class TourPackageDetail {
  final String id, destination, location, coverImage, durationLabel, ageRangeLabel, overview;
  final double pricePerPerson;
  final int happyTravellersCount;
  final List<String> galleryImages, highlights, inclusions, exclusions;
  final List<TourItineraryDay> itinerary;
  final List<TourDeparture> upcomingDates;
  final String paymentMode; // 'full' | 'percentage'
  final double percentage;

  TourPackageDetail.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        destination = j['destination'] ?? '',
        location = j['location'] ?? '',
        coverImage = j['coverImage'] ?? '',
        durationLabel = j['durationLabel'] ?? '',
        ageRangeLabel = j['ageRangeLabel'] ?? '',
        overview = j['overview'] ?? '',
        pricePerPerson = _d(j['pricePerPerson']),
        happyTravellersCount = j['happyTravellersCount'] ?? 0,
        galleryImages = List<String>.from(j['galleryImages'] ?? []),
        highlights = List<String>.from(j['highlights'] ?? []),
        inclusions = List<String>.from(j['inclusions'] ?? []),
        exclusions = List<String>.from(j['exclusions'] ?? []),
        itinerary = (j['itinerary'] as List? ?? [])
            .map((e) => TourItineraryDay.fromJson(e)).toList(),
        upcomingDates = (j['upcomingDates'] as List? ?? [])
            .map((e) => TourDeparture.fromJson(e)).toList(),
        paymentMode = j['upfrontPayment']?['paymentMode'] ?? 'full',
        percentage = _d(j['upfrontPayment']?['percentage']);

  /// Display only — the server computes the real amount.
  double upfrontFor(int persons) {
    final total = pricePerPerson * persons;
    return paymentMode == 'percentage'
        ? (total * percentage / 100 * 100).round() / 100
        : total;
  }
}

class TourBooking {
  final String id, bookingCode, destination, coverImage, durationLabel;
  final String customerName, customerPhone, paymentStatus, balancePaymentStatus, status;
  final DateTime? startDate, endDate;
  final int personCount;
  final double totalAmount, amountPaid, balanceAmount;

  TourBooking.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        bookingCode = j['bookingCode'] ?? '',
        destination = j['packageSnapshot']?['destination'] ?? '',
        coverImage = j['packageSnapshot']?['coverImage'] ?? '',
        durationLabel = j['packageSnapshot']?['durationLabel'] ?? '',
        startDate = DateTime.tryParse('${j['departureSnapshot']?['startDate']}'),
        endDate = DateTime.tryParse('${j['departureSnapshot']?['endDate']}'),
        customerName = j['customerName'] ?? '',
        customerPhone = j['customerPhone'] ?? '',
        personCount = j['personCount'] ?? 1,
        totalAmount = _d(j['totalAmount']),
        amountPaid = _d(j['amountPaid']),
        balanceAmount = _d(j['balanceAmount']),
        paymentStatus = j['paymentStatus'] ?? 'pending',
        balancePaymentStatus = j['balancePaymentStatus'] ?? 'not_required',
        status = j['status'] ?? 'pending_payment';

  bool get canPayBalance => paymentStatus == 'partial' && balanceAmount > 0;
}
```

---

## 5. Service + Razorpay

Use the same `api` client / `ApiConstants` pattern as the other taxi modules (client returns the unwrapped `data`).

```dart
// lib/modules/taxi/tours/data/tour_repository.dart
class TourRepository {
  static const _b = '/taxi/users';

  Future<List<TourPackageSummary>> list() async {
    final d = await api.get('$_b/tour-packages');
    return (d['results'] as List).map((e) => TourPackageSummary.fromJson(e)).toList();
  }

  Future<TourPackageDetail> detail(String id) async =>
      TourPackageDetail.fromJson(await api.get('$_b/tour-packages/$id'));

  Future<Map<String, dynamic>> createOrder({
    required String packageId, required String departureId,
    required String name, required String phone, required int persons,
  }) => api.post('$_b/tour-bookings/order', {
        'packageId': packageId, 'departureId': departureId,
        'customerName': name, 'customerPhone': phone, 'personCount': persons,
      });

  Future<TourBooking> verify(Map<String, String> rz) async =>
      TourBooking.fromJson(await api.post('$_b/tour-bookings/verify', rz));

  Future<Map<String, dynamic>> createBalanceOrder(String bookingId) =>
      api.post('$_b/tour-bookings/$bookingId/balance/order', {});

  Future<TourBooking> verifyBalance(String bookingId, Map<String, String> rz) async =>
      TourBooking.fromJson(await api.post('$_b/tour-bookings/$bookingId/balance/verify', rz));

  Future<List<TourBooking>> myBookings() async {
    final d = await api.get('$_b/tour-bookings');
    return (d['results'] as List).map((e) => TourBooking.fromJson(e)).toList();
  }
}
```

Razorpay (`razorpay_flutter`), same for upfront and balance — only the verify call differs:

```dart
final order = await repo.createOrder(...);            // or createBalanceOrder(id)
final rz = Razorpay();
rz.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) async {
  final booking = await repo.verify({                  // or verifyBalance(id, {...})
    'razorpay_order_id': r.orderId!,
    'razorpay_payment_id': r.paymentId!,
    'razorpay_signature': r.signature!,
  });
  // → TourConfirm(booking)  /  refresh My bookings
});
rz.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
  // show r.message; user can tap Pay again → create a NEW order
});
rz.open({
  'key': order['keyId'],
  'order_id': order['orderId'],
  'amount': order['amount'],        // paise, as returned
  'currency': order['currency'],
  'name': 'Gogo Tours',
  'prefill': {'contact': phone, 'name': name},
});
// rz.clear() in dispose()
```

---

## 6. Screens

1. **TourHome** — grid/list of cards: cover image, destination, `durationLabel`, "From ₹pricePerPerson / person", next departure date + "N seats left" (or "No upcoming dates"). Pull to refresh.
2. **TourDetail** (top to bottom): photo gallery + "View all photos" → title + quick facts (location, duration, age range, happy travellers) → Overview (clamped, "View more") → Highlights → Itinerary accordion (Day N – title) → Upcoming Dates (date range, `seatsLeft/totalSeats`, selectable; sold-out disabled) → Inclusions / Exclusions → sticky bottom bar: "Starting from ₹X / person" + selected date + **Book Now** (disabled when no date selected or sold out). Passes `packageId` + `departureId` forward.
3. **TourBooking** — name (2–80 chars), phone (exactly 10 digits), person stepper (1 … `seatsLeft`), live total = `pricePerPerson × persons`, and a payment summary:
   - percentage mode: "Pay ₹{upfront} now ({percentage}%) · ₹{rest} balance due later"
   - full mode: "Pay full ₹{total} now"

   Button → create order → Razorpay → verify. Disable the button while a request is in flight.
4. **TourConfirm** — booking code, destination, dates, persons, amount paid, and (if `canPayBalance`) "Balance ₹X due — pay anytime from My bookings".
5. **My bookings → Tours tab** — list from `myBookings()`, each with destination, dates, `status`, paid vs total, and **Pay remaining balance** when `canPayBalance`. After a successful balance verify, refresh the list.

---

## 7. Edge cases

- **Seat conflict at verify (`409 … Payment was captured`)**: someone took the last seats while the user was paying. The money was charged; the booking is cancelled server-side and the admin refunds manually. Show the server message in a blocking dialog with a support contact. Do **not** retry verify.
- **Payment failed / user closed Razorpay**: nothing was booked. Let them tap Pay again — this creates a new order (the old one just expires).
- **App killed after paying but before verify**: the user is charged but the booking stays `pending_payment`. On app start, if you stored the last `orderId/paymentId/signature` locally, retry verify once; otherwise they contact support. Persist the success payload to local storage before calling verify.
- **Session expired (401)**: send the user to login, then return to the form with the entered data kept.
- **`409 Only N seat(s) left`** on order: update the person stepper to N and re-fetch detail.
- **No cancellation**: don't show a Cancel button.
- **Dates**: API returns UTC ISO strings; format as local date (`dd MMM yyyy`).

---

## 8. Test checklist

- [ ] Tile with `service_type: "tours"` opens TourHome; packages and cover images load.
- [ ] Detail renders every section; sold-out date is not selectable; no enquiry / cancellation UI anywhere.
- [ ] Percentage package, 2 persons: summary shows correct "pay now / balance"; Razorpay amount equals it; after verify, booking shows `partial` and the correct balance.
- [ ] Full-payment package: summary says "Pay full"; booking is `paid`, no balance button.
- [ ] Abandon Razorpay: seats-left on the card does **not** drop.
- [ ] Pay remaining balance: booking becomes `paid`, `balanceAmount` 0, button disappears.
- [ ] Phone with 9 digits / name empty → blocked client-side; server 400 message shown if it slips through.
- [ ] More persons than seats left → blocked client-side; 409 handled.
- [ ] A booking created by admin for the user's phone appears in My bookings and its balance can be paid.
