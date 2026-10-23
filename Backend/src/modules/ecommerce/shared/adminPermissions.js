/**
 * Ported from warehouses' constants/permissions.js. Gogo's own
 * src/constants/permissions.js exists but is empty (never ported this far),
 * and it is shared top-level infrastructure outside this module's tree, so
 * rather than edit it, this module keeps its own copy -- it is a pure,
 * self-contained list with no model or path coupling to anything else, so
 * there is none of the FORK_COLLAPSE.md risk of forking code that silently
 * binds to a different collection.
 *
 * The section list below is warehouses' original list, extended with
 * `sub_admin_management` and `system_settings`, which admin/routes/admin.routes.js
 * actually gates on (that ported file used sections a touch broader than
 * warehouses' own constants file declared).
 */
export const ADMIN_ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

export const ADMIN_PERMISSION_SECTIONS = [
    'dashboard',
    'point_of_sale',
    'product_management',
    'seller_management',
    'order_management',
    'promotions_management',
    'referral_rewards',
    'customer_management',
    'delivery_management',
    'support_management',
    'report_management',
    'transaction_management',
    'banner_management',
    'pages_social_media',
    'sub_admin_management',
    'system_settings',
];

export const ADMIN_FULL_PERMISSIONS = Object.freeze(
    Object.fromEntries(
        ADMIN_PERMISSION_SECTIONS.map((section) => [section, [...ADMIN_ACTIONS]])
    )
);

const actionPriority = new Set(ADMIN_ACTIONS);
const sectionPriority = new Set(ADMIN_PERMISSION_SECTIONS);

export const sanitizeAdminPermissions = (raw = {}) => {
    const normalized = {};

    for (const section of ADMIN_PERMISSION_SECTIONS) {
        const sectionActions = Array.isArray(raw?.[section]) ? raw[section] : [];
        normalized[section] = [...new Set(sectionActions.map((it) => String(it).trim().toLowerCase()))]
            .filter((it) => actionPriority.has(it));
    }

    return normalized;
};

export const isValidPermissionPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

    for (const [section, actions] of Object.entries(payload)) {
        if (!sectionPriority.has(section)) return false;
        if (!Array.isArray(actions)) return false;
        if (actions.some((action) => !actionPriority.has(String(action).trim().toLowerCase()))) return false;
    }

    return true;
};
