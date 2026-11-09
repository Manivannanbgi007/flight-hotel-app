import { z } from 'zod';

import type { ReviewSort, ReviewStatus } from './types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** How my review's moderation status is shown to me. */
export const reviewStatusInfo: Record<ReviewStatus, { label: string; tone: Tone; description: string }> = {
  PENDING: { label: 'Waiting for approval', tone: 'warning', description: 'We check every review before it is published. This usually takes a day or two.' },
  APPROVED: { label: 'Published', tone: 'success', description: 'Everyone can read it on the hotel page.' },
  REJECTED: { label: 'Not published', tone: 'danger', description: 'It does not meet our review guidelines.' },
};

export const reviewSortLabels: Record<ReviewSort, string> = {
  RECENT: 'Most recent',
  HIGHEST: 'Highest rating',
  LOWEST: 'Lowest rating',
};

export const REVIEW_SORTS = Object.keys(reviewSortLabels) as ReviewSort[];

export const TITLE_MIN = 3;
export const TITLE_MAX = 100;
export const TEXT_MIN = 20;
export const TEXT_MAX = 2000;
export const REPORT_MIN = 5;
export const REPORT_MAX = 300;

/** Same limits as the API: rating 1–5, title 3–100, text 20–2000 characters. */
export const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Choose a rating from 1 to 5 stars').max(5, 'Choose a rating from 1 to 5 stars'),
  title: z.string().trim()
    .min(TITLE_MIN, `Use at least ${TITLE_MIN} characters`)
    .max(TITLE_MAX, `Use at most ${TITLE_MAX} characters`),
  text: z.string().trim()
    .min(TEXT_MIN, `Write at least ${TEXT_MIN} characters`)
    .max(TEXT_MAX, 'Please keep it under 2,000 characters'),
});
export type ReviewForm = z.infer<typeof reviewSchema>;

/** Report a review: a reason of 5–300 characters. */
export const reportSchema = z.object({
  reason: z.string().trim()
    .min(REPORT_MIN, `Use at least ${REPORT_MIN} characters`)
    .max(REPORT_MAX, `Use at most ${REPORT_MAX} characters`),
});
export type ReportForm = z.infer<typeof reportSchema>;
