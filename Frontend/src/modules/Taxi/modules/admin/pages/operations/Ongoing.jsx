import React from 'react';
import { adminService } from '../../services/adminService';
import RideOperationsPage from './RideOperationsPage';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'ongoing', label: 'Ongoing' },
];

const TYPE_FILTER = {
  key: 'bookingType',
  label: 'Booking type',
  options: [
    { value: '', label: 'All types' },
    { value: 'daily_cab', label: 'Daily Cab' },
    { value: 'outstation', label: 'Outstation' },
    { value: 'airport', label: 'Airport Taxi' },
    { value: 'parcel', label: 'Parcel Delivery' },
  ],
};

const Ongoing = () => (
  <RideOperationsPage
    title="ONGOING REQUESTS"
    breadcrumb={['Operations', 'Ongoing Requests']}
    tabs={TABS}
    loadRows={adminService.getOngoingRides}
    emptyText="No ongoing requests right now."
    autoRefresh
    summary="active"
    typeFilter={TYPE_FILTER}
    onDelete={(row) => adminService.deleteOngoingRide(row.id)}
    deleteQuestion={(row) => `Cancel and delete ride ${row.requestId}? This removes it for both rider and driver.`}
  />
);

export default Ongoing;
