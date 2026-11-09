import { describe, expect, it, beforeEach } from 'vitest';

import { arrivalDayOffset, baggageLabel, describePassengers, formatDuration, layoverMinutes, stopsLabel, timeOf, dateOf } from './flightFormat';
import { clearFlightDraft, loadFlightDraft, recallPassportNumbers, rememberPassportNumbers, saveFlightDraft, type FlightDraft } from './flightDraft';
import { ageOn, flightPassengersSchema, passengerLabel, passengerSlots, type PassengerFormValues } from './passengerSchema';
import { highlightsOf, sortSummaries } from './resultInsights';
import { optionFixture, searchFixture } from './testData';

describe('flight formatting', () => {
  it('formats durations, stops, times and baggage', () => {
    expect(formatDuration(130)).toBe('2h 10m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(stopsLabel(0, null)).toBe('Non-stop');
    expect(stopsLabel(1, 'HYD')).toBe('1 stop via HYD');
    expect(stopsLabel(2, null)).toBe('2 stops');
    expect(timeOf('2099-03-10T06:45')).toBe('06:45');
    expect(dateOf('2099-03-10T06:45')).toBe('2099-03-10');
    expect(baggageLabel(15, 7)).toBe('Check-in 15 kg · Cabin 7 kg');
    expect(describePassengers({ adults: 2, children: 1, infants: 1 })).toBe('2 adults, 1 child, 1 infant');
  });

  it('shows when a flight lands on a later day and how long a layover is', () => {
    expect(arrivalDayOffset('2099-03-10T22:30', '2099-03-11T01:50')).toBe('+1 day');
    expect(arrivalDayOffset('2099-03-10T06:45', '2099-03-10T08:55')).toBe('');
    expect(layoverMinutes('2099-03-10T08:00', '2099-03-10T09:15')).toBe(75);
    expect(layoverMinutes('2099-03-10T23:30', '2099-03-11T00:30')).toBe(60);
  });
});

describe('result insights', () => {
  const options = searchFixture().outbound.options;

  it('gives the best value of each sort order among the flights on screen', () => {
    expect(sortSummaries(options)).toEqual({
      PRICE_ASC: '₹4,800',
      DURATION_ASC: '2h 5m',
      DEPARTURE_ASC: '06:45',
      ARRIVAL_ASC: '08:55',
    });
    expect(sortSummaries([])).toBeNull();
  });

  it('adds the day to an earliest arrival on a later day', () => {
    const night = optionFixture({ departureLocal: '2099-03-10T22:30', arrivalLocal: '2099-03-11T01:50' });
    expect(sortSummaries([night])?.ARRIVAL_ASC).toBe('01:50 +1 day');
  });

  it('tags the cheapest and the fastest flights, ties included, but not when all are the same', () => {
    const tags = highlightsOf(options);
    expect(tags.get('offer-2')).toEqual({ cheapest: true, fastest: true });
    expect(tags.get('offer-1')).toEqual({ cheapest: false, fastest: false });

    const twins = [optionFixture({ offerId: 'a', totalPrice: 5000 }), optionFixture({ offerId: 'b', totalPrice: 5000, durationMinutes: 150 })];
    expect(highlightsOf(twins).get('a')).toEqual({ cheapest: false, fastest: true });
    expect(highlightsOf(twins).get('b')).toEqual({ cheapest: false, fastest: false });
    const sharedBest = [...twins, optionFixture({ offerId: 'c', totalPrice: 7000 })];
    expect([...highlightsOf(sharedBest).values()].map((t) => t.cheapest)).toEqual([true, true, false]);
  });
});

describe('passenger slots and labels', () => {
  it('lists adults first, then children, then infants', () => {
    const slots = passengerSlots({ adults: 2, children: 1, infants: 1 });

    expect(slots).toEqual(['ADULT', 'ADULT', 'CHILD', 'INFANT']);
    expect(slots.map((_, i) => passengerLabel(slots, i))).toEqual(['Adult 1', 'Adult 2', 'Child 1', 'Infant 1']);
  });
});

describe('passenger rules', () => {
  const base: PassengerFormValues = { passengerType: 'ADULT', firstName: 'Asha', lastName: 'Rao', dateOfBirth: '', gender: '', nationality: '', passportNumber: '', passportExpiry: '', passportCountry: '' };
  const contact = { contactEmail: 'asha@example.com', contactPhone: '+91 98000 00000', couponCode: '' };
  const domestic = flightPassengersSchema({ international: false, firstDeparture: '2099-03-10', lastDeparture: '2099-03-10' });
  const international = flightPassengersSchema({ international: true, firstDeparture: '2099-03-10', lastDeparture: '2099-03-20' });
  const problems = (schema: typeof domestic, passenger: PassengerFormValues) =>
    schema.safeParse({ passengers: [passenger], ...contact }).error?.issues.map((issue) => issue.message) ?? [];

  it('works out ages on a date', () => {
    expect(ageOn('2090-03-11', '2099-03-10')).toBe(8);
    expect(ageOn('2090-03-10', '2099-03-10')).toBe(9);
    expect(ageOn('nonsense', '2099-03-10')).toBeNull();
  });

  it('accepts an adult without date of birth on a domestic trip, and needs no passport', () => {
    expect(problems(domestic, base)).toEqual([]);
  });

  it('needs the date of birth of children and infants', () => {
    expect(problems(domestic, { ...base, passengerType: 'CHILD' })).toEqual(['Enter the date of birth']);
    expect(problems(domestic, { ...base, passengerType: 'INFANT' })).toEqual(['Enter the date of birth']);
  });

  it.each([
    ['ADULT', '2090-01-01', 'Adults must be 12 or older on the travel date'],
    ['CHILD', '2098-01-01', 'A child must be at least 2 on the travel date; book this traveller as an infant'],
    ['CHILD', '2080-01-01', 'Travellers of 12 and older travel as adults'],
    ['INFANT', '2095-01-01', 'An infant must be under 2 on every flight; book this traveller as a child'],
    ['ADULT', '2099-04-01', 'The date of birth must be in the past'],
  ] as const)('refuses a %s born %s', (type, dob, message) => {
    expect(problems(domestic, { ...base, passengerType: type, dateOfBirth: dob })).toEqual([message]);
  });

  it('accepts a child of 2–11 and an infant under 2', () => {
    expect(problems(domestic, { ...base, passengerType: 'CHILD', dateOfBirth: '2092-06-01' })).toEqual([]);
    expect(problems(domestic, { ...base, passengerType: 'INFANT', dateOfBirth: '2098-12-01' })).toEqual([]);
  });

  it('an infant must still be under 2 on the return flight', () => {
    // 1 year 10 months old on the way out, but 2 on the way back.
    const roundTrip = flightPassengersSchema({ international: false, firstDeparture: '2099-03-10', lastDeparture: '2099-05-10' });
    expect(problems(roundTrip, { ...base, passengerType: 'INFANT', dateOfBirth: '2097-05-01' }))
      .toEqual(['An infant must be under 2 on every flight; book this traveller as a child']);
  });

  it('asks for passport number, expiry and country only on international trips', () => {
    expect(problems(international, base)).toEqual([
      'Enter the passport number (5–20 letters and digits)', 'Enter the passport expiry date', 'Choose the issuing country',
    ]);
    expect(problems(international, { ...base, passportNumber: 'n1234567', passportExpiry: '2099-03-15', passportCountry: 'IN' }))
      .toEqual(['The passport must be valid on the last travel date']);
    expect(problems(international, { ...base, passportNumber: 'n1234567', passportExpiry: '2105-01-01', passportCountry: 'IN' })).toEqual([]);
  });

  it('checks the contact like the booking API does', () => {
    const result = domestic.safeParse({ passengers: [base], contactEmail: 'nope', contactPhone: '12', couponCode: 'BAD CODE' });
    expect(result.error?.issues.map((i) => i.message)).toEqual(expect.arrayContaining([
      'Enter a valid email address', 'Enter 7–15 digits, optionally starting with +', 'Coupon codes only contain letters, digits and -',
    ]));
  });
});

describe('flight draft', () => {
  const draft: FlightDraft = {
    tripOfferId: 't1',
    contact: { email: 'asha@example.com', phone: '+91 98000 00000' },
    passengers: [{ passengerType: 'ADULT', firstName: 'Asha', lastName: 'Rao', dateOfBirth: '', gender: '', nationality: 'IN', passportExpiry: '2105-01-01', passportCountry: 'IN' }],
    couponCode: '',
  };

  beforeEach(() => sessionStorage.clear());

  it('is kept per trip offer and can be removed', () => {
    saveFlightDraft(draft);
    expect(loadFlightDraft('t1')).toEqual(draft);
    expect(loadFlightDraft('other')).toBeNull();
    clearFlightDraft('t1');
    expect(loadFlightDraft('t1')).toBeNull();
  });

  it('never writes a passport number to the browser storage; it only lives in memory', () => {
    saveFlightDraft(draft);
    rememberPassportNumbers('t1', ['N1234567']);

    expect(JSON.stringify(sessionStorage)).not.toContain('N1234567');
    expect(JSON.stringify(localStorage)).not.toContain('N1234567');
    expect(recallPassportNumbers('t1')).toEqual(['N1234567']);
    clearFlightDraft('t1');
    expect(recallPassportNumbers('t1')).toEqual([]);
  });

  it('ignores damaged storage', () => {
    sessionStorage.setItem('flight-draft:t1', '{broken');
    expect(loadFlightDraft('t1')).toBeNull();
  });
});
