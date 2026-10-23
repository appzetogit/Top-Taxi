import mongoose from 'mongoose';
import { Product } from '../../admin/models/product.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Single-channel collapse (see admin/models/product.model.js for the full
 * rationale): warehouses resolved a cart for a given channel ('quick' |
 * 'shop'), checking the seller's and product's per-channel approval/listing
 * and reading `stock.<channel>`. With one channel there is nothing left to
 * select, the seller's own `status` already gates selling, and `stock` /
 * `lowStockThreshold` are plain scalar fields -- so `channel` is no longer a
 * parameter anywhere in this file.
 */

/** The effective stock count for a line: the variant's own if counted, else the product's. */
const effectiveStock = (productDoc, variant) => {
  const isCounted = (n) => n !== null && n !== undefined;
  if (isCounted(variant?.stock)) return Number(variant.stock);
  if (isCounted(productDoc?.stock)) return Number(productDoc.stock);
  return null;
};

/** A 400 whose body says which line failed and why, for the storefront to act on. */
const lineError = (message, { productId, variantId = null, reason, available }) =>
  new ValidationError(message, {
    productId: String(productId),
    variantId: variantId ? String(variantId) : null,
    reason,
    // How many can still be ordered, when the refusal is about quantity.
    ...(available !== undefined ? { available } : {}),
  });

/**
 * Units asked for per product across all its lines. maxQtyPerOrder is a cap
 * per product, and two sizes of one product are two lines.
 */
export function quantityByProduct(items = []) {
  const totals = new Map();
  for (const rawItem of Array.isArray(items) ? items : []) {
    const itemId = String(rawItem?.itemId || rawItem?.id || '').trim();
    if (!itemId) continue;
    const quantity = Math.max(1, Number(rawItem?.quantity) || 1);
    totals.set(itemId, (totals.get(itemId) || 0) + quantity);
  }
  return totals;
}

