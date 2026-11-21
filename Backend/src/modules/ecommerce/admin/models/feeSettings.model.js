import mongoose from 'mongoose';

const deliveryFeeRangeSchema = new mongoose.Schema(
    {
        min: { type: Number, required: true, min: 0 },
        max: { type: Number, required: true, min: 0 },
        fee: { type: Number, required: true, min: 0 },
        deliveryBoyPerKm: { type: Number, min: 0, default: 0 },
        deliveryBoyBasePay: { type: Number, min: 0, default: 0 }
    },
    { _id: false }
);

const feeSettingsSchema = new mongoose.Schema(
    {
        // No defaults here; admin must explicitly configure values.
        deliveryFee: { type: Number, min: 0 },
        deliveryFeeRanges: { type: [deliveryFeeRangeSchema], default: [] },
        platformFee: { type: Number, min: 0 },
        quickDeliveryFee: { type: Number, min: 0 },
        gstRate: { type: Number, min: 0, max: 100 },
        /**
         * Shop (courier) delivery fee. 'fixed' = the flat fee / distance ranges above.
         * 'live' = the courier's own rate for the parcel and route, plus a margin; the fixed
         * fee is still used when the courier cannot answer.
         */
        courierRate: {
            mode: { type: String, enum: ['fixed', 'live'], default: 'fixed' },
            markupPercent: { type: Number, min: 0, max: 500, default: 0 },
            markupFlat: { type: Number, min: 0, default: 0 },
            freeAboveSubtotal: { type: Number, min: 0, default: 0 },
            minFee: { type: Number, min: 0, default: 0 },
            maxFee: { type: Number, min: 0, default: 0 },
        },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'ecom_fee_settings', timestamps: true }
);

feeSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FeeSettings = mongoose.models.EcomFeeSettings || mongoose.model('EcomFeeSettings', feeSettingsSchema);

