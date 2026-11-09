import type { AxiosResponse } from 'axios';

import { accountApi } from '@/features/account/accountApi';
import { adminBookingApi } from '@/features/admin/bookings/adminBookingApi';
import { couponApi, offerApi } from '@/features/admin/coupons/couponApi';
import { adminPaymentApi } from '@/features/admin/payments/adminPaymentApi';
import { userApi } from '@/features/admin/users/userApi';
import { authApi } from '@/features/auth/authApi';
import { bookingApi } from '@/features/bookings/bookingApi';
import type { CreateHotelBookingBody } from '@/features/bookings/types';
import { adminHotelApi, managerApi } from '@/features/hotel-manager/managerApi';
import { operationsApi } from '@/features/hotel-manager/operationsApi';
import { hotelApi } from '@/features/hotels/hotelApi';
import { EMPTY_FILTERS } from '@/features/hotels/searchParams';
import { notificationApi } from '@/features/notifications/notificationApi';
import { paymentApi } from '@/features/payments/paymentApi';
import { reviewApi } from '@/features/reviews/reviewApi';
import { searchApi } from '@/features/search/searchApi';
import { agentTicketApi } from '@/features/support/agentTicketApi';
import { supportApi } from '@/features/support/supportApi';
import { ticketApi } from '@/features/tickets/ticketApi';
import { apiClient } from '@/lib/api/client';

/**
 * The request contract of the API modules (paths, query parameters, headers, bodies) and how they read the answers.
 * The page tests mock these modules, so this is where the HTTP side is checked. The HTTP client itself is stubbed.
 */

const ok = (data: unknown = {}, headers: Record<string, string> = {}) => ({ data, headers }) as AxiosResponse;
const stubGet = (data?: unknown, headers?: Record<string, string>) => vi.spyOn(apiClient, 'get').mockResolvedValue(ok(data, headers));
const stubPost = (data?: unknown) => vi.spyOn(apiClient, 'post').mockResolvedValue(ok(data));

const page = <T>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 });

describe('money-moving requests carry an idempotency key', () => {
  it('creating and cancelling bookings, paying and goodwill refunds', async () => {
    const post = stubPost();
    const hotelBooking: CreateHotelBookingBody = { quoteId: 'q1', contact: { email: 'a@example.com', phone: '+919876543210' },
      guests: [{ roomNo: 1, firstName: 'Asha', lastName: 'Rao' }] };

    await bookingApi.createHotelBooking(hotelBooking, 'key-1');
    await bookingApi.createFlightBooking({ tripOfferId: 't1' } as Parameters<typeof bookingApi.createFlightBooking>[0], 'key-2');
    await bookingApi.cancel('b/1', { expectedRefundAmount: 1200 }, 'key-3');
    await paymentApi.createOrder('b1', 'key-4');
    await adminBookingApi.goodwillRefund('b1', { amount: 500, reason: 'Late check-in' }, 'key-5');

    expect(post.mock.calls).toEqual([
      ['/bookings/hotel', hotelBooking, { headers: { 'Idempotency-Key': 'key-1' } }],
      ['/bookings/flight', { tripOfferId: 't1' }, { headers: { 'Idempotency-Key': 'key-2' } }],
      ['/bookings/b%2F1/cancel', { expectedRefundAmount: 1200 }, { headers: { 'Idempotency-Key': 'key-3' } }],
      ['/payments/create-order', { bookingId: 'b1' }, { headers: { 'Idempotency-Key': 'key-4' } }],
      ['/admin/bookings/b1/refunds', { amount: 500, reason: 'Late check-in' }, { headers: { 'Idempotency-Key': 'key-5' } }],
    ]);
  });
});

describe('authentication requests', () => {
  it('all go to /auth/, where the client never answers a 401 with a token refresh', async () => {
    const post = stubPost();

    await authApi.register({ email: 'a@example.com', password: 'Sunrise-trip-42', firstName: 'Asha', lastName: 'Rao', acceptTerms: true });
    await authApi.login({ email: 'a@example.com', password: 'wrong', rememberMe: true });
    await authApi.logout();
    await authApi.verifyEmail('tok');
    await authApi.resendVerification('a@example.com');
    await authApi.forgotPassword('a@example.com');
    await authApi.resetPassword({ token: 'tok', newPassword: 'Sunrise-trip-42' });

    expect(post.mock.calls.map((call) => call[0])).toEqual([
      '/auth/register', '/auth/login', '/auth/logout', '/auth/verify-email', '/auth/resend-verification', '/auth/forgot-password',
      '/auth/reset-password',
    ]);
    expect(post.mock.calls[1]?.[1]).toEqual({ email: 'a@example.com', password: 'wrong', rememberMe: true });
    expect(post.mock.calls[3]?.[1]).toEqual({ token: 'tok' });
  });
});

