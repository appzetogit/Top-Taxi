import { connectDB, disconnectDB } from '../src/config/db.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';
import { Airport } from '../src/modules/taxi/admin/models/Airport.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { RentalPackageType } from '../src/modules/taxi/admin/models/RentalPackageType.js';
import { RentalVehicleType } from '../src/modules/taxi/admin/models/RentalVehicleType.js';
import { SetPrice } from '../src/modules/taxi/admin/models/SetPrice.js';

async function seed() {
  await connectDB();
  console.log('--- Connected to DB for PDF Rates Seeding ---');

  // 1. Service Location
  let serviceLocation = await ServiceLocation.findOne({ name: 'Bengaluru' });
  if (!serviceLocation) {
    serviceLocation = await ServiceLocation.create({
      name: 'Bengaluru',
      service_location_name: 'Bengaluru',
      address: '334, 9th A Main Rd, Begur, Bengaluru, Karnataka 560068',
      country: 'India',
      currency_name: 'Indian Rupee',
      currency_symbol: '₹',
      currency_code: 'INR',
      timezone: 'Asia/Kolkata',
      unit: 'km',
      latitude: 12.9716,
      longitude: 77.5946,
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
      },
      status: 'active',
      active: true,
    });
    console.log('Created ServiceLocation: Bengaluru');
  } else {
    console.log('Found existing ServiceLocation: Bengaluru');
  }

  // 2. Zone
  let zone = await Zone.findOne({ name: 'Bengaluru City Zone' });
  if (!zone) {
    zone = await Zone.create({
      name: 'Bengaluru City Zone',
      service_location_id: serviceLocation._id,
      unit: 'km',
      ride_surge_enabled: false,
      status: 'active',
      active: true,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.45, 12.80],
            [77.78, 12.80],
            [77.78, 13.25],
            [77.45, 13.25],
            [77.45, 12.80],
          ],
        ],
      },
    });
    console.log('Created Zone: Bengaluru City Zone');
  } else {
    console.log('Found existing Zone: Bengaluru City Zone');
  }

  // 3. Airport
  let airport = await Airport.findOne({ code: 'BLR' });
  if (!airport) {
    airport = await Airport.create({
      name: 'Kempegowda International Airport (BLR)',
      code: 'BLR',
      terminal: 'T1, T2',
      address: 'KIAL Rd, Devanahalli, Bengaluru, Karnataka 560300',
      service_location_id: serviceLocation._id,
      zone_id: zone._id,
      latitude: 13.1986,
      longitude: 77.7066,
      location: {
        type: 'Point',
        coordinates: [77.7066, 13.1986],
      },
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [77.68, 13.18],
            [77.74, 13.18],
            [77.74, 13.23],
            [77.68, 13.23],
            [77.68, 13.18],
          ],
        ],
      },
      support_airport_fee: 120,
      airport_surge: 0,
      status: 'active',
      active: true,
    });
    console.log('Created Airport: Kempegowda International Airport (BLR)');
  } else {
    console.log('Found existing Airport: Kempegowda International Airport (BLR)');
  }

  // 4. Vehicles from PDF
  const pdfVehiclesData = [
    {
      name: 'SEDAN',
      capacity: 4,
      seatsLabel: '4+1',
      icon_types: 'car',
      transport_type: 'taxi',
      airportFare: 999,
      airportToll: 120,
      outstationPerKm: 13,
      driverBatta: 400,
      local8h80kPrice: 2200,
      extraKm: 20,
      extraHour: 200,
    },
    {
      name: 'MARUTI ERTIGA',
      capacity: 6,
      seatsLabel: '6+1',
      icon_types: 'suv',
      transport_type: 'taxi',
      airportFare: 1699,
      airportToll: 120,
      outstationPerKm: 16,
      driverBatta: 400,
      local8h80kPrice: 3000,
      extraKm: 25,
      extraHour: 250,
    },
    {
      name: 'TOYOTA INNOVA',
      capacity: 7,
      seatsLabel: '7+1',
      icon_types: 'suv',
      transport_type: 'taxi',
      airportFare: 1899,
      airportToll: 120,
      outstationPerKm: 18,
      driverBatta: 400,
      local8h80kPrice: 3500,
      extraKm: 25,
      extraHour: 250,
    },
    {
      name: 'INNOVA CRYSTA',
      capacity: 7,
      seatsLabel: '7+1',
      icon_types: 'suv',
      transport_type: 'taxi',
      airportFare: 1999,
      airportToll: 120,
      outstationPerKm: 20,
      driverBatta: 400,
      local8h80kPrice: 4000,
      extraKm: 25,
      extraHour: 250,
    },
    {
      name: 'TOYOTA HYCROSS',
      capacity: 7,
      seatsLabel: '7+1',
      icon_types: 'suv',
      transport_type: 'taxi',
      airportFare: 2500,
      airportToll: 120,
      outstationPerKm: 22,
      driverBatta: 400,
      local8h80kPrice: 4500,
      extraKm: 30,
      extraHour: 300,
    },
    {
      name: 'TEMPO TRAVELLER - NON AC',
      capacity: 12,
      seatsLabel: '12+1',
      icon_types: 'truck',
      transport_type: 'taxi',
      airportFare: 4000,
      airportToll: 120,
      outstationPerKm: 20,
      driverBatta: 500,
      local8h80kPrice: 5000,
      extraKm: 30,
      extraHour: 300,
    },
    {
      name: 'TEMPO TRAVELLER - AC',
      capacity: 12,
      seatsLabel: '12+1',
      icon_types: 'truck',
      transport_type: 'taxi',
      airportFare: 4500,
      airportToll: 120,
      outstationPerKm: 22,
      driverBatta: 500,
      local8h80kPrice: 6000,
      extraKm: 35,
      extraHour: 400,
    },
    {
      name: 'MINI BUS - NON -AC',
      capacity: 21,
      seatsLabel: '21+1',
      icon_types: 'ehcb',
      transport_type: 'taxi',
      airportFare: 6500,
      airportToll: 500,
      outstationPerKm: 30,
      driverBatta: 700,
      local8h80kPrice: 7000,
      extraKm: 35,
      extraHour: 350,
    },
    {
      name: 'MINI BUS - -AC',
      capacity: 21,
      seatsLabel: '21+1',
      icon_types: 'ehcb',
      transport_type: 'taxi',
      airportFare: 7500,
      airportToll: 500,
      outstationPerKm: 34,
      driverBatta: 700,
      local8h80kPrice: 8000,
      extraKm: 40,
      extraHour: 400,
    },
    {
      name: 'MINI BUS - NON -AC (35+1)',
      capacity: 35,
      seatsLabel: '35+1',
      icon_types: 'HCV',
      transport_type: 'taxi',
      airportFare: 0,
      airportToll: 0,
      outstationPerKm: 46,
      driverBatta: 800,
      local8h80kPrice: 0,
      extraKm: 0,
      extraHour: 0,
    },
    {
      name: 'MINI BUS -AC (35+1)',
      capacity: 35,
      seatsLabel: '35+1',
      icon_types: 'HCV',
      transport_type: 'taxi',
      airportFare: 0,
      airportToll: 0,
      outstationPerKm: 52,
      driverBatta: 800,
      local8h80kPrice: 0,
      extraKm: 0,
      extraHour: 0,
    },
    {
      name: 'BUS NON AC PUSH BACK (49+1)',
      capacity: 49,
      seatsLabel: '49+1',
      icon_types: 'HCV',
      transport_type: 'taxi',
      airportFare: 0,
      airportToll: 0,
      outstationPerKm: 48,
      driverBatta: 800,
      local8h80kPrice: 0,
      extraKm: 0,
      extraHour: 0,
    },
  ];

  const vehicleMap = new Map();

  for (const vData of pdfVehiclesData) {
    let vehicle = await Vehicle.findOne({ name: vData.name });
    if (!vehicle) {
      vehicle = await Vehicle.create({
        name: vData.name,
        short_description: `${vData.seatsLabel} Seats`,
        description: `Top Taxi ${vData.name} - Seats: ${vData.seatsLabel}`,
        transport_type: vData.transport_type,
        icon_types: vData.icon_types,
        capacity: vData.capacity,
        dispatch_type: 'normal',
        is_taxi: 'taxi',
        status: 1,
        active: true,
      });
      console.log(`Created Vehicle: ${vData.name}`);
    } else {
      console.log(`Found Vehicle: ${vData.name}`);
    }
    vehicleMap.set(vData.name, vehicle);
  }

  // 5. Rental Package Type (8 HOURS 80KM)
  let packageType = await RentalPackageType.findOne({ name: '8 HOURS 80KM' });
  if (!packageType) {
    packageType = await RentalPackageType.create({
      name: '8 HOURS 80KM',
      short_description: '8 Hours 80 KM Local Rental Package',
      description: 'Local Package. Extra KM and Extra Hour charges applicable as per rate card. Airport transfer +Rs.1000 extra.',
      transport_type: 'taxi',
      status: 'active',
      active: true,
    });
    console.log('Created RentalPackageType: 8 HOURS 80KM');
  } else {
    console.log('Found RentalPackageType: 8 HOURS 80KM');
  }

  // 6. Rental Vehicle Types (Local Rental setup)
  for (const vData of pdfVehiclesData) {
    if (vData.local8h80kPrice > 0) {
      let rVehicle = await RentalVehicleType.findOne({ name: vData.name });
      const pricingObj = {
        id: 'pkg-8h-80k',
        label: '8 Hours 80KM',
        durationHours: 8,
        price: vData.local8h80kPrice,
        includedKm: 80,
        extraHourPrice: vData.extraHourPrice || vData.extraHour,
        extraKmPrice: vData.extraKm,
        active: true,
      };

      if (!rVehicle) {
        await RentalVehicleType.create({
          name: vData.name,
          short_description: `${vData.seatsLabel} Seats Local Rental`,
          description: `Top Taxi Local Package for ${vData.name}`,
          vehicleCategory: 'Car',
          capacity: vData.capacity,
          pricing: [pricingObj],
          status: 'active',
          active: true,
        });
        console.log(`Created RentalVehicleType: ${vData.name}`);
      } else {
        rVehicle.pricing = [pricingObj];
        await rVehicle.save();
        console.log(`Updated RentalVehicleType: ${vData.name}`);
      }
    }
  }

  // 7. SetPrice records for each vehicle in Bengaluru Zone
  for (const vData of pdfVehiclesData) {
    const vDoc = vehicleMap.get(vData.name);
    if (!vDoc) continue;

    let setPrice = await SetPrice.findOne({
      zone_id: zone._id,
      vehicle_type: vDoc._id,
      pricing_scope: 'ride',
    });

    const outstationMinKm = 300;
    const outstationBasePrice = outstationMinKm * vData.outstationPerKm;

    const priceFields = {
      zone_id: zone._id,
      service_location_id: serviceLocation._id,
      transport_type: 'taxi',
      vehicle_type: vDoc._id,
      pricing_scope: 'ride',
      payment_type: ['cash', 'online', 'wallet'],

      // Local Ride standard tariff
      base_price: 100,
      base_distance: 4,
      price_per_distance: vData.outstationPerKm,
      time_price: 1.5,
      waiting_charge: 2,
      free_waiting_before: 5,
      free_waiting_after: 5,

      // Outstation Ride Tariff (from PDF)
      enable_outstation_ride: true,
      support_outstation: 1,
      outstation_min_km_per_day: outstationMinKm,
      outstation_base_distance: outstationMinKm,
      outstation_price_per_distance: vData.outstationPerKm,
      outstation_base_price: outstationBasePrice,
      outstation_driver_batta: vData.driverBatta,
      outstation_driver_batta_night: 250,
      outstation_time_price: 0,

      // Airport Ride Tariff (from PDF)
      enable_airport_ride: vData.airportFare > 0,
      support_airport_fee: vData.airportToll,
      airport_surge: 0,
      airport_fixed_fare: vData.airportFare,
      airport_included_km: 40,
      airport_toll: vData.airportToll,
      airport_extra_km_price: vData.outstationPerKm,

      // Local Airport Transfer Extra
      local_airport_transfer_extra: 1000,

      service_tax: 5,
      admin_commision_type: 1,
      admin_commision: 10,
      admin_commission_type_from_driver: 1,
      admin_commission_from_driver: 10,
      admin_commission_type_for_owner: 1,
      admin_commission_for_owner: 10,
      order_number: 1,
      bill_status: 1,
      status: 'active',
      active: 1,
    };

    if (!setPrice) {
      await SetPrice.create(priceFields);
      console.log(`Created SetPrice for ${vData.name}`);
    } else {
      Object.assign(setPrice, priceFields);
      await setPrice.save();
      console.log(`Updated SetPrice for ${vData.name}`);
    }
  }

  // 8. Package Pricing (SetPrice with pricing_scope: 'package')
  const packageVehiclePrices = [];
  for (const vData of pdfVehiclesData) {
    if (vData.local8h80kPrice > 0) {
      const vDoc = vehicleMap.get(vData.name);
      if (vDoc) {
        packageVehiclePrices.push({
          vehicle_type: vDoc._id,
          base_price: vData.local8h80kPrice,
          free_distance: 80,
          distance_price: vData.extraKm,
          free_time: 480,
          time_price: Math.round((vData.extraHour / 60) * 100) / 100,
          admin_commision_type: 1,
          admin_commision: 10,
          service_tax: 5,
          cancellation_fee: 100,
          active: 1,
        });
      }
    }
  }

  let pkgPricing = await SetPrice.findOne({
    service_location_id: serviceLocation._id,
    package_type_id: packageType._id,
    pricing_scope: 'package',
  });

  if (!pkgPricing) {
    await SetPrice.create({
      service_location_id: serviceLocation._id,
      package_type_id: packageType._id,
      pricing_scope: 'package',
      package_destination: 'Bengaluru Local (8 Hr 80 KM)',
      package_availability: 'available',
      package_vehicle_prices: packageVehiclePrices,
      status: 'active',
      active: 1,
    });
    console.log('Created SetPrice package pricing for 8 HOURS 80KM');
  } else {
    pkgPricing.package_vehicle_prices = packageVehiclePrices;
    pkgPricing.package_destination = 'Bengaluru Local (8 Hr 80 KM)';
    pkgPricing.package_availability = 'available';
    await pkgPricing.save();
    console.log('Updated SetPrice package pricing for 8 HOURS 80KM');
  }

  console.log('--- Successfully Seeded All PDF Rate Records into MongoDB ---');
  await disconnectDB();
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
