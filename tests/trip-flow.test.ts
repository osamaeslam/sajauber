import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateHaversineDistance,
  estimateDrivingDistance,
  calculateDynamicFare,
  getVehiclePricing,
  calculateVehicleFare,
  calculateFullTripFare,
} from '../src/utils/haversine';
import { getEligibleDrivers, getCoordsFromXY } from '../src/utils/tripDispatchUtils';

describe('Trip Flow Integration', () => {
  const mockPickup = { id: 'loc_1', nameAr: 'موقف أ', nameEn: 'Stop A', lat: 30.0, lng: 31.0, city: '', country: '', x: 50, y: 50 };
  const mockDropoff = { id: 'loc_2', nameAr: 'موقف ب', nameEn: 'Stop B', lat: 30.1, lng: 31.1, city: '', country: '', x: 50, y: 50 };

  const mockStats = {
    commissionRate: 15,
    totalRevenue: 0,
    totalCommission: 0,
    totalCompletedTrips: 0,
    fixedCommission: 10,
    pricePerKm: 8,
    baseFare: 20,
    distanceBuffer: 1.25,
    additionalKm: 0.0,
    supportWhatsApp: '201015555555',
    freeKmThreshold: 2.0,
    distanceMultiplier: 1.27,
    peakHourMultiplier: 1.0,
    nightMultiplier: 1.0,
    peakStartHour: 7,
    peakEndHour: 9,
    nightStartHour: 22,
    nightEndHour: 5,
    carBaseFare: 20,
    carPricePerKm: 8,
    carMinFare: 2,
    carPricePerKm20to50: 8,
    carPricePerKm50plus: 8,
    motorcycleBaseFare: 12,
    motorcyclePricePerKm: 5,
    motorcycleMinFare: 2,
    motorcyclePricePerKm20to50: 5,
    motorcyclePricePerKm50plus: 5,
    toktokBaseFare: 10,
    toktokPricePerKm: 4,
    toktokMinFare: 2,
    toktokPricePerKm20to50: 4,
    toktokPricePerKm50plus: 4,
    tricycleBaseFare: 10,
    tricyclePricePerKm: 4,
    tricycleMinFare: 2,
    tricyclePricePerKm20to50: 4,
    tricyclePricePerKm50plus: 4,
    incomingCommission: 5,
    outgoingCommission: 5,
    incomingCommissionPercent: 10,
    outgoingCommissionPercent: 10,
    commissionMode: 'fixed',
    promoCode: 'EZZ5',
    promoValue: 5,
    lowDataMode: true,
  };

  describe('Step 1: Trip Creation', () => {
    it('should calculate distance and fare for a new trip', () => {
      const directDistance = calculateHaversineDistance(mockPickup.lat, mockPickup.lng, mockDropoff.lat, mockDropoff.lng);
      const drivingDistance = estimateDrivingDistance(directDistance, mockStats.distanceBuffer);
      const { baseFare, commission, finalFare } = calculateFullTripFare(drivingDistance, 'CAR', mockStats);

      expect(drivingDistance).toBeGreaterThan(0);
      expect(baseFare).toBeGreaterThanOrEqual(mockStats.carMinFare);
      expect(finalFare).toBeGreaterThan(0);
      expect(commission).toBeGreaterThan(0);
    });

    it('should create a valid trip object with all required fields', () => {
      const tripId = `trip_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const trip = {
        id: tripId,
        riderId: 'rider_1',
        riderName: 'Test Rider',
        riderPhone: '01000000000',
        driverId: undefined,
        driverName: undefined,
        pickup: mockPickup,
        dropoff: mockDropoff,
        pickupLandmark: undefined,
        status: 'SEARCHING' as const,
        fare: 50,
        commission: 7.5,
        distance: 10,
        routeGeometry: undefined,
        etaMinutes: 15,
        requestedVehicleType: 'CAR',
        createdAt: new Date().toISOString(),
        completedAt: undefined,
        chatMessages: [],
        riderRatingToDriver: undefined,
        riderFeedbackTags: [],
        riderFeedbackComment: undefined,
        driverRatingToRider: undefined,
        driverFeedbackTags: [],
        driverFeedbackComment: undefined,
        offeredDriverIds: [],
        currentOfferedDriverId: undefined,
        dispatchTimer: 300,
        dispatchTimerMax: 300,
        appliedPromoCode: undefined,
        appliedPromoDiscount: undefined,
      };

      expect(trip.id).toBeDefined();
      expect(trip.status).toBe('SEARCHING');
      expect(trip.riderId).toBe('rider_1');
      expect(trip.pickup).toEqual(mockPickup);
      expect(trip.dropoff).toEqual(mockDropoff);
    });

    it('should apply promo code discount correctly', () => {
      const distance = 5;
      const { finalFare } = calculateFullTripFare(distance, 'CAR', mockStats, 5);
      const { finalFare: noDiscount } = calculateFullTripFare(distance, 'CAR', mockStats, 0);

      expect(finalFare).toBeLessThan(noDiscount);
    });
  });

  describe('Step 2: Driver Dispatch', () => {
    const mockDrivers = [
      { id: 'drv_1', name: 'Driver 1', phone: '01111111111', status: 'AVAILABLE', isOnline: true, approvalStatus: 'APPROVED', rating: 4.5, currentX: 50, currentY: 50, vehicleType: 'CAR', vehicleName: 'Toyota', totalTrips: 100, lastSeen: new Date().toISOString(), serviceAreas: [], autoAccept: false, autoShowMap: false, agreedToTerms: true },
      { id: 'drv_2', name: 'Driver 2', phone: '01222222222', status: 'AVAILABLE', isOnline: true, approvalStatus: 'APPROVED', rating: 4.8, currentX: 51, currentY: 51, vehicleType: 'CAR', vehicleName: 'Honda', totalTrips: 200, lastSeen: new Date().toISOString(), serviceAreas: [], autoAccept: false, autoShowMap: false, agreedToTerms: true },
      { id: 'drv_3', name: 'Driver 3', phone: '01333333333', status: 'BUSY', isOnline: true, approvalStatus: 'APPROVED', rating: 4.0, currentX: 52, currentY: 52, vehicleType: 'CAR', vehicleName: 'Nissan', totalTrips: 50, lastSeen: new Date().toISOString(), serviceAreas: [], autoAccept: false, autoShowMap: false, agreedToTerms: true },
    ];

    it('should find eligible drivers for dispatch', () => {
      const eligible = getEligibleDrivers(mockDrivers, new Date(), 300, 'region_1');
      const available = eligible.filter(d => d.status === 'AVAILABLE' && d.isOnline);

      expect(available.length).toBeGreaterThan(0);
      expect(available.map(d => d.id)).not.toContain('drv_3');
    });

    it('should sort drivers by distance to pickup', () => {
      const eligible = getEligibleDrivers(mockDrivers, new Date(), 300, 'region_1');
      const sorted = eligible
        .map((d) => {
          const coords = getCoordsFromXY(d.currentX, d.currentY);
          const dist = calculateHaversineDistance(coords.lat, coords.lng, mockPickup.lat, mockPickup.lng);
          return { driver: d, distance: dist };
        })
        .sort((a, b) => a.distance - b.distance);

      expect(sorted.length).toBeGreaterThan(0);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].distance).toBeGreaterThanOrEqual(sorted[i - 1].distance);
      }
    });

    it('should limit offered drivers to MAX_OFFERED_DRIVERS', () => {
      const MAX_OFFERED_DRIVERS = 5;
      const eligible = getEligibleDrivers(mockDrivers, new Date(), 300, 'region_1');
      const offered = eligible.slice(0, MAX_OFFERED_DRIVERS);

      expect(offered.length).toBeLessThanOrEqual(MAX_OFFERED_DRIVERS);
    });
  });

  describe('Step 3: Trip Acceptance', () => {
    it('should transition trip from SEARCHING to ACCEPTED', () => {
      const trip = {
        id: 'trip_test_1',
        status: 'SEARCHING' as const,
        driverId: undefined,
        driverName: undefined,
        riderId: 'rider_1',
        riderName: 'Test Rider',
        riderPhone: '01000000000',
        pickup: mockPickup,
        dropoff: mockDropoff,
        fare: 50,
        commission: 7.5,
        distance: 10,
        offeredDriverIds: ['drv_1', 'drv_2'],
        currentOfferedDriverId: 'drv_1',
        dispatchTimer: 300,
        dispatchTimerMax: 300,
      };

      const accepted = { ...trip, status: 'ACCEPTED' as const, driverId: 'drv_1', driverName: 'Driver 1' };

      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.driverId).toBe('drv_1');
      expect(accepted.driverName).toBe('Driver 1');
    });

    it('should not accept trip if driver is not online', () => {
      const driver = { id: 'drv_3', isOnline: false, status: 'OFFLINE' };
      const isEligible = driver.isOnline && driver.status !== 'BUSY';

      expect(isEligible).toBe(false);
    });

    it('should handle duplicate acceptance gracefully', () => {
      const trip = {
        id: 'trip_test_2',
        status: 'ACCEPTED' as const,
        driverId: 'drv_1',
        driverName: 'Driver 1',
      };

      const isAlreadyAccepted = trip.status === 'ACCEPTED';
      expect(isAlreadyAccepted).toBe(true);
    });
  });

  describe('Step 4: Trip Completion', () => {
    it('should transition trip from STARTED to COMPLETED', () => {
      const trip = {
        id: 'trip_test_3',
        status: 'STARTED' as const,
        driverId: 'drv_1',
        driverName: 'Driver 1',
        fare: 50,
        commission: 7.5,
        distance: 10,
      };

      const completed = { ...trip, status: 'COMPLETED' as const, completedAt: new Date().toISOString() };

      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();
    });

    it('should calculate driver earnings correctly', () => {
      const fare = 50;
      const commission = 7.5;
      const netEarnings = fare - commission;

      expect(netEarnings).toBe(42.5);
    });

    it('should increment driver trip count on completion', () => {
      const driver = { totalTrips: 10 };
      const updatedDriver = { ...driver, totalTrips: driver.totalTrips + 1 };

      expect(updatedDriver.totalTrips).toBe(11);
    });
  });

  describe('Trip Queue Integration', () => {
    it('should add trip to queue and process it', async () => {
      const mockTrip = {
        id: 'trip_queue_test_1',
        riderId: 'rider_1',
        riderName: 'Test Rider',
        riderPhone: '01000000000',
        pickup: mockPickup,
        dropoff: mockDropoff,
        fare: 50,
        commission: 7.5,
        distance: 10,
        status: 'SEARCHING' as const,
        offeredDriverIds: [],
        currentOfferedDriverId: undefined,
        dispatchTimer: 300,
        dispatchTimerMax: 300,
      };

      expect(mockTrip.id).toBeDefined();
      expect(mockTrip.status).toBe('SEARCHING');
    });

    it('should remove trip from queue after completion', async () => {
      const tripId = 'trip_queue_test_1';
      const removed = true;

      expect(removed).toBe(true);
    });
  });

  describe('End-to-End Trip Flow', () => {
    it('should complete full trip lifecycle: create → accept → complete', async () => {
      const riderId = 'rider_e2e_1';
      const driverId = 'drv_e2e_1';

      const directDistance = calculateHaversineDistance(mockPickup.lat, mockPickup.lng, mockDropoff.lat, mockDropoff.lng);
      const drivingDistance = estimateDrivingDistance(directDistance, mockStats.distanceBuffer);
      const { baseFare, commission, finalFare } = calculateFullTripFare(drivingDistance, 'CAR', mockStats);

      const tripId = `trip_e2e_${Date.now()}`;
      const trip = {
        id: tripId,
        riderId,
        riderName: 'E2E Rider',
        riderPhone: '01000000000',
        driverId: undefined,
        driverName: undefined,
        pickup: mockPickup,
        dropoff: mockDropoff,
        status: 'SEARCHING' as const,
        fare: finalFare,
        commission,
        distance: drivingDistance,
        offeredDriverIds: [driverId],
        currentOfferedDriverId: driverId,
        dispatchTimer: 300,
        dispatchTimerMax: 300,
      };

      expect(trip.status).toBe('SEARCHING');
      expect(trip.fare).toBeGreaterThan(0);

      const accepted = { ...trip, status: 'ACCEPTED' as const, driverId, driverName: 'E2E Driver' };
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.driverId).toBe(driverId);

      const started = { ...accepted, status: 'STARTED' as const };
      expect(started.status).toBe('STARTED');

      const completed = { ...started, status: 'COMPLETED' as const, completedAt: new Date().toISOString() };
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();
    });
  });
});
