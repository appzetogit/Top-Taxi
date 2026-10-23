/**
 * Ecommerce seller session issuance, and the web-portal login (owner email +
 * password, then OTP) for the dashboard. Phone+OTP sign-up/sign-in lives in
 * partner.service.js, which calls issueSellerSession from here once an
 * applicant's state resolves to "approved" -- so there is one seller-session
 * shape whichever path got them there.
 */
import { config } from '../../../../config/env.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { OTP_SERVICES } from '../../../../core/otp/otpRateLimit.service.js';
import { signAccessToken, signRefreshToken } from '../../../../core/auth/token.util.js';
import { FoodRefreshToken as RefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { createSellerWebLogin } from '../../../../core/auth/sellerWebLogin.js';
import { addSellerSession } from '../../shared/sessionVersion.js';
import { Seller } from '../models/seller.model.js';
import ms from 'ms';

const assertCanSignIn = (seller) => {
    if (!seller) throw new ValidationError('No seller is registered with this number. Please register first.');
    if (seller.status === 'rejected') {
        throw new ValidationError(seller.rejectionReason
            ? `Your application was rejected: ${seller.rejectionReason}`
            : 'Your application was rejected. Please contact support.');
    }
    if (seller.status !== 'approved') {
        throw new ValidationError('Your application is still under review. You can sign in once it is approved.');
    }
};

/** Sign a seller in: access + refresh tokens, refresh token recorded, session slot opened. */
export const issueSellerSession = async (seller) => {
    const tokenVersion = await addSellerSession(seller._id);
    const payload = { userId: seller._id.toString(), role: 'SELLER', tokenVersion };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const expiresAt = new Date(Date.now() + ms(config.jwtRefreshExpiresIn || '7d'));
    await RefreshToken.create({ userId: seller._id, token: refreshToken, expiresAt });
    return { accessToken, refreshToken, user: seller };
};

// ------------------------------------------------------------- web login ---

const sellerWebLogin = createSellerWebLogin({
    Model: Seller,
    otpScope: 'ecommerce:seller_web',
    ticketPurpose: 'ecommerce_seller_web_login',
    otpOptions: { service: OTP_SERVICES.ECOMMERCE },
});

export async function requestSellerWebLoginOtp({ email, password }) {
    const proved = await sellerWebLogin.requestOtp(normalizeEmail(email), requiredPassword(password));
    assertCanSignIn(proved.seller);
    return sellerWebLogin.issueTicket(proved);
}

export async function resendSellerWebLoginOtp({ ticket, email }) {
    return sellerWebLogin.resendOtp(ticket, normalizeEmail(email));
}

export async function verifySellerWebLoginOtp({ ticket, email, otp }) {
    const { seller } = await sellerWebLogin.verify(ticket, normalizeEmail(email), otp);
    assertCanSignIn(seller);
    return issueSellerSession(seller);
}

const normalizeEmail = (email) => {
    const value = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ValidationError('Enter a valid email address');
    return value;
};

const requiredPassword = (password) => {
    const value = typeof password === 'string' ? password : '';
    if (!value || value.length > 128) throw new ValidationError('Password is required');
    return value;
};
