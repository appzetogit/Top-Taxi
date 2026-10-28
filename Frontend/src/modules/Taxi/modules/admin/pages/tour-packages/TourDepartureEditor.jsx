import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { adminInputClass, adminLabelClass } from '../../components/ui/adminUi.js';

const toDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const TourDepartureEditor = ({ value = [], onChange }) => {
  const rows = Array.isArray(value) ? value : [];

  const updateRow = (index, field, fieldValue) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: fieldValue } : row)));
  };

  const addRow = () => {
    onChange([...rows, { startDate: '', endDate: '', totalSeats: 10, active: true }]);
  };

  const removeRow = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const isExisting = Boolean(row._id || row.id);
        return (
          <div key={row._id || row.id || index} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
              <div>
                <label className={adminLabelClass}>Start Date</label>
                <input
                  type="date"
                  value={toDateInputValue(row.startDate)}
                  onChange={(e) => updateRow(index, 'startDate', e.target.value)}
                  className={adminInputClass}
                />
              </div>
              <div>
                <label className={adminLabelClass}>End Date</label>
                <input
                  type="date"
                  value={toDateInputValue(row.endDate)}
                  onChange={(e) => updateRow(index, 'endDate', e.target.value)}
                  className={adminInputClass}
                />
              </div>
              <div>
                <label className={adminLabelClass}>Total Seats</label>
                <input
                  type="number"
                  min="1"
                  value={row.totalSeats ?? ''}
                  onChange={(e) => updateRow(index, 'totalSeats', Number(e.target.value || 0))}
                  className={adminInputClass}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"
                  title="Remove departure"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {isExisting ? (
              <p className="mt-2 text-xs font-medium text-gray-500">
                Seats booked: {row.seatsBooked ?? 0} · Seats left: {row.seatsLeft ?? Math.max(0, (row.totalSeats || 0) - (row.seatsBooked || 0))}
              </p>
            ) : null}
            <label className="mt-3 flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={row.active !== false}
                onChange={(e) => updateRow(index, 'active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active
            </label>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <Plus size={15} /> Add Departure Date
      </button>
    </div>
  );
};

export default TourDepartureEditor;
