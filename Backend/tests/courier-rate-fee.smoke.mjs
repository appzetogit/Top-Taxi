// The courier-rate delivery fee: margin and limits, caching, and every fallback to the fixed fee.
//   node tests/courier-rate-fee.smoke.mjs
//   LIVE=1 SR_EMAIL=... SR_PASS=... node tests/courier-rate-fee.smoke.mjs   (also asks the real courier)
import assert from 'node:assert/strict';
const { setShippingProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/index.js');
const svc = await import('../src/modules/ecommerce/delivery/services/shipping/courierRate.service.js');
const { ShiprocketProvider } = await import('../src/modules/ecommerce/delivery/services/shipping/shiprocket.provider.js');

// margin and limits
const f = svc.feeFromCourierRate;
assert.equal(f(68, {}), 68);
assert.equal(f(68, { markupPercent: 10 }), 74.8);
assert.equal(f(68, { markupFlat: 12 }), 80);
assert.equal(f(68, { markupPercent: 10, markupFlat: 5 }), 79.8);
assert.equal(f(20, { minFee: 40 }), 40);
assert.equal(f(300, { maxFee: 150 }), 150);
assert.equal(f(68, { freeAboveSubtotal: 500 }, { subtotal: 499 }), 68);
assert.equal(f(68, { freeAboveSubtotal: 500 }, { subtotal: 500 }), 0);
assert.equal(f(68, { markupPercent: 10, freeAboveSubtotal: 0 }, { subtotal: 99999 }), 74.8, 'freeAbove 0 means off');

// quoting with a stub courier
let calls = 0;
const stub = { name: 'shiprocket', async calculateRate(p) { calls++; return { rate: 67.72, courierName: 'Xpressbees Surface', estimatedDays: 4, ...{ seen: p } }; } };
setShippingProvider(stub);
svc.clearCourierRateCache();
const live = { courierRate: { mode: 'live', markupPercent: 10, markupFlat: 0, freeAboveSubtotal: 0, minFee: 0, maxFee: 0 } };
const base = { feeSettings: live, originPincode: '400001', destPincode: '452010', weightGrams: 500, subtotal: 200 };

const a = await svc.quoteCourierDeliveryFee(base);
assert.deepEqual([a.ok, a.fee, a.courierRate, a.courierName, a.estimatedDays], [true, 74.49, 67.72, 'Xpressbees Surface', 4]);
await svc.quoteCourierDeliveryFee(base);
await svc.quoteCourierDeliveryFee({ ...base, weightGrams: 480 });
assert.equal(calls, 1, 'same route and weight slab is asked once');
await svc.quoteCourierDeliveryFee({ ...base, destPincode: '110001' });
assert.equal(calls, 2, 'a different route is asked again');

// every reason to keep the fixed fee
assert.deepEqual(await svc.quoteCourierDeliveryFee({ ...base, feeSettings: { courierRate: { mode: 'fixed' } } }), { ok: false, reason: 'fixed' });
assert.deepEqual(await svc.quoteCourierDeliveryFee({ ...base, feeSettings: {} }), { ok: false, reason: 'fixed' });
assert.equal((await svc.quoteCourierDeliveryFee({ ...base, destPincode: '' })).reason, 'no_pincode');
assert.equal((await svc.quoteCourierDeliveryFee({ ...base, originPincode: 'abc' })).reason, 'no_pincode');
setShippingProvider({ name: 'mock' });
assert.equal((await svc.quoteCourierDeliveryFee(base)).reason, 'no_courier');
setShippingProvider({ name: 'shiprocket', async calculateRate() { throw new Error('No courier serves this pincode'); } });
svc.clearCourierRateCache();
assert.equal((await svc.quoteCourierDeliveryFee(base)).reason, 'courier_error');

if (process.env.LIVE === '1') {
    setShippingProvider(new ShiprocketProvider({ email: process.env.SR_EMAIL, password: process.env.SR_PASS }));
    svc.clearCourierRateCache();
    const far = await svc.quoteCourierDeliveryFee({ ...base, originPincode: '400001', destPincode: '452010' });
    const near = await svc.quoteCourierDeliveryFee({ ...base, originPincode: '452001', destPincode: '452010' });
    console.log('Mumbai -> Indore', far.courierRate, '->', far.fee, '|', 'Indore -> Indore', near.courierRate, '->', near.fee);
    assert.ok(far.ok && near.ok && far.fee > near.fee, 'a longer route costs more');
}
console.log('courier-rate-fee: ok');