describe('portal sign-in (Phase 11)', () => {
  it('names the portal in the login body, and a refused session can be ended with its own token', async () => {
    const post = stubPost();

    await authApi.login({ email: 'a@example.com', password: 'pw', rememberMe: false, portal: 'HOTEL_MANAGER' });
    await authApi.logout('token-1');

    expect(post.mock.calls[0]).toEqual(['/auth/login', { email: 'a@example.com', password: 'pw', rememberMe: false, portal: 'HOTEL_MANAGER' }]);
    expect(post.mock.calls[1]).toEqual(['/auth/logout', null, { headers: { Authorization: 'Bearer token-1' } }]);
  });
});

describe('ids in paths are URL-encoded', () => {
  it('for nested hotel-manager resources and customer resources', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue(ok());
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue(ok());
    const get = stubGet();

    await managerApi.updateRatePlan('h 1', 'r/1', 'p?1', {} as Parameters<typeof managerApi.updateRatePlan>[3]);
    await managerApi.deleteSeasonalRate('h1', 'r1', 'p1', 's#1');
    await accountApi.deletePassenger('p/1');
    await bookingApi.details('b/1');
    await ticketApi.get('t/1');

    expect(put).toHaveBeenCalledWith('/hotel-manager/hotels/h%201/room-types/r%2F1/rate-plans/p%3F1', {});
    expect(del.mock.calls.map((call) => call[0])).toEqual([
      '/hotel-manager/hotels/h1/room-types/r1/rate-plans/p1/seasonal-rates/s%231',
      '/customers/passengers/p%2F1',
    ]);
    expect(get.mock.calls.map((call) => call[0])).toEqual(['/bookings/b%2F1', '/support/tickets/t%2F1']);
  });
});

