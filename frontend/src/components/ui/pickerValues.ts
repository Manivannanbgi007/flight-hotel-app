import { format, isValid, parse } from 'date-fns';
import type { Modifiers } from 'react-day-picker';

/**
 * Values of the date and time fields. Dates are ISO dates ("2026-12-12") read as LOCAL calendar days, never as UTC
 * instants; times are 24-hour "HH:mm" — the same strings native date and time inputs used, so forms and the API did not
 * change.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-12-12" → the local day; undefined for '' or anything that is not a real day. */
export function isoToDate(iso: string | null | undefined): Date | undefined {
  const match = iso ? ISO_DATE.exec(iso) : null;
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

export const dateToIso = (date: Date): string => format(date, 'yyyy-MM-dd');

/** "2026-12-12" → "Sat, 12 Dec 2026" (what a date field shows). */
export function formatFieldDate(iso: string | null | undefined): string {
  const date = isoToDate(iso);
  return date ? format(date, 'EEE, d MMM yyyy') : '';
}

/**
 * A day's name starts with the number it shows ("12 December 2026, Saturday"), so the visible label is part of the
 * name (WCAG 2.5.3, label in name) for speech input.
 */
export function labelDay(date: Date, modifiers?: Modifiers): string {
  return [format(date, 'd MMMM yyyy, EEEE'), modifiers?.today && 'today', modifiers?.selected && 'selected']
    .filter(Boolean)
    .join(', ');
}

/** Day first, as written in India; ISO and spelled-out months also work. */
const TYPED_DATE_FORMATS = [
  'yyyy-MM-dd',
  'd/M/yyyy',
  'd-M-yyyy',
  'd.M.yyyy',
  'd MMM yyyy',
  'd MMMM yyyy',
  'd MMM, yyyy',
  'MMM d, yyyy',
  'MMMM d, yyyy',
  'MMM d yyyy',
];
const REFERENCE_DAY = new Date(2000, 0, 1);
const LEADING_WEEKDAY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(?=\d)/i;

/**
 * What a person typed into a date field → an ISO date, or null when it is not (yet) a whole date. A four-digit year is
 * required, so "12/4/19" is not taken for the year 19. A leading weekday ("Sat, 12 Dec 2026", the field's own text) is
 * ignored rather than trusted.
 */
export function parseTypedDate(text: string): string | null {
  const value = text.trim().replace(/\s+/g, ' ').replace(LEADING_WEEKDAY, '');
  // ISO only in full: "2026-12-1" is half of "2026-12-15", not the 1st.
  if (/^\d{4}-/.test(value)) return isoToDate(value) ? value : null;
  if (!/\b\d{4}\b/.test(value)) return null;
  for (const pattern of TYPED_DATE_FORMATS) {
    const date = parse(value, pattern, REFERENCE_DAY);
    if (isValid(date) && date.getFullYear() >= 1000 && date.getFullYear() <= 9999) return dateToIso(date);
  }
  return null;
}

const TIME = /^(\d{1,2})(?:[:.]?(\d{2}))?(?:\s*([ap])\.?\s*m?\.?)?$/i;

/** "14:00", "1400", "2pm", "2:30 PM", "9" → "HH:mm"; null when it is not a time. */
export function parseTypedTime(text: string): string | null {
  const match = TIME.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const half = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (half === 'p' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Whether typed time text is finished: it has minutes ("14:30", "1430") or AM/PM. "1" may still become "11:30" and
 * "143" "14:30", so the field waits; when focus leaves, a short time ("9", "930") is taken as it is.
 */
export function isCompleteTime(text: string): boolean {
  return /(\d{4}|[:.]\d{2})\s*$|[ap]\.?\s*m?\.?\s*$/i.test(text.trim());
}

/** "14:30" → minutes since midnight; NaN for anything else. */
export function timeToMinutes(time: string | null | undefined): number {
  const match = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "14:30" → "2:30 PM" (shown next to each suggested time). */
export function formatTime12h(time: string): string {
  const minutes = timeToMinutes(time);
  if (Number.isNaN(minutes)) return '';
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}
