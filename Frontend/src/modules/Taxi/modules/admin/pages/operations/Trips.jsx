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

const TYPE_FILTER = {
  key: 'bookingType',
  label: 'Booking type',
  options: [
    { value: '', label: 'All types' },
    { value: 'daily_cab', label: 'Daily Cab' },
    { value: 'outstation', label: 'Outstation' },
    { value: 'airport', label: 'Airport Taxi' },
  ],
};

const LIVE = ['UPCOMING', 'ACCEPTED', 'ONGOING'];

// A ride still searching or on its way is cancelled first; the ride record is
// kept for earnings and reports, it just leaves this list.
const deleteQuestion = (row) =>
  LIVE.includes(row.tripStatus)
    ? `Trip ${row.requestId} is still active. Cancel it and delete it from the list?`
    : `Delete trip ${row.requestId} from the list?`;

const Trips = () => (
  <RideOperationsPage
    title="RIDE REQUESTS"
    breadcrumb={['Operations', 'Ride Requests']}
    tabs={TABS}
    loadRows={adminService.getRideRequests}
    typeFilter={TYPE_FILTER}
    emptyText="No ride requests found."
    onDelete={(row) => adminService.deleteTripRequest(row.id)}
    deleteQuestion={deleteQuestion}
  />
);

export default Trips;
