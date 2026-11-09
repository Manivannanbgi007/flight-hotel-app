import { addDays, format } from 'date-fns';

import { hotelSearchSchema } from '@/features/hotels/schemas';
import {
  formToRatePlanRequest,
  inventoryUpdateSchema,
  profileSchema,
  ratePlanSchema,
  roomTypeSchema,
  seasonalRateSchema,
} from './schemas';

const errorsOf = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
  const errors: Record<string, string> = {};
  for (const issue of result.error?.issues ?? []) {
    errors[issue.path.join('.')] ??= issue.message;
  }
  return errors;
};
const day = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd');

describe('hotel search form', () => {
  const valid = { destination: 'Goa', checkIn: day(7), checkOut: day(9), rooms: 1, adults: 2, children: 0, childAges: [] };

  it('accepts a normal stay', () => {
    expect(hotelSearchSchema.safeParse(valid).success).toBe(true);
  });

  it('applies the same stay rules as the API', () => {
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, checkIn: day(-1) }))).toEqual({ checkIn: 'Check-in cannot be in the past' });
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, checkOut: day(7) }))).toEqual({ checkOut: 'Check-out must be after check-in' });
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, checkOut: day(40) }))).toEqual({ checkOut: 'A stay can be at most 30 nights' });
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, rooms: 3, adults: 2 }))).toEqual({ adults: 'Every room needs at least one adult' });
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, children: 2, childAges: [5, -1] }))).toEqual({ 'childAges.1': 'Age needed' });
    expect(errorsOf(hotelSearchSchema.safeParse({ ...valid, destination: 'G' }))).toEqual({ destination: 'Enter a city or hotel name' });
  });
});

describe('manager forms', () => {
  const profile = {
    name: 'Lighthouse Inn', description: '', propertyType: 'HOTEL', starRating: '', addressLine: '1 Harbour Road',
    city: 'Goa', state: '', countryCode: 'IN', postalCode: '', latitude: '', longitude: '', checkInTime: '14:00',
    checkOutTime: '11:00', contactEmail: '', contactPhone: '', amenities: [], policies: [],
  };

  it('needs latitude and longitude together', () => {
    expect(profileSchema.safeParse(profile).success).toBe(true);
    expect(errorsOf(profileSchema.safeParse({ ...profile, latitude: '15.49' }))).toEqual({
      longitude: 'Give both latitude and longitude, or neither',
    });
    expect(errorsOf(profileSchema.safeParse({ ...profile, latitude: '95', longitude: '73.8' }))).toEqual({
      latitude: 'Latitude is between -90 and 90',
    });
  });

  it('validates contact details and house rules', () => {
    expect(errorsOf(profileSchema.safeParse({
      ...profile, contactEmail: 'not-an-email', contactPhone: '12ab', policies: [{ type: 'PETS', description: ' ' }],
    }))).toEqual({
      contactEmail: 'Enter a valid email',
      contactPhone: 'Enter 7–15 digits, optionally starting with +',
      'policies.0.description': 'Describe the rule',
    });
  });

  it('room types need sensible whole numbers', () => {
    const room = { name: 'Deluxe', description: '', maxAdults: '2', maxChildren: '1', bedConfiguration: '1 King bed',
      sizeSqm: '', totalRooms: '10', status: 'ACTIVE', amenities: [] };
    expect(roomTypeSchema.safeParse(room).success).toBe(true);
    expect(errorsOf(roomTypeSchema.safeParse({ ...room, maxAdults: '0', totalRooms: '2.5', sizeSqm: 'big' }))).toEqual({
      maxAdults: 'Between 1 and 10',
      totalRooms: 'Whole number',
      sizeSqm: 'Between 1 and 10000 m²',
    });
  });

  it('a refundable plan needs a free period or a fee; non-refundable sends neither', () => {
    const plan = { name: 'Room only', basePricePerNight: '4500', breakfastIncluded: false, refundable: true,
      freeCancellationHours: '', cancellationFeePercent: '', status: 'ACTIVE' as const };
    expect(errorsOf(ratePlanSchema.safeParse(plan))).toEqual({
      freeCancellationHours: 'Give a free-cancellation period or a cancellation fee',
    });
    expect(errorsOf(ratePlanSchema.safeParse({ ...plan, freeCancellationHours: '48', basePricePerNight: '4500.555' }))).toEqual({
      basePricePerNight: 'Enter a price, e.g. 4500 or 4500.50',
    });
    expect(formToRatePlanRequest({ ...plan, refundable: false, freeCancellationHours: '48', cancellationFeePercent: '20' }))
      .toMatchObject({ refundable: false, freeCancellationHours: undefined, cancellationFeePercent: undefined, basePricePerNight: 4500 });
  });

  it('seasons and inventory changes need a valid range and something to change', () => {
    expect(errorsOf(seasonalRateSchema.safeParse({ label: 'Diwali', startDate: day(10), endDate: day(5), pricePerNight: '9000', priority: '1' })))
      .toEqual({ endDate: 'The last night must be on or after the first' });
    expect(errorsOf(inventoryUpdateSchema.safeParse({ roomTypeId: 'r1', from: day(3), to: day(4), totalRooms: '', stopSell: 'unchanged' })))
      .toEqual({ totalRooms: 'Change the number of rooms and/or stop-sell' });
    expect(inventoryUpdateSchema.safeParse({ roomTypeId: 'r1', from: day(3), to: day(4), totalRooms: '', stopSell: 'on' }).success).toBe(true);
  });
});
