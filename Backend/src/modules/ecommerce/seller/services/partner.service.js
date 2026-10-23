/**
 * Ecommerce seller sign-up: one phone check that says where the applicant
 * stands, then the application. Mirrors modules/quickCommerce's
 * partner.service.js, scoped to this module's own Seller model and its
 * registration schema (see seller.validator.js / seller.service.js
 * registerSeller).
 *
 *   new       no seller on this number        -> fill in the application
 *   pending   applied, waiting for review     -> see what is still missing, update it
 *   rejected  turned down, with a reason      -> fix and resubmit
 *   approved  live                            -> signed in as normal
 *
 * Every state except approved gets an ONBOARDING token instead of a session,
 * signed with a secret derived from (but different to) the access-token
 * secret, so it opens only the application endpoints below.
 */
import jwt from 'jsonwebtoken';
import { config } from '../../../../config/env.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { createOrUpdateOtp, verifyOtp } from '../../../../core/otp/otp.service.js';
import { OTP_SERVICES } from '../../../../core/otp/otpRateLimit.service.js';
import { Seller } from '../models/seller.model.js';
import { registerSeller, uploadSellerAttachment } from './seller.service.js';
import { issueSellerSession } from './sellerLogin.service.js';

const ONBOARDING_TTL = '6h';
const OTP_SCOPE = 'ecommerce:partner';
const onboardingSecret = () => `${config.jwtAccessSecret}:ecommerce-partner-onboarding`;

const last10Of = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const shouldExposeOtp = () => config.nodeEnv !== 'production';

const signOnboardingToken = (phone) => jwt.sign(
    { purpose: 'ecommerce_partner_onboarding', phone: last10Of(phone) },
    onboardingSecret(),
    { expiresIn: ONBOARDING_TTL },
);

const readOnboardingToken = (token) => {
    try {
        const decoded = jwt.verify(String(token || ''), onboardingSecret());
        if (decoded?.purpose !== 'ecommerce_partner_onboarding' || !decoded.phone) throw new Error('wrong purpose');
        return decoded.phone;
    } catch {
        throw new ValidationError('Your sign-up session has expired. Verify your phone number again.');
    }
};

const findSellerByPhone = (phone) => {
    const last10Digits = last10Of(phone);
    if (last10Digits.length !== 10) return null;
    return Seller.findOne({ ownerPhoneLast10: last10Digits });
};

const stateOf = (seller) => {
    if (!seller) return 'new';
    if (seller.status === 'approved') return 'approved';
    if (seller.status === 'rejected') return 'rejected';
    return 'pending';
};

// ------------------------------------------------------------------ phone ---

export async function requestPartnerOtp({ phone }) {
    if (last10Of(phone).length !== 10) throw new ValidationError('Enter a valid 10-digit mobile number.');
    const otp = await createOrUpdateOtp(phone, OTP_SCOPE, { service: OTP_SERVICES.ECOMMERCE });
    return shouldExposeOtp() ? { otp } : {};
}

/** What the applicant sees about their own application, for the form and status page. */
function describeApplication(seller) {
    if (!seller) return { application: null };
    const s = seller.toObject ? seller.toObject() : seller;
    const loc = s.location || {};
    return {
        application: {
            id: String(s._id),
            status: s.status,
            rejectionReason: s.status === 'rejected' ? (s.rejectionReason || '') : '',
            submittedAt: s.createdAt || null,
            restaurantName: s.sellerName || '',
            ownerName: s.ownerName || '',
            ownerEmail: s.ownerEmail || '',
            ownerPhone: s.ownerPhone || '',
            addressLine1: loc.addressLine1 || '',
            addressLine2: loc.addressLine2 || '',
            area: loc.area || '',
            city: loc.city || '',
            state: loc.state || '',
            pincode: loc.pincode || '',
            landmark: loc.landmark || '',
            formattedAddress: loc.formattedAddress || '',
            latitude: typeof loc.latitude === 'number' ? loc.latitude : null,
            longitude: typeof loc.longitude === 'number' ? loc.longitude : null,
            panNumber: s.panNumber || '',
            nameOnPan: s.nameOnPan || '',
            panImage: s.panImage || '',
            gstRegistered: s.gstRegistered === true,
            gstNumber: s.gstNumber || '',
            gstImage: s.gstImage || '',
            fssaiNumber: s.fssaiNumber || '',
            fssaiImage: s.fssaiImage || '',
            // No dedicated store-photo trio on this schema; mapped onto the
            // seller's own profile/cover/gallery image fields (see submitApplication).
            storeFrontImage: s.profileImage || '',
            storeInsideImage: s.coverImage || '',
            storeSignboardImage: Array.isArray(s.galleryImages) ? (s.galleryImages[0] || '') : '',
            accountHolderName: s.accountHolderName || '',
            accountNumber: s.accountNumber || '',
            ifscCode: s.ifscCode || '',
            upiId: s.upiId || '',
        },
    };
}

