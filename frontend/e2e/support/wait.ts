import { expect } from '@playwright/test';

/**
 * Polls `probe` until it returns a value (not null/undefined) and returns that value. For asynchronous back-end work
 * (Kafka sagas, e-mails) instead of fixed sleeps.
 */
export async function eventually<T>(what: string, probe: () => Promise<T | null | undefined>, timeout = 60_000): Promise<T> {
  let value: T | null | undefined;
  await expect
    .poll(async () => {
      value = await probe();
      return value !== null && value !== undefined;
    }, { message: `Waiting for ${what}`, timeout, intervals: [500, 1_000, 2_000] })
    .toBe(true);
  return value as T;
}

/** `YYYY-MM-DD`, `days` from today (local time). */
export function isoDate(days: number, from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A day between `min` and `max` days ahead. Each run books a different day, so leftovers of an aborted run (a held
 * room, a sold seat) never block the next one. The seeded hotels sell 365 days ahead, the demo airline 330.
 */
export function randomDaysAhead(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** A short unique suffix for e-mail addresses. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
