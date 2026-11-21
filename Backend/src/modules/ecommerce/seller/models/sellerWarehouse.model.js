import mongoose from 'mongoose';

/**
 * A place a seller ships from. Each one is registered with the courier as a pickup
 * address, and `pickupNickname` is the name the courier knows it by. An address is
 * never edited in place at the courier: a changed address is registered again under a
 * new nickname, so parcels already booked keep the address they were booked with.
 */
const sellerWarehouseSchema = new mongoose.Schema(
    {
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 60 },
        contactName: { type: String, required: true, trim: true, maxlength: 80 },
        contactPhone: { type: String, required: true, trim: true },
        address1: { type: String, required: true, trim: true, maxlength: 200 },
        address2: { type: String, trim: true, default: '', maxlength: 200 },
        city: { type: String, required: true, trim: true, maxlength: 80 },
        state: { type: String, required: true, trim: true, maxlength: 80 },
        pincode: { type: String, required: true, trim: true },
        isDefault: { type: Boolean, default: false },
        active: { type: Boolean, default: true },
        pickupNickname: { type: String, required: true, trim: true },
        pickupProvider: { type: String, default: '' },
    },
    { timestamps: true },
);

export const SellerWarehouse =
    mongoose.models.EcommerceSellerWarehouse || mongoose.model('EcommerceSellerWarehouse', sellerWarehouseSchema, 'ecommerce_seller_warehouses');
