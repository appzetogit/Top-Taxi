import React from 'react';
import { adminService } from '../../services/adminService';
import RideOperationsPage from './RideOperationsPage';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'on_trip', label: 'On Trip' },
];

const EXTRA_COLUMNS = [
  {
    header: 'Receiver',
    render: (row) =>
      row.parcel?.receiverName ? (
        <div className="min-w-[120px]">
          <p className="font-bold text-slate-800">{row.parcel.receiverName}</p>
          {row.parcel.receiverMobile && <p className="text-[12px] text-slate-500">{row.parcel.receiverMobile}</p>}
        </div>
      ) : (
        '--'
      ),
  },
  {
    header: 'Parcel',
    render: (row) => (
      <div className="min-w-[100px]">
        <p className="font-semibold text-slate-700">{row.parcel?.category || '--'}</p>
        {row.parcel?.weight && <p className="text-[12px] text-slate-500">{row.parcel.weight}</p>}
      </div>
    ),
  },
];

const Deliveries = () => (
  <RideOperationsPage
    title="DELIVERY REQUESTS"
    breadcrumb={['Operations', 'Delivery Requests']}
    tabs={TABS}
    loadRows={adminService.getDeliveries}
    searchPlaceholder="Search id, sender, receiver, driver"
    emptyText="No delivery requests found."
    extraColumns={EXTRA_COLUMNS}
  />
);

export default Deliveries;