describe('list filters leave out what is not set', () => {
  it('admin lists', async () => {
    const get = stubGet(page([]));

    await couponApi.list({ q: '', status: '', page: 0 });
    await offerApi.list({ q: 'DIWALI', status: 'ACTIVE', page: 2 }, 50);
    await adminPaymentApi.list({ q: '', status: '', provider: '', from: '', to: '', page: 0 });
    await adminPaymentApi.refunds({ q: 'HT-1', status: 'FAILED', from: '2026-11-01', to: '', page: 1 });
    await userApi.list({ search: '', role: 'ADMIN', status: '', page: 0, sort: 'createdAt,desc' });
    await adminBookingApi.list({ q: '', status: '', type: 'HOTEL', from: '', to: '', attention: false, page: 0 });
    await adminHotelApi.list({ search: '', page: 3 });

    expect(get.mock.calls).toEqual([
      ['/admin/coupons', { params: { q: undefined, status: undefined, page: 0, size: 20 } }],
      ['/admin/offers', { params: { q: 'DIWALI', status: 'ACTIVE', page: 2, size: 50 } }],
      ['/admin/payments', { params: { q: undefined, status: undefined, provider: undefined, method: undefined, bookingType: undefined, from: undefined, to: undefined, page: 0, size: 20, sort: undefined } }],
      ['/admin/refunds', { params: { q: 'HT-1', status: 'FAILED', from: '2026-11-01', to: undefined, page: 1, size: 20 } }],
      ['/admin/users', { params: { search: undefined, role: 'ADMIN', status: undefined, page: 0, size: 20, sort: 'createdAt,desc' } }],
      ['/admin/bookings', { params: { q: undefined, status: undefined, type: 'HOTEL', from: undefined, to: undefined, attention: undefined, page: 0, size: 20, sort: undefined } }],
      ['/admin/hotels', { params: { search: undefined, status: undefined, page: 3, size: 20 } }],
    ]);
  });

  it('support and customer lists', async () => {
    const get = stubGet(page([]));

    await agentTicketApi.queue({ q: '', status: 'OPEN', category: '', priority: '', assigned: 'ME', sort: 'updatedAt,desc', page: 0 });
    await supportApi.searchBookings({ q: 'HT-7K3M9Q2X', status: '', type: '', attention: true, page: 0 });
    await ticketApi.list({ status: '', page: 1 });
    await notificationApi.search({ unreadOnly: true, category: '', page: 0 });
    await notificationApi.list();

    expect(get.mock.calls).toEqual([
      ['/admin/support/tickets', { params: { q: undefined, status: 'OPEN', category: undefined, priority: undefined, assigned: 'ME', sort: 'updatedAt,desc', page: 0, size: 20 } }],
      ['/support/bookings', { params: { q: 'HT-7K3M9Q2X', status: undefined, type: undefined, attention: true, page: 0, size: 20 } }],
      ['/support/tickets', { params: { status: undefined, page: 1, size: 10 } }],
      ['/notifications', { params: { unreadOnly: true, category: undefined, page: 0, size: 20 } }],
      ['/notifications', { params: { page: 0, size: 10 } }],
    ]);
  });

  it('hotel reservations send the date field only with a date', async () => {
    const get = stubGet(page([]));
    const filters = { status: '' as const, dateField: 'CHECK_IN' as const, from: '', to: '', q: '', sort: 'checkIn,asc' as const, page: 0 };

    await operationsApi.reservations('h1', filters);
    await operationsApi.reservations('h1', { ...filters, to: '2026-11-30', status: 'CONFIRMED' });

    expect(get.mock.calls[0]?.[1]).toEqual({ params: { status: undefined, from: undefined, to: undefined, dateField: undefined, q: undefined, sort: 'checkIn,asc', page: 0, size: 20 } });
    expect(get.mock.calls[1]?.[1]).toEqual({ params: { status: 'CONFIRMED', from: undefined, to: '2026-11-30', dateField: 'CHECK_IN', q: undefined, sort: 'checkIn,asc', page: 0, size: 20 } });
  });

  it('hotel search asks for available hotels unless full ones are wanted', async () => {
    const get = stubGet({ content: [] });
    const stay = { checkIn: '2099-03-10', checkOut: '2099-03-12', rooms: 1, adults: 2, children: 0, childAges: [] };

    await hotelApi.search({ destination: 'Goa', stay, filters: EMPTY_FILTERS });
    await hotelApi.search({ destination: 'Goa', stay, filters: { ...EMPTY_FILTERS, showUnavailable: true, page: 2 } }, 10);

    expect(get.mock.calls[0]?.[0]).toBe('/hotels/search?destination=Goa&checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2&availableOnly=true&page=0&size=20');
    expect(get.mock.calls[1]?.[0]).toBe('/hotels/search?destination=Goa&checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2&page=2&availableOnly=false&size=10');
  });
});

describe('optional request parts are only sent when given', () => {
  it('notes, agents, reasons and fee waivers', async () => {
    const post = stubPost();
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue(ok());
    const get = stubGet();

    await supportApi.resolve('b1');
    await supportApi.resolve('b1', 'Refund confirmed by the bank');
    await agentTicketApi.assign('t1');
    await agentTicketApi.assign('t1', 'agent-7');
    await userApi.changeStatus('u1', 'DEACTIVATED', '');
    await bookingApi.cancellationQuote('b1');
    await bookingApi.cancellationQuote('b1', true);

    expect(post.mock.calls).toEqual([
      ['/support/bookings/b1/resolve', {}],
      ['/support/bookings/b1/resolve', { note: 'Refund confirmed by the bank' }],
      ['/admin/support/tickets/t1/assign', {}],
      ['/admin/support/tickets/t1/assign', { agentId: 'agent-7' }],
    ]);
    expect(patch).toHaveBeenCalledWith('/admin/users/u1/status', { status: 'DEACTIVATED', reason: undefined });
    expect(get.mock.calls).toEqual([
      ['/bookings/b1/cancellation-quote', { params: undefined }],
      ['/bookings/b1/cancellation-quote', { params: { waiveFee: true } }],
    ]);
  });

  it('uploads send the file as form data, with caption and room only when chosen', async () => {
    const post = stubPost();
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue(ok());
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    await managerApi.uploadImage('h1', file);
    await managerApi.uploadImage('h1', file, 'Pool', 'rt1');
    await accountApi.uploadPhoto(file);

    const [plain, withRoom] = post.mock.calls.map((call) => call[1] as FormData);
    expect([...plain!.keys()]).toEqual(['file']);
    expect(Object.fromEntries(withRoom!.entries())).toEqual({ file: expect.any(File), caption: 'Pool', roomTypeId: 'rt1' });
    expect(post.mock.calls[0]?.[0]).toBe('/hotel-manager/hotels/h1/images');
    expect(put.mock.calls[0]?.[0]).toBe('/customers/profile/photo');
    expect((put.mock.calls[0]?.[1] as FormData).get('file')).toBe(file);
  });
});

