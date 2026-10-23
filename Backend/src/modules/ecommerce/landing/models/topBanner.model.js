import mongoose from 'mongoose';

const topBannerSchema = new mongoose.Schema({
    image: {
        type: String,
        required: true,
    },
    publicId: {
        type: String,
    },
    order: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    }
}, {
    collection: 'ecom_top_banners',
    timestamps: true
});

const TopBanner = mongoose.models.EcomTopBanner || mongoose.model('EcomTopBanner', topBannerSchema);

export default TopBanner;
