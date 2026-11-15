/**
 * Give the rental vehicles a cover photo and a small gallery.
 *
 *   node scripts/seed-rental-images.mjs           # dry run: prints what it would do
 *   node scripts/seed-rental-images.mjs --apply
 *   node scripts/seed-rental-images.mjs --apply --force   # also replace photos that are already set
 *
 * The photos are freely licensed pictures from Wikimedia Commons (CC0, CC BY or
 * CC BY-SA). Each is downloaded and stored on this server's own uploads folder
 * (Gogo-taxi/rental), so the app never hot-links Commons and nothing goes to
 * Cloudinary. Several are look-alikes (a Kijang Innova for the Toyota Innova, a
 * Zenix for the Hycross, Starbus / city-bus shots for the mini buses): swap them
 * from Admin > Rental Vehicles when real fleet photos exist.
 *
 * A vehicle that already has a cover image is left alone unless --force is given.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import { RentalVehicleType } from '../src/modules/taxi/admin/models/RentalVehicleType.js';
import { saveImageFromUrl } from '../src/services/storage.service.js';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) throw new Error('MONGO_URI is not set');

// vehicle name -> Commons files; the first one is the cover.
const PHOTOS = {
  'MINI BUS - -AC': [
    'File:Kadamba Tata Marcopolo Starbus Ultra Ac Deluxe.jpg',
    'File:Delhi Transport Corporation Tata Marcopolo Starbus Ceiling.jpg',
  ],
  'MINI BUS - NON -AC': ['File:Durgapur city bus.jpg', 'File:Himalaya Beauty (228755375).jpg'],
  'TEMPO TRAVELLER - AC': ['File:Force Traveller Luxury.jpg', 'File:Force Traveller, Leh-Manali Highway.jpg'],
  'TEMPO TRAVELLER - NON AC': [
    'File:Force Motors - Traveller 26 - Agra 2014-05-14 4222.JPG',
    'File:Force Traveller, Leh-Manali Highway.jpg',
  ],
  'TOYOTA HYCROSS': [
    'File:Toyota Zenix 2.0 V Silver Metallic.jpg',
    'File:2023 Toyota Zenix 2.0 v.jpg',
    'File:Toyota Zenix 2.0 Q HEV 2023.jpg',
  ],
  'INNOVA CRYSTA': [
    'File:Toyota Innova Crysta 2.4 Z front right.jpg',
    'File:Toyota Innova Crysta 2.4 Z side.jpg',
    'File:Toyota Innova Crysta 2.4 Z rear left.jpg',
  ],
  'TOYOTA INNOVA': [
    'File:2012 Toyota Innova 2.5 G in black, front right.jpg',
    'File:2012 Toyota Innova 2.0 G in Pearl White, front left, 05-11-2024.jpg',
    'File:Toyota Kijang Innova (Side), Jakarta, Indonesia.jpg',
  ],
  'MARUTI ERTIGA': [
    'File:Maruti Suzuki Ertiga(1).jpg',
    'File:Maruti Suzuki Ertiga(2).jpg',
    'File:Maruti Suzuki Ertiga(3).jpg',
  ],
  SEDAN: [
    'File:2022 Honda City ZX i-VTEC (India) front view (cropped).jpg',
    'File:2022 Honda City ZX i-VTEC (India) rear view.jpg',
  ],
};

const UA = { 'User-Agent': 'Gogo/1.0 (rental demo images)' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Commons answers 429 to a burst of requests; pause between photos and back off on a 429.
const withBackoff = async (fn) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error?.response?.status !== 429 || attempt >= 4) throw error;
      await sleep(8000 * (attempt + 1));
    }
  }
};

const commonsThumb = async (title) => {
  const { data } = await axios.get('https://commons.wikimedia.org/w/api.php', {
    params: { action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: 1200, format: 'json' },
    headers: UA,
    timeout: 30000,
  });
  const info = Object.values(data?.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) throw new Error(`not found on Commons: ${title}`);
  return {
    url: info.thumburl || info.url,
    license: info.extmetadata?.LicenseShortName?.value || '',
    artist: String(info.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').trim(),
  };
};

await mongoose.connect(uri);

let changed = 0;
for (const [name, titles] of Object.entries(PHOTOS)) {
  const vehicle = await RentalVehicleType.findOne({ name });
  if (!vehicle) {
    console.log(`SKIP  ${name}: no such rental vehicle`);
    continue;
  }
  if (vehicle.coverImage && !force) {
    console.log(`SKIP  ${name}: already has a cover image`);
    continue;
  }
  if (!apply) {
    console.log(`[dry run] ${name}: would store ${titles.length} photo(s)`);
    continue;
  }

  const stored = [];
  for (const title of titles) {
    try {
      const source = await withBackoff(() => commonsThumb(title));
      const saved = await withBackoff(() => saveImageFromUrl(source.url, 'Gogo-taxi/rental'));
      await sleep(2500);
      stored.push(saved.url);
      console.log(`  saved ${title} -> ${saved.url}  [${source.license}${source.artist ? `, ${source.artist}` : ''}]`);
    } catch (error) {
      console.log(`  FAILED ${title}: ${error.message}`);
    }
  }
  if (!stored.length) {
    console.log(`SKIP  ${name}: no photo could be downloaded`);
    continue;
  }

  vehicle.image = stored[0];
  vehicle.coverImage = stored[0];
  vehicle.galleryImages = stored;
  await vehicle.save();
  changed += 1;
  console.log(`OK    ${name}: ${stored.length} photo(s)`);
}

console.log(apply ? `\nUpdated ${changed} vehicle(s).` : '\nDry run only; re-run with --apply.');
await mongoose.disconnect();
