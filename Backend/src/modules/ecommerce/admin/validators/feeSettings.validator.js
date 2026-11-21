import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const rangeSchema = z.object({
    min: z.number().min(0),
    max: z.number().min(0),
    fee: z.number().min(0),
    deliveryBoyPerKm: z.number().min(0).optional().default(0),
    deliveryBoyBasePay: z.number().min(0).optional().default(0)
});

const courierRateSchema = z.object({
    mode: z.enum(['fixed', 'live']),
    markupPercent: z.number().min(0).max(500),
    markupFlat: z.number().min(0),
    freeAboveSubtotal: z.number().min(0),
    minFee: z.number().min(0),
    maxFee: z.number().min(0)
});

const feeSettingsUpsertSchema = z.object({
    courierRate: courierRateSchema.optional(),
    deliveryFee: z.number().min(0).nullable().optional(),
    deliveryFeeRanges: z.array(rangeSchema).optional(),
    platformFee: z.number().min(0).nullable().optional(),
    quickDeliveryFee: z.number().min(0).nullable().optional(),
    gstRate: z.number().min(0).max(100).nullable().optional(),
    isActive: z.boolean().optional()
});

export const validateFeeSettingsUpsertDto = (body) => {
    const normalized = {
        deliveryFee:
            body?.deliveryFee === null
                ? null
                : body?.deliveryFee !== undefined
                    ? Number(body.deliveryFee)
                    : undefined,
        deliveryFeeRanges: Array.isArray(body?.deliveryFeeRanges)
            ? body.deliveryFeeRanges.map((r) => ({
                min: Number(r?.min),
                max: Number(r?.max),
                fee: Number(r?.fee),
                deliveryBoyPerKm: Number(r?.deliveryBoyPerKm || 0),
                deliveryBoyBasePay: Number(r?.deliveryBoyBasePay || 0)
            }))
            : undefined,
        platformFee:
            body?.platformFee === null ? null : body?.platformFee !== undefined ? Number(body.platformFee) : undefined,
        quickDeliveryFee:
            body?.quickDeliveryFee === null
                ? null
                : body?.quickDeliveryFee !== undefined
                    ? Number(body.quickDeliveryFee)
                    : undefined,
        gstRate:
            body?.gstRate === null ? null : body?.gstRate !== undefined ? Number(body.gstRate) : undefined,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined,
        courierRate: body?.courierRate && typeof body.courierRate === 'object'
            ? {
                mode: body.courierRate.mode === 'live' ? 'live' : 'fixed',
                markupPercent: Number(body.courierRate.markupPercent) || 0,
                markupFlat: Number(body.courierRate.markupFlat) || 0,
                freeAboveSubtotal: Number(body.courierRate.freeAboveSubtotal) || 0,
                minFee: Number(body.courierRate.minFee) || 0,
                maxFee: Number(body.courierRate.maxFee) || 0
            }
            : undefined
    };

    const result = feeSettingsUpsertSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    const cr = result.data.courierRate;
    if (cr && cr.maxFee > 0 && cr.minFee > cr.maxFee) {
        throw new ValidationError('The minimum courier fee cannot be above the maximum');
    }

    // Validate ranges: min < max, non-overlapping after sorting
    const ranges = Array.isArray(result.data.deliveryFeeRanges) ? result.data.deliveryFeeRanges : undefined;
    if (ranges) {
        const sorted = [...ranges].sort((a, b) => a.min - b.min);
        for (const r of sorted) {
            if (r.min >= r.max) {
                throw new ValidationError('Each range must have min less than max');
            }
        }
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const cur = sorted[i];
            if (cur.min < prev.max) {
                throw new ValidationError('Delivery fee ranges must not overlap');
            }
        }
        result.data.deliveryFeeRanges = sorted;
    }

    return result.data;
};

