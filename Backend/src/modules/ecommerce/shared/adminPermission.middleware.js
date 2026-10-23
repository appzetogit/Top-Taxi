import { sendError } from '../../../utils/response.js';
import { FoodAdmin as Admin } from '../../../core/admin/admin.model.js';

/**
 * Ported from warehouses' core/roles/adminPermission.middleware.js. Gogo's
 * core/roles has requireRoles and requireServiceAccess, but no per-section
 * admin-permission check -- that is specific to this module's admin panel, so
 * it lives in shared/ rather than Gogo's core. `Admin` is aliased to Gogo's
 * exported `FoodAdmin` model (the platform-wide admin collection), matching
 * what core/roles/serviceAccess.middleware.js already does.
 */

const isSuperAdmin = (admin) =>
    !admin?.adminType || admin?.adminType === 'super_admin' || admin?.isSuperAdmin === true;

const hasAction = (permissions, section, action) => {
    const actions = Array.isArray(permissions?.[section]) ? permissions[section] : [];
    return actions.includes(action);
};

const hydrateAdmin = async (req) => {
    if (req.adminAccess) return req.adminAccess;
    const admin = await Admin.findById(req.user?.userId)
        .select('adminType permissions isActive isDeleted')
        .lean();
    req.adminAccess = admin;
    return admin;
};

export const requireAdminPermission = (section, action = 'view') => async (req, res, next) => {
    try {
        if (!req.user?.userId || req.user?.role !== 'ADMIN') {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        if (!hasAction(admin.permissions, section, action)) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};

export const requireAnyAdminPermission = (rules = []) => async (req, res, next) => {
    try {
        if (!req.user?.userId || req.user?.role !== 'ADMIN') {
            return sendError(res, 401, 'Not authenticated');
        }

        const admin = await hydrateAdmin(req);
        if (!admin || admin.isDeleted || admin.isActive === false) {
            return sendError(res, 403, 'Admin account is inactive');
        }

        if (isSuperAdmin(admin)) {
            return next();
        }

        const allowed = Array.isArray(rules) && rules.some((rule) => {
            const section = rule?.section;
            const action = rule?.action || 'view';
            if (!section) return false;
            return hasAction(admin.permissions, section, action);
        });

        if (!allowed) {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }

        return next();
    } catch (_error) {
        return sendError(res, 500, 'Permission check failed');
    }
};
