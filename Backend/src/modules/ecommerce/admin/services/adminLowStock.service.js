import mongoose from 'mongoose';
import { Product } from '../models/product.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Admin low-stock list: every product or variant whose own stock count is at
 * or below its own low-stock alert. Same rule as the seller's list
 * (listLowStockProducts): a row needs both a count and an alert; a variant is
 * judged on its own numbers.
 *
 * Single-channel collapse (see admin/models/product.model.js): warehouses'
 * original took `channel=quick|shop` and read `stock.<channel>` /
 * `lowStockThreshold.<channel>`. With one channel, `stock` and
 * `lowStockThreshold` are plain scalar fields, so `channel` is no longer a
 * parameter here.
 *
 * GET /admin/inventory/low-stock?sellerId=&page=&limit=
 */

const MAX_CANDIDATES = 5000;

const isNum = (path) => ({ $isNumber: path });
const lowAt = (stockPath, thresholdPath) => ({
    $and: [isNum(stockPath), isNum(thresholdPath), { $lte: [stockPath, thresholdPath] }],
});

const isLow = (count, threshold) =>
    typeof count === 'number' && typeof threshold === 'number' && count <= threshold;

export async function listAdminLowStock({ sellerId, page = 1, limit = 50 } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));

    const match = {};
    if (sellerId !== undefined && sellerId !== null && String(sellerId).trim() !== '') {
        if (!mongoose.Types.ObjectId.isValid(String(sellerId))) throw new ValidationError('Invalid sellerId');
        match.sellerId = new mongoose.Types.ObjectId(String(sellerId));
    }

    // Mongo compares the two fields ($expr), so only low products come back.
    match.$expr = {
        $or: [
            lowAt('$stock', '$lowStockThreshold'),
            {
                $gt: [
                    {
                        $size: {
                            $filter: {
                                input: { $ifNull: ['$variants', []] },
                                as: 'v',
                                cond: lowAt('$$v.stock', '$$v.lowStockThreshold'),
                            },
                        },
                    },
                    0,
                ],
            },
        ],
    };

    const products = await Product.find(match)
        .select('_id name image sellerId categoryName stock lowStockThreshold variants isAvailable')
        .sort({ name: 1 })
        .limit(MAX_CANDIDATES)
        .lean();

    const rows = [];
    for (const product of products) {
        const base = {
            productId: String(product._id),
            sellerId: product.sellerId ? String(product.sellerId) : null,
            categoryName: product.categoryName || '',
            isAvailable: product.isAvailable !== false,
        };
        if (isLow(product.stock, product.lowStockThreshold)) {
            rows.push({
                ...base,
                variantId: null,
                name: product.name,
                variantName: '',
                image: product.image || '',
                qty: product.stock,
                threshold: product.lowStockThreshold,
            });
        }
        for (const variant of product.variants || []) {
            if (variant.isActive === false) continue;
            if (!isLow(variant.stock, variant.lowStockThreshold)) continue;
            rows.push({
                ...base,
                variantId: String(variant._id),
                name: `${product.name} (${variant.name})`,
                variantName: variant.name || '',
                image: variant.images?.[0] || product.image || '',
                qty: variant.stock,
                threshold: variant.lowStockThreshold,
            });
        }
    }
    rows.sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));

    const total = rows.length;
    const items = rows.slice((p - 1) * l, p * l);
    const sellerIds = [...new Set(items.map((r) => r.sellerId).filter(Boolean))];
    const sellers = sellerIds.length
        ? await Seller.find({ _id: { $in: sellerIds } }).select('sellerName').lean()
        : [];
    const sellerName = new Map(sellers.map((s) => [String(s._id), s.sellerName || '']));

    return {
        items: items.map((r) => ({ ...r, sellerName: sellerName.get(r.sellerId) || '' })),
        pagination: { page: p, limit: l, total, totalPages: Math.max(1, Math.ceil(total / l)) },
    };
}
