import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  createShareLink,
  getSharedRide,
  renderSharedRidePage,
} from '../controllers/rideShareController.js';

/**
 * Safety share: a rider sends family a live-tracking link for the trip.
 *
 *   POST /taxi/rides/:rideId/share   rider only — create/return the link
 *   GET  /taxi/share/view/:token     public web page (nginx: /track/ride/:token)
 *   GET  /taxi/share/:token          public JSON the page polls
 */
export const rideShareRouter = Router();

rideShareRouter.post('/rides/:rideId/share', authenticate(['user']), asyncHandler(createShareLink));
rideShareRouter.get('/share/view/:token', asyncHandler(renderSharedRidePage));
rideShareRouter.get('/share/:token', asyncHandler(getSharedRide));
