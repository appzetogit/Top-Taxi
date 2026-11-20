import React, { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { userService } from '../../services/userService';

/*
 * A booking Gogo support made for the customer. They answer it here, as they would
 * a booking of their own: confirm it, or cancel it, until it starts. The server
 * decides whether it still can be (adminBooking.canConfirm / canCancel).
 */
const kindOf = (type) => (type === 'parcel' ? 'ride' : type);

const AdminBookingPanel = ({ type, id, adminBooking, onChanged }) => {
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!adminBooking) return null;

  const stop = (event) => event.stopPropagation();
  const kind = kindOf(type);
  const { confirmation, canConfirm, canCancel, cancelledBy, cancelReason } = adminBooking;

  const run = async (action) => {
    setBusy(action);
    setError('');
    try {
      if (action === 'confirm') await userService.confirmAdminBooking(kind, id);
      else await userService.cancelAdminBooking(kind, id, reason.trim());
      setAsking(false);
      onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div
      className="mt-3 rounded-xl border border-amber-100 bg-amber-50/70 p-3"
      onClick={stop}
      onKeyDown={stop}
      role="presentation"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">Booked for you by Gogo</p>

      {confirmation === 'awaiting' ? (
        <p className="mt-1 text-[12px] font-medium text-slate-700">Please confirm this booking, or cancel it if you do not need it.</p>
      ) : null}
      {confirmation === 'confirmed' ? (
        <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
          <CheckCircle2 size={13} /> Confirmed
        </p>
      ) : null}
      {confirmation === 'cancelled' ? (
        <p className="mt-1 text-[12px] font-medium text-rose-700">
          Cancelled{cancelledBy === 'user' ? ' by you' : cancelledBy === 'admin' ? ' by Gogo' : ''}
          {cancelReason ? `: ${cancelReason}` : ''}
        </p>
      ) : null}

      {asking ? (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] outline-none focus:border-slate-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run('cancel')}
              disabled={Boolean(busy)}
              className="flex-1 rounded-xl bg-rose-600 py-2 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {busy === 'cancel' ? 'Cancelling...' : 'Yes, cancel booking'}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={Boolean(busy)}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-[12px] font-bold text-slate-700 disabled:opacity-60"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (canConfirm || canCancel) ? (
        <div className="mt-2 flex gap-2">
          {canConfirm ? (
            <button
              type="button"
              onClick={() => run('confirm')}
              disabled={Boolean(busy)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-[12px] font-bold text-white disabled:opacity-60"
            >
              {busy === 'confirm' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={Boolean(busy)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white py-2 text-[12px] font-bold text-rose-600 disabled:opacity-60"
            >
              <XCircle size={13} /> Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] font-semibold text-rose-600">{error}</p> : null}
    </div>
  );
};

export default AdminBookingPanel;
