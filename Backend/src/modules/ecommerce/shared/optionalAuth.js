import { verifyAccessToken } from '../../../core/auth/token.util.js';

/**
 * Ported from warehouses' core/auth/auth.middleware.js `optionalAuth`. Gogo's
 * own core/auth/auth.middleware.js has only a mandatory `authMiddleware`
 * (which also does a DB lookup to re-check the account's live status); this
 * is the lighter "attach req.user if a valid token is present, otherwise
 * continue silently" variant used by a few public reads (e.g. product
 * reviews, so a signed-in customer's own review/vote shows, but a signed-out
 * visitor still gets the page). Built on Gogo's real verifyAccessToken
 * rather than forking its own JWT verification.
 */
export const optionalAuth = (req, _res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId || decoded.sub || '',
            role: String(decoded.role || '').toUpperCase(),
        };
    } catch {
        // Silently ignore invalid/expired tokens in optional auth.
    }
    return next();
};
