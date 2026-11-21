import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, CheckCircle2, Loader2, MapPin, Pencil, Phone, Plus, Star, Trash2, User, Warehouse, X } from "lucide-react"
import { toast } from "sonner"
import useSellerBackNavigation from "@ecommerce/hooks/useSellerBackNavigation"
import { sellerAPI } from "@ecommerce/services/api"

/*
 * Warehouses: where the courier collects this store's parcels. Each one is
 * registered with the courier when it is saved, so the store never has to set
 * anything up with the courier by hand.
 */

const EMPTY = { name: "", contactName: "", contactPhone: "", address1: "", address2: "", city: "", state: "", pincode: "" }
const message = (error, fallback) => error?.response?.data?.message || fallback

const Field = ({ label, hint, error, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
    {children}
    {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
  </label>
)

const inputClass = (bad) =>
  `w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:ring-2 ${
    bad ? "border-red-300 focus:ring-red-100" : "border-gray-200 focus:border-gray-400 focus:ring-gray-100"
  }`

const validate = (form) => {
  const errors = {}
  if (form.name.trim().length < 2) errors.name = "Give the warehouse a name"
  if (form.contactName.trim().length < 2) errors.contactName = "Enter the contact person's name"
  if (!/^[6-9]\d{9}$/.test(form.contactPhone)) errors.contactPhone = "Enter a valid 10-digit mobile number"
  if (form.address1.trim().length < 5) errors.address1 = "Enter the address with the house, flat or road number"
  else if (!/\d/.test(form.address1)) errors.address1 = "Include a house, flat, shop or road number (the courier needs it)"
  if (!form.city.trim()) errors.city = "Enter the city"
  if (!form.state.trim()) errors.state = "Enter the state"
  if (!/^[1-9]\d{5}$/.test(form.pincode)) errors.pincode = "Enter a 6-digit pincode"
  return errors
}

const WarehouseForm = ({ initial, onClose, onSaved }) => {
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(() => (initial ? { ...EMPTY, ...initial } : EMPTY))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState("")

  const set = (key) => (event) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [key]: key === "contactPhone" ? value.replace(/\D/g, "").slice(0, 10) : key === "pincode" ? value.replace(/\D/g, "").slice(0, 6) : value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setServerError("")
  }

  const submit = async (event) => {
    event.preventDefault()
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setServerError("")
    try {
      const body = {
        name: form.name.trim(), contactName: form.contactName.trim(), contactPhone: form.contactPhone,
        address1: form.address1.trim(), address2: form.address2.trim(), city: form.city.trim(), state: form.state.trim(), pincode: form.pincode,
      }
      if (editing) await sellerAPI.updateWarehouse(initial.id, body)
      else await sellerAPI.createWarehouse(body)
      onSaved(editing ? "Warehouse updated" : "Warehouse added")
    } catch (error) {
      setServerError(message(error, "Could not save the warehouse. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={saving ? undefined : onClose}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
          <h2 className="text-base font-bold text-gray-900">{editing ? "Edit warehouse" : "Add a warehouse"}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <Field label="Warehouse name" error={errors.name}>
            <input value={form.name} onChange={set("name")} maxLength={60} placeholder="e.g. Indore main store" className={inputClass(errors.name)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person" error={errors.contactName} hint="Who hands the parcel to the courier">
              <input value={form.contactName} onChange={set("contactName")} maxLength={80} className={inputClass(errors.contactName)} />
            </Field>
            <Field label="Contact mobile" error={errors.contactPhone} hint="The courier calls this number">
              <input value={form.contactPhone} onChange={set("contactPhone")} inputMode="numeric" placeholder="10 digits" className={inputClass(errors.contactPhone)} />
            </Field>
          </div>
          <Field label="Address" error={errors.address1} hint="With house / flat / shop / road number, e.g. Plot 12, Road 3, Palasia">
            <input value={form.address1} onChange={set("address1")} maxLength={200} className={inputClass(errors.address1)} />
          </Field>
          <Field label="Landmark (optional)">
            <input value={form.address2} onChange={set("address2")} maxLength={200} className={inputClass(false)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" error={errors.city}><input value={form.city} onChange={set("city")} className={inputClass(errors.city)} /></Field>
            <Field label="State" error={errors.state}><input value={form.state} onChange={set("state")} className={inputClass(errors.state)} /></Field>
            <Field label="Pincode" error={errors.pincode}><input value={form.pincode} onChange={set("pincode")} inputMode="numeric" placeholder="6 digits" className={inputClass(errors.pincode)} /></Field>
          </div>
          {editing ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Changing the address applies to new parcels. Parcels already booked are collected from the old address.</p> : null}
          {serverError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{serverError}</p> : null}
        </div>

        <div className="sticky bottom-0 flex gap-3 border-t border-gray-100 bg-white px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-60">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving with the courier...</> : editing ? "Save changes" : "Add warehouse"}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Warehouses() {
  const goBack = useSellerBackNavigation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [formFor, setFormFor] = useState(null) // null closed, {} new, warehouse = edit
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await sellerAPI.getWarehouses()
      setItems(res?.data?.data || [])
      setError("")
    } catch (err) {
      setError(message(err, "Could not load your warehouses."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saved = (text) => {
    setFormFor(null)
    toast.success(text)
    load()
  }

  const makeDefault = async (warehouse) => {
    setBusyId(warehouse.id)
    try {
      await sellerAPI.setDefaultWarehouse(warehouse.id)
      toast.success(`${warehouse.name} is now the default`)
      await load()
    } catch (err) {
      toast.error(message(err, "Could not change the default."))
    } finally {
      setBusyId("")
    }
  }

  const remove = async (warehouse) => {
    if (!window.confirm(`Remove "${warehouse.name}"? Parcels already booked from it are not affected.`)) return
    setBusyId(warehouse.id)
    try {
      await sellerAPI.deleteWarehouse(warehouse.id)
      toast.success("Warehouse removed")
      await load()
    } catch (err) {
      toast.error(message(err, "Could not remove the warehouse."))
    } finally {
      setBusyId("")
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FB] pb-24">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-4">
        <button onClick={goBack} className="rounded-full p-2 hover:bg-gray-100" aria-label="Back"><ArrowLeft className="h-5 w-5 text-gray-900" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-gray-900">Warehouses</h1>
          <p className="text-xs text-gray-500">Where the courier collects your parcels</p>
        </div>
        <button onClick={() => setFormFor({})} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-black">
          <Plus className="h-4 w-4" /> Add
        </button>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-gray-300" /></div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
            <Warehouse className="mx-auto h-10 w-10 text-gray-300" />
            <h2 className="mt-3 text-base font-bold text-gray-800">Add your first warehouse</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">The courier needs to know where to collect your parcels from. Add the address once and it is used for every order you ship.</p>
            <button onClick={() => setFormFor({})} className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-black"><Plus className="h-4 w-4" /> Add warehouse</button>
          </div>
        ) : (
          items.map((warehouse) => (
            <article key={warehouse.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${warehouse.isDefault ? "border-emerald-300" : "border-gray-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700"><Warehouse className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-gray-900">{warehouse.name}</h3>
                    {warehouse.isDefault ? <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Default</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setFormFor(warehouse)} disabled={busyId === warehouse.id} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(warehouse)} disabled={busyId === warehouse.id} className="rounded-lg p-2 text-red-500 hover:bg-red-50" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-700">
                <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span>{[warehouse.address1, warehouse.address2].filter(Boolean).join(", ")}<br />{warehouse.city}, {warehouse.state} - {warehouse.pincode}</span>
                </p>
                <p className="flex items-center gap-2"><User className="h-4 w-4 shrink-0 text-gray-400" />{warehouse.contactName}</p>
                <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-gray-400" />{warehouse.contactPhone}</p>
              </div>

              {!warehouse.isDefault ? (
                <button onClick={() => makeDefault(warehouse)} disabled={busyId === warehouse.id} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                  {busyId === warehouse.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />} Make default
                </button>
              ) : null}
            </article>
          ))
        )}
      </main>

      {formFor ? <WarehouseForm initial={formFor.id ? formFor : null} onClose={() => setFormFor(null)} onSaved={saved} /> : null}
    </div>
  )
}
