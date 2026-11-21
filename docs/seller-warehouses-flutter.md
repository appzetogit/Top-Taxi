# Seller warehouses and courier pickup — Flutter guide (seller app, Shop)

A Shop seller adds the place(s) they ship from **inside the app**. Each warehouse is registered with the courier (Shiprocket) automatically, so parcels are collected from it. Nothing is asked at onboarding and the admin adds nothing.

- API base: `https://gogo.org.in/api/v1`. Seller routes are under `/ecommerce/seller/...`, e.g. `/ecommerce/seller/warehouses`, `/ecommerce/seller/orders/:id/shipment`.
- Auth: `Authorization: Bearer <seller token>`. Success: `{ "success": true, "message", "data": ... }`. Errors: non-2xx with the reason in `message`. **Show `message` as is.**

---

## 1. Warehouse screens

| Action | Call |
|---|---|
| List | `GET /warehouses` → `data: [warehouse]` (default first) |
| Add | `POST /warehouses` |
| Edit | `PATCH /warehouses/:id` |
| Make default | `POST /warehouses/:id/default` |
| Remove | `DELETE /warehouses/:id` |

`warehouse`:
```json
{ "id": "...", "name": "Indore main", "contactName": "Ravi", "contactPhone": "9425000001",
  "address1": "Plot 12, Road 3, Palasia Square", "address2": "", "city": "Indore",
  "state": "Madhya Pradesh", "pincode": "452001", "isDefault": true }
```

Form (add and edit send the same fields; edit may send only the ones that changed):

| Field | Rule |
|---|---|
| `name` | 2+ chars, label for the seller ("Indore main") |
| `contactName` | person who hands the parcel to the courier |
| `contactPhone` | 10-digit mobile, the courier calls it |
| `address1` | **must contain a house / flat / shop / plot / road number** (the courier rejects otherwise) |
| `address2` | optional (landmark) |
| `city`, `state` | required |
| `pincode` | 6 digits |
| `isDefault` | optional on add; the first warehouse is always the default |

Behaviour to know:
- **Add/edit is not instant**: the server registers the address with the courier first (1–3 s). Show a loader. If the courier refuses, you get `400` with `The courier did not accept this address: <reason>` — show it and let the seller fix the form. Nothing is saved in that case.
- Editing the address creates a new pickup at the courier; parcels already booked keep the old one.
- Max 10 warehouses. The first warehouse becomes the default automatically; deleting the default moves the default to the next one.
- Nothing about the courier's internal name is shown to the seller.

---

## 2. Booking a courier (orders screen)

Existing call, with an optional body:

`POST /orders/:orderId/shipment`  body `{ "warehouseId": "<id>" }` (optional — omit to use the default warehouse).

- Show a warehouse picker only if the seller has more than one; preselect the default.
- If the seller has **no warehouse**, the server answers `400`: *"Add a warehouse in your store settings first…"*. Best: check `GET /warehouses` before showing "Book courier" and send the seller to the Add warehouse screen when the list is empty.
- Response `data.shipment` now also carries `pickupLocation` and `warehouseId` (the warehouse used), besides `awb`, `courierName`, `labelUrl`.

---

## 3. Product weight and size (affects the courier charge)

Product create/update (`POST /products`, `PATCH /products/:id`) accept optional numbers:
`weightGrams` (1–100000), `lengthCm`, `breadthCm`, `heightCm` (1–500 each). Send `null` or `""` to clear. The seller menu/product responses return the same four fields (`null` when not set).

Add them to the product form ("Packed weight (g)" and "Box size L × B × H (cm)"). If left empty the server assumes 500 g and 20 × 15 × 10 cm, which can make the courier charge wrong, so encourage sellers to fill them.

---

## 4. Test checklist
- [ ] Add a warehouse with a real address → appears, marked default.
- [ ] Address without a number (e.g. "Palasia") → courier refusal message shown, nothing saved.
- [ ] Add a second, make it default, edit its address, delete it → default moves back.
- [ ] Order with no warehouse → seller is sent to Add warehouse.
- [ ] Book courier → AWB and label shown; shipment shows the warehouse used.
- [ ] Product with weight/size saved and read back.
