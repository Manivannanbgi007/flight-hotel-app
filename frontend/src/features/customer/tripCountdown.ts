import type { NextTrip } from './summaryApi';

/** "Today", "Tomorrow", "In 9 days", "In progress": what the countdown says, in words. */
export function countdownOf(trip: Pick<NextTrip, 'daysUntil' | 'inProgress' | 'type'>): { big: string; small: string; sentence: string } {
  const verb = trip.type === 'FLIGHT' ? 'Departs' : 'Check-in';
  if (trip.inProgress) {
    return { big: 'Now', small: 'in progress', sentence: 'This trip is in progress' };
  }
  if (trip.daysUntil <= 0) {
    return { big: 'Today', small: trip.type === 'FLIGHT' ? 'departure' : 'check-in', sentence: `${verb} today` };
  }
  if (trip.daysUntil === 1) {
    return { big: '1', small: 'day to go', sentence: `${verb} tomorrow` };
  }
  return { big: String(trip.daysUntil), small: 'days to go', sentence: `${verb} in ${trip.daysUntil} days` };
}
