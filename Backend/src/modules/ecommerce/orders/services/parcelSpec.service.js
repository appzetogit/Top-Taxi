import mongoose from 'mongoose';
import { Product } from '../../admin/models/product.model.js';

/**
 * Packed weight and box for the courier, from the products' own figures. A product with
 * none set counts as 500 g and the default box, so a seller who skips them still ships.
 * Heights add up (stacked), length and breadth take the largest.
 */
export async function parcelFor(order) {
    const ids = (order.items || []).map((i) => i.itemId).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const products = ids.length
        ? await Product.find({ _id: { $in: ids } }).select('weightGrams lengthCm breadthCm heightCm').lean()
        : [];
    const byId = new Map(products.map((p) => [String(p._id), p]));
    let weight = 0;
    let length = 0;
    let breadth = 0;
    let height = 0;
    for (const item of order.items || []) {
        const p = byId.get(String(item.itemId)) || {};
        const qty = Number(item.quantity) || 1;
        weight += (Number(p.weightGrams) || 500) * qty;
        length = Math.max(length, Number(p.lengthCm) || 0);
        breadth = Math.max(breadth, Number(p.breadthCm) || 0);
        height += (Number(p.heightCm) || 0) * qty;
    }
    return { weightGrams: weight || 500, lengthCm: length || 20, breadthCm: breadth || 15, heightCm: height || 10 };
}