export async function verifyPartnerOtp({ phone, otp }) {
    const result = await verifyOtp(phone, otp, OTP_SCOPE);
    if (!result.valid) throw new ValidationError(result.reason || 'That code is not right. Try again.');

    const seller = await findSellerByPhone(phone);
    const state = stateOf(seller);
    const base = { state, phone: last10Of(phone), ...describeApplication(seller) };

    if (state === 'approved') {
        return { ...base, session: await issueSellerSession(seller) };
    }
    return { ...base, onboardingToken: signOnboardingToken(phone) };
}

// ------------------------------------------------------------ application ---

export async function getMyApplication(token) {
    const phone = readOnboardingToken(token);
    const seller = await findSellerByPhone(phone);
    return { state: stateOf(seller), phone, ...describeApplication(seller) };
}

export async function uploadPartnerDocument(token, file) {
    readOnboardingToken(token);
    if (!file) throw new ValidationError('Choose a file to upload.');
    return uploadSellerAttachment(file, 'others');
}

const str = (v) => (v === undefined || v === null ? undefined : String(v).trim());

/**
 * Fields an applicant may set on a pending or rejected application. Status,
 * commission, zone and anything an admin owns are deliberately absent.
 */
function applicationUpdate(body = {}) {
    const set = {};
    const direct = {
        restaurantName: 'sellerName',
        ownerName: 'ownerName',
        ownerEmail: 'ownerEmail',
        panNumber: 'panNumber',
        nameOnPan: 'nameOnPan',
        panImage: 'panImage',
        gstNumber: 'gstNumber',
        gstImage: 'gstImage',
        fssaiNumber: 'fssaiNumber',
        fssaiImage: 'fssaiImage',
        storeFrontImage: 'profileImage',
        storeInsideImage: 'coverImage',
        accountHolderName: 'accountHolderName',
        accountNumber: 'accountNumber',
        ifscCode: 'ifscCode',
        upiId: 'upiId',
    };
    for (const [from, to] of Object.entries(direct)) {
        const value = str(body[from]);
        if (value !== undefined) set[to] = from === 'panNumber' || from === 'ifscCode' ? value.toUpperCase() : value;
    }
    if (body.storeSignboardImage !== undefined) {
        const value = str(body.storeSignboardImage);
        set.galleryImages = value ? [value] : [];
    }
    if (body.gstRegistered !== undefined) {
        set.gstRegistered = body.gstRegistered === true || body.gstRegistered === 'true';
    }
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (body.latitude !== undefined && body.longitude !== undefined) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new ValidationError('Pick the store location on the map.');
        }
        set['location.latitude'] = lat;
        set['location.longitude'] = lng;
        set['location.coordinates'] = [lng, lat];
    }
    for (const field of ['addressLine1', 'addressLine2', 'area', 'city', 'state', 'pincode', 'landmark', 'formattedAddress']) {
        const value = str(body[field]);
        if (value !== undefined) set[`location.${field}`] = value;
    }
    return set;
}

/**
 * Submit a new application, or update / resubmit a pending or rejected one.
 * The phone number always comes from the token.
 */
export async function submitApplication(token, body = {}) {
    const phone = readOnboardingToken(token);
    const seller = await findSellerByPhone(phone);

    if (!seller) {
        const registered = await registerSeller(
            {
                sellerName: body.restaurantName,
                ownerName: body.ownerName,
                ownerEmail: body.ownerEmail,
                ownerPhone: phone,
                primaryContactNumber: phone,
                addressLine1: body.addressLine1,
                addressLine2: body.addressLine2,
                area: body.area,
                city: body.city,
                state: body.state,
                pincode: body.pincode,
                landmark: body.landmark,
                formattedAddress: body.formattedAddress,
                latitude: body.latitude !== undefined ? String(body.latitude) : undefined,
                longitude: body.longitude !== undefined ? String(body.longitude) : undefined,
                panNumber: body.panNumber,
                nameOnPan: body.nameOnPan,
                panImage: body.panImage,
                gstRegistered: body.gstRegistered === true || body.gstRegistered === 'true',
                gstNumber: body.gstNumber,
                gstImage: body.gstImage,
                fssaiNumber: body.fssaiNumber,
                fssaiImage: body.fssaiImage,
                profileImage: body.storeFrontImage,
                coverImage: body.storeInsideImage,
                galleryImages: body.storeSignboardImage ? String(body.storeSignboardImage) : undefined,
                accountHolderName: body.accountHolderName,
                accountNumber: body.accountNumber,
                ifscCode: body.ifscCode,
            },
            {},
        );
        return getMyApplication(token);
    }

    if (seller.status === 'approved') {
        throw new ValidationError('This store is already approved. Update its details from the seller dashboard.');
    }

    const set = applicationUpdate(body);
    await Seller.updateOne(
        { _id: seller._id },
        { $set: { ...set, status: 'pending' }, $unset: { rejectionReason: 1, rejectedAt: 1 } },
    );
    return getMyApplication(token);
}
