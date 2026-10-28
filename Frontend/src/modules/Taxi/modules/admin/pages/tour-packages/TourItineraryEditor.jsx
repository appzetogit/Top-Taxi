import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { adminInputClass, adminLabelClass } from '../../components/ui/adminUi.js';

const TourItineraryEditor = ({ value = [], onChange }) => {
  const rows = Array.isArray(value) ? value : [];

  const updateRow = (index, field, fieldValue) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: fieldValue } : row)));
  };

  const addRow = () => {
    onChange([...rows, { day: rows.length + 1, title: '', description: '' }]);
  };

  const removeRow = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-700">Day {row.day ?? index + 1}</p>
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
              title="Remove day"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-[100px_1fr]">
            <div>
              <label className={adminLabelClass}>Day #</label>
              <input
                type="number"
                min="1"
                value={row.day ?? ''}
                onChange={(e) => updateRow(index, 'day', Number(e.target.value || 0))}
                className={adminInputClass}
              />
            </div>
            <div>
              <label className={adminLabelClass}>Title</label>
              <input
                type="text"
                value={row.title || ''}
                onChange={(e) => updateRow(index, 'title', e.target.value)}
                className={adminInputClass}
                placeholder="Arrival & Beach Walk"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={adminLabelClass}>Description</label>
            <textarea
              rows={2}
              value={row.description || ''}
              onChange={(e) => updateRow(index, 'description', e.target.value)}
              className={adminInputClass}
              placeholder="What happens on this day"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <Plus size={15} /> Add Day
      </button>
    </div>
  );
};

export default TourItineraryEditor;
