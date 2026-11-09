import { addDays, format } from 'date-fns';
import { z } from 'zod';

import { todayIso } from '@/features/account/schemas';
import { MAX_NIGHTS, MAX_ROOMS, nightsOf } from './searchParams';

/** Same stay rules as hotel-service's StayValidator, checked before searching. */
export const hotelSearchSchema = z
  .object({
    destination: z.string().trim().min(2, 'Enter a city or hotel name'),
    checkIn: z.string().min(1, 'Choose a check-in date'),
    checkOut: z.string().min(1, 'Choose a check-out date'),
    rooms: z.number().int().min(1).max(MAX_ROOMS),
    adults: z.number().int().min(1).max(32),
    children: z.number().int().min(0).max(16),
    childAges: z.array(z.number().int()),
  })
  .superRefine((form, ctx) => {
    const today = todayIso();
    if (form.checkIn && form.checkIn < today) {
      ctx.addIssue({ code: 'custom', path: ['checkIn'], message: 'Check-in cannot be in the past' });
    }
    if (form.checkIn && form.checkOut) {
      if (form.checkOut <= form.checkIn) {
        ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Check-out must be after check-in' });
      } else if (nightsOf(form) > MAX_NIGHTS) {
        ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `A stay can be at most ${MAX_NIGHTS} nights` });
      }
      if (form.checkOut > format(addDays(new Date(), 365), 'yyyy-MM-dd')) {
        ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Rooms can be booked up to one year ahead' });
      }
    }
    if (form.adults < form.rooms) {
      ctx.addIssue({ code: 'custom', path: ['adults'], message: 'Every room needs at least one adult' });
    }
    for (let i = 0; i < form.children; i++) {
      const age = form.childAges[i];
      if (age === undefined || age < 0 || age > 17) {
        ctx.addIssue({ code: 'custom', path: ['childAges', i], message: 'Age needed' });
      }
    }
  });

export type HotelSearchForm = z.infer<typeof hotelSearchSchema>;
