/**
 * Ecommerce seller sign-up. Mounted at /v1/ecommerce/partner, alongside
 * sellerLogin.routes.js (sign-in for an already-approved seller).
 *
 *   POST /request-otp          { phone }                app sign-up/sign-in, step 1
 *   POST /verify-otp           { phone, otp }          step 2 -> onboarding token, or a
 *                                                        session if already approved
 *   GET  /application          (onboarding token)        the saved application
 *   POST /application          (onboarding token)        submit, update or resubmit
 *   POST /upload               (onboarding token)        one document or photo -> { url }
 *   POST /web-login/request-otp { email, password }     dashboard sign-in, step 1
 *   POST /web-login/resend-otp  { ticket, email }
 *   POST /web-login/verify-otp  { ticket, email, otp }  step 2 -> session
 */
import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authRateLimiter } from '../../../../middleware/rateLimit.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import * as partner from '../services/partner.service.js';
import * as sellerLogin from '../services/sellerLogin.service.js';

const router = express.Router();

const bearer = (req) => {
    const dedicated = String(req.headers['x-onboarding-token'] || '').trim();
    if (dedicated) return dedicated;
    const header = String(req.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7) : '';
};

const handle = (fn) => async (req, res) => {
    try {
        const { status = 200, message = 'OK', data } = await fn(req);
        return sendResponse(res, status, message, data);
    } catch (err) {
        const code = Number(err?.statusCode) || 500;
        return sendError(res, code, code < 500 ? err.message : 'Something went wrong. Please try again.');
    }
};

router.post('/request-otp', authRateLimiter, handle(async (req) => ({
    message: 'OTP sent',
    data: { phone: req.body?.phone, ...(await partner.requestPartnerOtp(req.body || {})) },
})));

router.post('/verify-otp', authRateLimiter, handle(async (req) => ({
    message: 'Verified',
    data: await partner.verifyPartnerOtp(req.body || {}),
})));

router.get('/application', handle(async (req) => ({
    message: 'Application',
    data: await partner.getMyApplication(bearer(req)),
})));

router.post('/application', handle(async (req) => ({
    message: 'Application submitted',
    data: await partner.submitApplication(bearer(req), req.body || {}),
})));

router.post('/upload', upload.single('file'), handle(async (req) => ({
    message: 'Uploaded',
    data: await partner.uploadPartnerDocument(bearer(req), req.file),
})));

router.post('/web-login/request-otp', authRateLimiter, handle(async (req) => ({
    message: 'OTP sent to your registered mobile number',
    data: await sellerLogin.requestSellerWebLoginOtp(req.body || {}),
})));

router.post('/web-login/resend-otp', authRateLimiter, handle(async (req) => ({
    message: 'OTP sent to your registered mobile number',
    data: await sellerLogin.resendSellerWebLoginOtp(req.body || {}),
})));

router.post('/web-login/verify-otp', authRateLimiter, handle(async (req) => ({
    message: 'Signed in',
    data: await sellerLogin.verifySellerWebLoginOtp(req.body || {}),
})));

export default router;
