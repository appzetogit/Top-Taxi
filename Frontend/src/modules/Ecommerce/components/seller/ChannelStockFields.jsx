import React from "react"
import { toStockValue } from "./channels"

const inputCls =
  "w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums disabled:bg-gray-100 disabled:text-gray-400"

/** Draft (form string) helpers for the product's stock field. */
export const emptyChannelDraft = () => ""
export const channelDraftFrom = (v) => (v === null || v === undefined ? "" : String(v))
export const channelDraftToPayload = (draft) => toStockValue(draft)

/**
 * Product-level stock / low-stock threshold.
 */
export function ProductChannelFields({ stock, onStock, threshold, onThreshold }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Stock</p>
        <p className="text-[11px] text-gray-500">Leave stock empty to not count it (always in stock).</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">Stock</label>
          <input type="number" min="0" className={inputCls} value={stock} placeholder="Not counted"
            onChange={(e) => onStock(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">Low-stock alert at</label>
          <input type="number" min="0" className={inputCls} value={threshold} placeholder="None"
            onChange={(e) => onThreshold(e.target.value)} />
        </div>
      </div>
    </div>
  )
}