describe('answers are read the same way whatever shape the server uses', () => {
  it('review lists accept a plain list, a page or nothing', async () => {
    const review = { id: 'rv1' };
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce(ok([review]))
      .mockResolvedValueOnce(ok(page([review])))
      .mockResolvedValueOnce(ok(null));

    await expect(reviewApi.eligible()).resolves.toEqual([review]);
    await expect(reviewApi.mine()).resolves.toEqual([review]);
    await expect(reviewApi.featured(4)).resolves.toEqual([]);
    expect(get.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['/reviews/eligible'], ['/reviews/mine', { params: { size: 100 } }], ['/reviews/featured', { params: { limit: 4 } }],
    ]);
  });

  it('hotel reviews come flat or nested under "reviews", with or without a summary', async () => {
    const query = { page: 1, size: 5, sort: 'RECENT' as const };
    const summary = { average: 4.4, count: 12, distribution: { 5: 8, 4: 4 } };
    vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce(ok({ ...page([{ id: 'rv1' }]), summary }))
      .mockResolvedValueOnce(ok({ reviews: { ...page([{ id: 'rv2' }]), totalElements: 7, totalPages: 2 }, summary }))
      .mockResolvedValueOnce(ok({}));

    await expect(reviewApi.forHotel('sea breeze', query)).resolves.toEqual({
      content: [{ id: 'rv1' }], page: 0, size: 20, totalElements: 1, totalPages: 1, summary,
    });
    await expect(reviewApi.forHotel('h1', query)).resolves.toMatchObject({ content: [{ id: 'rv2' }], totalElements: 7, totalPages: 2 });
    await expect(reviewApi.forHotel('h1', query)).resolves.toEqual({
      content: [], page: 1, size: 5, totalElements: 0, totalPages: 0, summary: { average: null, count: 0, distribution: {} },
    });
    expect(vi.mocked(apiClient.get).mock.calls[0]).toEqual(['/hotels/sea%20breeze/reviews', { params: query }]);
  });

  it('notification counts', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValueOnce(ok({ count: 4 }));
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce(ok({ updated: 3 })).mockResolvedValueOnce(ok('')).mockResolvedValueOnce(ok({}));

    await expect(notificationApi.unreadCount()).resolves.toBe(4);
    await expect(notificationApi.markAllRead()).resolves.toBe(3);
    await expect(notificationApi.markAllRead()).resolves.toBe(0);
    await expect(notificationApi.markAllRead()).resolves.toBe(0);
  });
});

describe('file downloads', () => {
  it('ask for the file type (not JSON)', async () => {
    const get = stubGet(new Blob(['jpeg']));

    await accountApi.getPhoto();

    expect(get.mock.calls[0]).toEqual(['/customers/profile/photo', { responseType: 'blob', headers: { Accept: 'image/jpeg' } }]);
  });
});

describe('global search', () => {
  it('asks search-service for suggestions and results, with the signal that cancels a request typed past', async () => {
    const answer = { query: 'goa', tookMs: 3, groups: [] };
    const get = stubGet(answer);
    const { signal } = new AbortController();

    await expect(searchApi.suggest('goa beach', signal)).resolves.toEqual(answer);
    await searchApi.search({ q: 'goa' });
    await searchApi.search({ q: 'goa', category: 'BOOKINGS', page: 2, size: 25 }, signal);

    expect(get.mock.calls).toEqual([
      ['/search/suggest', { params: { q: 'goa beach' }, signal }],
      ['/search', { params: { q: 'goa', category: 'ALL', page: 0, size: 10 }, signal: undefined }],
      ['/search', { params: { q: 'goa', category: 'BOOKINGS', page: 2, size: 25 }, signal }],
    ]);
  });
});
