import React from 'react';
import { adminService } from '../../services/adminService';
import RideOperationsPage from './RideOperationsPage';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'ongoing', label: 'Ongoing' },
];

const Ongoing = () => (
  <RideOperationsPage
    title="ONGOING REQUESTS"
    breadcrumb={['Operations', 'Ongoing Requests']}
    tabs={TABS}
    loadRows={adminService.getOngoingRides}
    emptyText="No ongoing requests right now."
    autoRefresh
    serviceFilter
    onDelete={(row) => adminService.deleteOngoingRide(row.id)}
    deleteQuestion={(row) => `Cancel and delete ride ${row.requestId}? This removes it for both rider and driver.`}
  />
);

export default Ongoing;
