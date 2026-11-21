# Shop (Ecommerce) courier delivery — Flutter guide for the CUSTOMER app

Shop orders are now delivered by courier through Shiprocket (one account in front of Delhivery, DTDC, Xpressbees, Blue Dart and others). This guide lists what the **customer app** must show and send. The seller app has its own guide: `docs/seller-warehouses-flutter.md`.

- API base: `https://gogo.org.in/api/v1/ecommerce`. Auth: `Authorization: Bearer <user JWT>` (except the delivery-estimate call).
- Success: `{ "success": true, "message", "data": ... }`. Errors: non-2xx with the reason in `message` — show it as is.
- **Request shapes did not change.** Cart, calculate, checkout, create-order, cancel, return calls are the same as before. What changed is the data they return and a few rules below.
- Applies to Shop (standard) orders only. Food and Quick (rider) orders are untouched.

---

## 1. The delivery address must have a pincode and a map position (important)

The delivery fee is now worked out from the **courier's own rate for the parcel's route** (seller's warehouse pincode → customer's pincode). So every address sent to a price/checkout/order call needs:

- `zipCode`: 6 digits (`"452010"`). Without it the server cannot ask the courier and falls back to the shop's fixed fee.
- `location` / coordinates: as today (the order is rejected with *"This address has no location saved. Please re-select it on the map."* without them).

Make the pincode a required field in the address form (validate `^[1-9]\d{5}$`), and **re-price whenever the address or the cart changes**.

---

## 2. Delivery fee on the cart and checkout screens

Calls (unchanged): `POST /orders/calculate` (one store) and `POST /orders/checkout/calculate` (several stores).

Body as you already send it, e.g.:
```json
{ "sellerId": "...", "items": [{ "itemId": "...", "quantity": 2 }],
  "address": { "street": "...", "city": "Indore", "state": "Madhya Pradesh", "zipCode": "452010",
               "location": { "type": "Point", "coordinates": [75.89, 22.75] }, "phone": "..." },
  "couponCode": "OPTIONAL" }
```

`data.pricing` (fields you already use): `subtotal, deliveryFee, deliveryFeeGst, platformFee, tax, discount, total`.
New/changed meaning:

| Field | Meaning |
|---|---|
| `deliveryFee` | What the customer pays for delivery. Now follows the courier's rate for **this route and weight** (Indore → Indore is cheaper than Indore → Delhi). `0` when the order is above the store's free-delivery amount: show **"Free delivery"**. |
| `deliveryFeeGst` | 18% GST on `deliveryFee`. Show it inside "Delivery fee" or as its own line, as you do today. |
| `deliveryFeeBreakdown.source` | `"courier"` = priced from the courier's live rate. Anything else (`"default"`, `"default_unmatched_range"`, `"distance"`) = the shop's fixed fee. **Same UI for both.** |
| `deliveryFeeBreakdown.courierName` | Present when `source = "courier"` (e.g. "DTDC Surface"). Optional to show ("Delivered by DTDC"). |
| `deliveryFeeBreakdown.estimatedDays` | Courier's estimated delivery days (e.g. 4). Optional: "Delivery in about 4 days". |
| `deliveryFeeBreakdown.courierRate`, `weightGrams` | **Internal. Do not show them** (courierRate is what the store pays, not the customer's fee). |

Rules:
- **Never calculate the fee in the app.** Show what the server returns. The order is charged exactly the `total` the server returned for the same cart and address (the rate is cached on the server for 30 minutes, so quote and charge agree).
- `total = subtotal + deliveryFee + deliveryFeeGst + platformFee + tax − discount`. Use it as the amount to pay.
- Order total above zero is required; the server refuses otherwise.

---

## 3. Delivery time estimate on the product page

`GET /catalog/delivery-estimate?pincode=452010` (no login needed) →
```json
{ "pincode": "452010", "serviceable": true, "minDays": 4, "maxDays": 4,
  "fromDate": "2026-11-25", "toDate": "2026-11-25", "source": "courier" }
```
- `source: "courier"` = the courier's real estimate for that pincode; `"default"` = the store's standard window.
- `serviceable: false` = the courier does not deliver there: show "Delivery not available at this pincode".
- Call it when the customer enters or changes the pincode; cache per pincode in the app for the session.

---

## 4. Cash on delivery (COD)

- COD is chosen with `paymentMethod: "cash"` at order creation, as today.
- The courier's delivery person now collects the **full order total** (`order.payment.amountDue` = `order.pricing.total`: items, delivery fee, GST, platform fee, minus discount). Earlier only the items were collected; that is fixed on the server.
- On the order screen and confirmation show: **"Pay ₹{payment.amountDue} in cash to the delivery person"** while `payment.status == "cod_pending"`. After delivery it becomes `"paid"`.
- Nothing else to build: no OTP or QR for courier COD.

---

## 5. Order status and tracking (the main new screen work)

`GET /orders/:orderId` and `GET /orders` return the order. For Shop orders it now carries `shipment` (null until a courier is booked):

```json
"shipment": {
  "awb": "7D141280197",
  "courierName": "DTDC Surface",
  "etd": "2026-11-25T00:00:00.000Z",
  "status": "in_transit",
  "ndr": { "attempts": 1, "lastReason": "Customer not available", "pending": true },
  "rto": { "initiatedAt": "..." }
}
```
Fields you may show: `awb` (tracking number), `courierName`, `etd` (expected delivery date), `status`, and `ndr`/`rto` when present.
**Ignore the other keys** (`labelUrl`, `providerOrderId`, `shipmentId`, `warehouseId`, `pickupLocation`, `trackingHistory`): they are for the store; the label contains the store's details.

### Order status (`orderStatus`) for a Shop order
| `orderStatus` | Show |
|---|---|
| `created` | "Waiting for the store to accept" |
| `confirmed`, `preparing` | "Store is packing your order" |
| `ready_for_pickup` | "Packed. {courierName} will pick it up soon" (courier booked, `shipment.awb` present) |
| `picked_up` | "Shipped" (courier has it) |
| `delivered` | "Delivered" |
| `cancelled_by_user / _seller / _admin` | "Cancelled" + `cancellationReason` |

### Courier status (`shipment.status`) for the timeline
`manifested` / `pickup_generated` (pickup booked) → `picked_up` → `in_transit` → `out_for_delivery` → `delivered`.
Problem states: `undelivered` (delivery attempt failed; `ndr.lastReason`, `ndr.attempts`), `rto_initiated` / `rto_in_transit` / `rto_delivered` (parcel is going back to the store), `cancelled`.
Treat any value you do not know as "In transit" (show the raw text in small print); the list can grow.

Suggested UI: a vertical timeline with the steps above, the courier name and AWB, and "Expected by {etd}". For `undelivered` show "Delivery attempt failed: {ndr.lastReason}. The courier will try again" (the store decides re-attempt or return). For `rto_*` show "Your order is being returned to the store".

### How updates reach the app
- **Push notification** when the courier is booked: `data.type = "shipment_booked"`, with `orderId` and `awb`. Title "Your order is packed". Open the order screen on tap.
- Later changes (picked up, in transit, delivered, failed attempt) are updated on the server within a minute or two. **There is no per-status push yet.** So refresh the order when the screen opens, on pull-to-refresh, and every 60–90 seconds while the tracking screen is open.
- There is no separate customer "tracking events" API; the timeline is built from `orderStatus` and `shipment.status`. If you also want the courier's full scan history (city-by-city), ask the backend to add `GET /orders/:id/tracking`.
- Optional: a "Track on courier site" button opening `https://shiprocket.co/tracking/{awb}` in the browser (check it opens correctly before shipping this).

---

## 6. Cancelling

`PATCH /orders/:orderId/cancel` (unchanged). New rule: once a courier is booked (`shipment.awb` present) the customer **cannot cancel**; the server answers `400` *"This order is already with the courier. Once it arrives you can return it."* Hide the Cancel button when `shipment.awb` is set or `orderStatus` is `picked_up` / `delivered`, and just show the server's message if it is tapped anyway. Before the courier is booked, cancelling works as before.

---

## 7. Returns after delivery

Unchanged calls: `GET /orders/:orderId/returns` (eligibility + items + past returns) and `POST /orders/:orderId/returns`. When an admin approves a return with pickup, a courier reverse pickup is booked automatically. Show return `status` (`requested`, `approved`, `rejected`, `received`, `refunded`, `replaced`) as you do today. Nothing new to build for the courier.

---

## 8. Test checklist
- [ ] Address form requires a valid 6-digit pincode and a map position.
- [ ] Same cart, Indore address vs a far-state address: delivery fee differs; both quotes equal the amount charged.
- [ ] Cart above the store's free-delivery amount shows "Free delivery".
- [ ] Changing the address or quantity re-prices.
- [ ] `deliveryFeeBreakdown.source` other than `"courier"` renders exactly like `"courier"` (no crash, no missing text).
- [ ] Product page: pincode → delivery date; non-serviceable pincode shows the message.
- [ ] COD order shows "Pay ₹{amountDue} in cash"; amount equals the order total.
- [ ] Order screen shows the right text for each `orderStatus`; unknown `shipment.status` does not break the timeline.
- [ ] Push `shipment_booked` opens the order.
- [ ] Cancel button is hidden once the courier is booked; the server message is shown if it is tapped.
