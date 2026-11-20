# Bookings made by Gogo support — Flutter implementation guide (customer app, taxi module)

Support staff can now create a booking **for** a customer from the admin panel: daily cab, outstation, airport taxi, parcel delivery, rental or tour. The customer sees it in the app like a booking they made themselves, and can **confirm** or **cancel** it until it starts.

(Pooling and bus bookings are not made this way.)

- API base: `https://gogo.org.in/api/v1`. Confirm and cancel are under `/taxi/users/...`; the rides list is `/taxi/rides`.
- Success: `{ "success": true, "data": ... }`. Errors: non-2xx with the text in `message` — show it as is.
- Auth: `Authorization: Bearer <user JWT>`.

---

## How it behaves (read first)

- The admin picks a time a little ahead (at least 5 minutes), saves the booking, then **rings the customer**. The booking is **awaiting confirmation** until someone confirms it:
  - the admin marks it confirmed after the customer agrees on the phone, **or**
  - the customer taps **Confirm** in the app, **or**
  - either of them cancels it (the admin must give a reason; the customer's reason is optional).
- Whoever acts first settles it. A second attempt gets `409` with a plain message.
- **Confirm and cancel work only until the booking starts.** The server tells you: use `adminBooking.canConfirm` and `adminBooking.canCancel` to show or hide the buttons. Do not work it out yourself.
- It appears in the **same lists you already use** (rides history, rental bookings, tour bookings). There is no new list. Existing screens keep working; they just get two extra fields.
- It is **not** the customer's "current ride". Opening the app or booking another ride in the meantime does not touch it.
- No cancellation fee is charged for cancelling an admin-made booking before it starts.
- If the customer was **not registered** when the booking was made, it is saved against their phone number and shows up in their lists as soon as they register or log in with that number. Nothing to do in the app.
- Drivers are not told about a booking until it is confirmed. A driver may already have been picked by the admin; they are assigned and notified at confirmation.

---

## 1. What changed in the data you already read

Every booking object in the three existing lists now carries:

```json
{
  "displayStatus": "awaiting_confirmation",
  "adminBooking": {
    "source": "admin",
    "bookingType": "daily_cab",
    "bookingTypeLabel": "Daily Cab",
    "confirmation": "awaiting",
    "canConfirm": true,
    "canCancel": true,
    "confirmedAt": null,
    "confirmedBy": "",
    "cancelledAt": null,
    "cancelledBy": "",
    "cancelReason": "",
    "notes": "Called at 5pm",
    "createdAt": "2026-11-20T10:00:00.000Z"
  }
}
```

For an ordinary booking the customer made, `adminBooking` is `null` and `displayStatus` equals `status`. **Treat `adminBooking == null` as "nothing new, behave as before".**

| Field | Values | Meaning |
|---|---|---|
| `adminBooking.bookingType` | `daily_cab`, `outstation`, `airport`, `parcel`, `rental`, `tour` | What it is. Use `bookingTypeLabel` for display. |
| `adminBooking.confirmation` | `awaiting`, `confirmed`, `cancelled` | Whether the customer (or support) has agreed. A booking cancelled any other way also reads `cancelled`. |
| `adminBooking.canConfirm` | bool | Show **Confirm**. True only while awaiting and not started. |
| `adminBooking.canCancel` | bool | Show **Cancel**. True while awaiting or confirmed and not started. |
| `adminBooking.confirmedBy` / `cancelledBy` | `"user"`, `"admin"`, `""` | Who did it. |
| `adminBooking.cancelReason` | string | Show it when cancelled. |
| `displayStatus` | `awaiting_confirmation` or the normal status | Use it as the status label instead of `status`. |

Where the field appears:

| List | Endpoint | Object |
|---|---|---|
| Rides (cab, outstation, airport, parcel) | `GET /taxi/rides` (history) | each item of `data.results`; also in the realtime ride payload |
| Rentals | `GET /taxi/users/rental-bookings` | each item of `data.results` |
| Tours | `GET /taxi/users/tour-bookings` and `/:id` | each item of `data.results` |

Which `kind` to use in the calls below:

| Booking | `kind` |
|---|---|
| Daily cab, outstation, airport, parcel (anything from the rides list) | `ride` |
| Rental | `rental` |
| Tour | `tour` |

The `id` is `rideId` for rides, `id` for rentals and tours.

---

## 2. Confirm

`POST /taxi/users/admin-bookings/:kind/:id/confirm` — no body.

```json
{
  "success": true,
  "message": "Booking confirmed",
  "data": {
    "kind": "ride",
    "id": "66f2...",
    "status": "searching",
    "displayStatus": "searching",
    "adminBooking": { "confirmation": "confirmed", "canConfirm": false, "canCancel": true, "confirmedBy": "user", "...": "..." }
  }
}
```

Replace the booking's `adminBooking` / `displayStatus` / `status` with this, or simply reload the list.

## 3. Cancel

`POST /taxi/users/admin-bookings/:kind/:id/cancel`

```json
{ "reason": "Plans changed" }
```

`reason` is optional (defaults to "Cancelled by the customer"), max 300 characters. Response is the same shape as confirm, with `confirmation: "cancelled"` and `status: "cancelled"`.

### Errors (both calls)

| Status | `message` (examples) | What to do |
|---|---|---|
| 404 | Booking not found. | It is not this customer's booking. Reload the list. |
| 409 | This booking is already confirmed. / already cancelled. | Someone acted first. Reload the list. |
| 409 | This booking has already started, so it can no longer be changed. | Hide the buttons. Reload. |
| 409 | This booking changed just now. Refresh and try again. | Reload the list. |
| 401 | | Session expired: log in again. |

---

## 4. Screens

**Booking card (all three lists).** When `adminBooking != null`:

1. A small label "Booked for you by Gogo".
2. Status chip from `displayStatus`: `awaiting_confirmation` → "Awaiting confirmation" (amber), `confirmed` → green, `cancelled` → red (show `cancelReason`).
3. If `canConfirm` → a **Confirm** button. If `canCancel` → a **Cancel** button that asks for an optional reason first.
4. After either call succeeds, reload the list (or apply the response).

**Booking details.** Show the same panel at the top. Everything else (fare, route, driver, tracking) is the normal screen for that kind.

**Do not** put an admin-made booking on the Home "current ride" screen until it actually starts: the server only makes it the current ride when the driver starts moving to the pickup, and from then on `canConfirm`/`canCancel` are false.

---

## 5. Notifications

When support creates, confirms or cancels a booking for a registered customer, the customer gets a push notification (and a row in the notification inbox). `data` values are all strings:

| `data.type` | When | Suggested action on tap |
|---|---|---|
| `admin_booking_created` | Support made a booking for you | Open the Activity list, scroll to the booking |
| `admin_booking_confirmed` | Support confirmed it | Open the booking |
| `admin_booking_cancelled` | Support cancelled it | Open the booking (shows the reason) |

Other `data` keys: `kind` (`ride` / `rental` / `tour`), `bookingType`, `bookingId`.

A ride booking that gets a driver sends the usual `ride_accepted` push.

Realtime (socket, user room): event `adminBooking:updated` with `{ kind, bookingId, event, confirmation, bookingType }`. Reload the list when you receive it.

---

## 6. Rules per kind (for your own copy and tests)

| Kind | Starts when | After confirm |
|---|---|---|
| Ride | The driver starts the trip (`status` `ongoing`) | Assigned to the driver support picked, or offered to drivers like a scheduled ride you booked. If no driver takes it, it stays confirmed for support to assign one. It is never auto-cancelled for lack of a driver. |
| Rental | The vehicle is handed over (`status` `assigned`) | `status` becomes `confirmed`. Advance, if any, is shown as before. |
| Tour | The departure date arrives | Seats were already held when support created it. Cancelling gives them back. If money was paid, support refunds it by hand. |

---

## 7. Test checklist

- [ ] Support creates a cab for your number: push arrives; the Activity list shows the booking as "Awaiting confirmation" with Confirm and Cancel.
- [ ] Tap Confirm: the chip turns green; Confirm disappears, Cancel stays.
- [ ] Support cancels with a reason: the card shows "Cancelled by Gogo: <reason>"; no buttons.
- [ ] Cancel from the app (with and without a reason): card shows "Cancelled by you".
- [ ] Book another ride while an admin booking is awaiting: both work; the admin booking is untouched.
- [ ] Rental and tour bookings made by support show the same panel.
- [ ] Log in with a phone number that had a booking made before registration: it is already in the lists.
- [ ] Two devices: confirm on one, tap Cancel on the other after: a clear 409 message, list reloads.
- [ ] A booking made by the customer themselves shows no panel and behaves exactly as before.