function toObjectIds(ids = []) {
  return [...new Set(ids)]
    .map((id) => String(id || '').trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

function resolveProductPrice(productDoc, rawItem) {
  const variantId = String(rawItem?.variantId || '').trim();
  const variants = Array.isArray(productDoc?.variants) ? productDoc.variants : [];

  if (variantId) {
    const variant = variants.find((entry) => String(entry?._id) === variantId);
    if (!variant || variant.isActive === false) {
      throw new ValidationError(`${productDoc.name} is no longer available in the selected option`);
    }
    const price = Number(variant.price) || 0;
    const otherPrice = Number(variant.otherPrice) || 0;
    return {
      price,
      otherPrice: otherPrice > price ? otherPrice : 0,
      variantId,
      variantName: String(variant.name || rawItem?.variantName || '').trim(),
      variantPrice: price,
      variantAttributes: Array.isArray(variant.attributes)
        ? variant.attributes.map((a) => ({ name: a.name, value: a.value }))
        : [],
      sku: String(variant.sku || productDoc.sku || ''),
      variant,
    };
  }

  if (variants.length > 0) {
    throw new ValidationError(`Please select an option for ${productDoc.name}`);
  }

  const price = Number(productDoc.price) || 0;
  const otherPrice = Number(productDoc.otherPrice) || 0;
  return {
    price,
    otherPrice: otherPrice > price ? otherPrice : 0,
    variantId: '',
    variantName: '',
    variantPrice: price,
    variantAttributes: [],
    sku: String(productDoc.sku || ''),
    variant: null,
  };
}

/**
 * Resolves and checks a store's cart lines.
 * A line is refused (400 with { productId, variantId, reason }) when the
 * product or variant is unavailable, or stock is short.
 */
export async function resolveOrderCartItems(sellerId, rawItems = [], { seller = null } = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!items.length) throw new ValidationError('At least one item required');

  const rId = new mongoose.Types.ObjectId(String(sellerId));
  const itemIds = toObjectIds(items.map((item) => item.itemId || item.id));

  const productDocs = itemIds.length
    ? await Product.find({
        sellerId: rId,
        _id: { $in: itemIds },
        approvalStatus: 'approved',
      }).lean()
    : [];

  const productById = new Map(productDocs.map((doc) => [String(doc._id), doc]));

  const resolved = [];
  const totalByProduct = quantityByProduct(items);

  for (const rawItem of items) {
    const itemId = String(rawItem?.itemId || rawItem?.id || '').trim();
    const quantity = Math.max(1, Number(rawItem?.quantity) || 1);

    if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
      throw new ValidationError('One or more cart items are invalid');
    }

    const productDoc = productById.get(itemId);
    if (productDoc) {
      if (seller && seller.status !== 'approved') {
        throw lineError(
          `${seller.sellerName || 'This store'} is not currently selling`,
          { productId: itemId, variantId: rawItem?.variantId || null, reason: 'seller_not_approved' },
        );
      }
      if (productDoc.isAvailable === false) {
        throw new ValidationError(`${productDoc.name} is currently unavailable`);
      }

      // Cheap pre-checks so the customer is told at checkout rather than after
      // the reservation fails. Stock is still claimed atomically at order
      // creation -- this read is a courtesy, not the guard.
      const cap = Number(productDoc.maxQtyPerOrder);
      const productTotal = totalByProduct.get(itemId) || quantity;
      if (Number.isFinite(cap) && cap > 0 && productTotal > cap) {
        throw lineError(
          `You can order at most ${cap} of ${productDoc.name}`,
          { productId: itemId, variantId: rawItem?.variantId || null, reason: 'max_per_order', available: cap },
        );
      }

      const { variant, ...pricing } = resolveProductPrice(productDoc, rawItem);
      const label = variant ? `${productDoc.name} (${variant.name})` : productDoc.name;
      if (variant && variant.isActive === false) {
        throw lineError(
          `${label} is no longer available`,
          { productId: itemId, variantId: variant._id, reason: 'variant_not_in_channel' },
        );
      }

      // The variant's own count when it has one, else the product's.
      const onHand = effectiveStock(productDoc, variant);
      if (onHand !== null && Number(onHand) < quantity) {
        throw lineError(
          Number(onHand) > 0
            ? `Only ${Number(onHand)} left of ${label}. Please reduce the quantity.`
            : `${label} just went out of stock`,
          { productId: itemId, variantId: variant?._id || null, reason: 'out_of_stock', available: Math.max(0, Number(onHand)) },
        );
      }

      resolved.push({
        itemId,
        name: String(productDoc.name || rawItem?.name || 'Item').trim(),
        ...pricing,
        quantity,
        // Carried onto the line so tax is computed per product rather than at
        // one rate for the whole basket. null defers to the order-wide rate.
        gstRate:
          productDoc.gstRate === null || productDoc.gstRate === undefined
            ? null
            : Number(productDoc.gstRate),
        brand: String(productDoc.brand || ''),
        packSize: String(productDoc.packSize || ''),
        // Snapshotted so category reporting survives a rename or a delete.
        categoryId: productDoc.categoryId || null,
        categoryName: String(productDoc.categoryName || ''),
        // true / false for the veg / non-veg mark, null where the product has none.
        isVeg: productDoc.foodType ? productDoc.foodType === 'Veg' : null,
        image: String(variant?.images?.[0] || productDoc.image || rawItem?.image || ''),
        notes: String(rawItem?.notes || ''),
      });
      continue;
    }

    // An id that exists but belongs to somebody else is a mixed-seller cart,
    // not a missing product. Both used to say "no longer available", which sent
    // the customer looking for a stock problem that was never there.
    //
    // An order carries one sellerId, one delivery fee and one rider, so a
    // basket spanning two sellers cannot be placed as it stands.
    // ponytail: reject and say so. Splitting into an order per seller is the
    // real answer, and it is a much bigger change -- separate fees, separate
    // dispatch, separate cancellation and refund per part.
    const foreign = await Product.findById(itemId).select('name sellerId').lean();
    if (foreign?._id && String(foreign.sellerId) !== String(rId)) {
      throw new ValidationError(
        `${foreign.name} is sold by a different seller. Please order from one seller at a time.`,
      );
    }

    throw new ValidationError(
      `${String(rawItem?.name || 'An item')} is no longer available from this seller`,
    );
  }

  return resolved;
}
