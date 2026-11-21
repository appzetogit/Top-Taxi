import mongoose from 'mongoose';
import { SellerWarehouse } from '../models/sellerWarehouse.model.js';
import { Seller } from '../models/seller.model.js';
import { getShippingProvider } from '../../delivery/services/shipping/index.js';
import { NotFoundError, ValidationError } from '../../../../core/auth/errors.js';

const MAX_WAREHOUSES = 10;
const text = (v) => (v == null ? '' : String(v).trim());
const digits = (v) => text(v).replace(/\D/g, '');

const serialize = (w) => ({
    id: String(w._id),
    name: w.name,
    contactName: w.contactName,
    contactPhone: w.contactPhone,
    address1: w.address1,
    address2: w.address2 || '',
    city: w.city,
    state: w.state,
    pincode: w.pincode,
    isDefault: Boolean(w.isDefault),
    createdAt: w.createdAt,
});

/** Checks the form and returns clean values, or throws the first problem in plain words. */
const clean = (body = {}) => {
    const out = {
        name: text(body.name),
        contactName: text(body.contactName),
        contactPhone: digits(body.contactPhone).slice(-10),
        address1: text(body.address1),
        address2: text(body.address2),
        city: text(body.city),
        state: text(body.state),
        pincode: digits(body.pincode),
    };
    if (out.name.length < 2) throw new ValidationError('Give the warehouse a name.');
    if (out.contactName.length < 2) throw new ValidationError('Enter the name of the person who hands over the parcels.');
    if (!/^[6-9]\d{9}$/.test(out.contactPhone)) throw new ValidationError('Enter a valid 10-digit mobile number for the pickup contact.');
    if (out.address1.length < 5) throw new ValidationError('Enter the warehouse address with the house, flat or road number.');
    if (!out.city) throw new ValidationError('Enter the city.');
    if (!out.state) throw new ValidationError('Enter the state.');
    if (!/^[1-9]\d{5}$/.test(out.pincode)) throw new ValidationError('Enter a valid 6-digit pincode.');
    return out;
};

/** A name the courier will accept and that is unique to this warehouse version. */
const nicknameFor = (sellerId) => `GOGO-${String(sellerId).slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

/** Registers the address with the courier; its refusal is shown to the seller as it is. */
const register = async (seller, values) => {
    const nickname = nicknameFor(seller._id);
    const provider = getShippingProvider();
    try {
        await provider.addPickupLocation({
            nickname,
            name: values.contactName,
            email: seller.ownerEmail || '',
            phone: values.contactPhone,
            address: values.address1,
            address2: values.address2,
            city: values.city,
            state: values.state,
            pincode: values.pincode,
        });
    } catch (error) {
        if (error.pickupRejected) throw new ValidationError(`The courier did not accept this address: ${error.message}`);
        throw new ValidationError('Could not reach the courier to save this address. Please try again in a moment.');
    }
    return { nickname, provider: provider.name };
};

const loadSeller = async (sellerId) => {
    const seller = await Seller.findById(sellerId).select('_id ownerEmail').lean();
    if (!seller) throw new NotFoundError('Store not found');
    return seller;
};

const owned = async (sellerId, id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new NotFoundError('Warehouse not found');
    const warehouse = await SellerWarehouse.findOne({ _id: id, sellerId, active: true });
    if (!warehouse) throw new NotFoundError('Warehouse not found');
    return warehouse;
};

export async function listWarehouses(sellerId) {
    const rows = await SellerWarehouse.find({ sellerId, active: true }).sort({ isDefault: -1, createdAt: 1 }).lean();
    return rows.map(serialize);
}

export async function createWarehouse(sellerId, body) {
    const values = clean(body);
    const count = await SellerWarehouse.countDocuments({ sellerId, active: true });
    if (count >= MAX_WAREHOUSES) throw new ValidationError(`You can keep up to ${MAX_WAREHOUSES} warehouses.`);
    const seller = await loadSeller(sellerId);
    const { nickname, provider } = await register(seller, values);
    const warehouse = await SellerWarehouse.create({
        ...values,
        sellerId,
        pickupNickname: nickname,
        pickupProvider: provider,
        isDefault: count === 0 || body.isDefault === true,
    });
    if (warehouse.isDefault) await SellerWarehouse.updateMany({ sellerId, _id: { $ne: warehouse._id } }, { $set: { isDefault: false } });
    return serialize(warehouse);
}

export async function updateWarehouse(sellerId, id, body) {
    const warehouse = await owned(sellerId, id);
    const values = clean({ ...warehouse.toObject(), ...body });
    const addressChanged = ['contactName', 'contactPhone', 'address1', 'address2', 'city', 'state', 'pincode'].some((k) => values[k] !== (warehouse[k] || ''));
    if (addressChanged) {
        const seller = await loadSeller(sellerId);
        const { nickname, provider } = await register(seller, values);
        warehouse.pickupNickname = nickname;
        warehouse.pickupProvider = provider;
    }
    Object.assign(warehouse, values);
    await warehouse.save();
    return serialize(warehouse);
}

export async function setDefaultWarehouse(sellerId, id) {
    const warehouse = await owned(sellerId, id);
    await SellerWarehouse.updateMany({ sellerId, _id: { $ne: warehouse._id } }, { $set: { isDefault: false } });
    warehouse.isDefault = true;
    await warehouse.save();
    return serialize(warehouse);
}

/** Removed from the seller's list; parcels already booked keep their pickup. */
export async function deleteWarehouse(sellerId, id) {
    const warehouse = await owned(sellerId, id);
    warehouse.active = false;
    warehouse.isDefault = false;
    await warehouse.save();
    const next = await SellerWarehouse.findOne({ sellerId, active: true }).sort({ createdAt: 1 });
    if (next && !(await SellerWarehouse.exists({ sellerId, active: true, isDefault: true }))) {
        next.isDefault = true;
        await next.save();
    }
    return { deleted: true };
}

/**
 * The warehouse a parcel is collected from: the one the seller chose, else their default.
 * null when the seller has none (the caller decides whether that is allowed).
 */
export async function pickWarehouse(sellerId, warehouseId = null) {
    if (warehouseId) return owned(sellerId, warehouseId);
    return (
        (await SellerWarehouse.findOne({ sellerId, active: true, isDefault: true })) ||
        (await SellerWarehouse.findOne({ sellerId, active: true }).sort({ createdAt: 1 }))
    );
}
