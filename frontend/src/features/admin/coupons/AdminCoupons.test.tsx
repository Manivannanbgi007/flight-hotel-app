import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { couponApi, offerApi, type AdminCoupon, type AdminOffer } from './couponApi';
import { AdminCouponsPage } from './AdminCouponsPage';
import { AdminOffersPage } from './AdminOffersPage';
import { couponFormDefaults, couponSchema, toCouponBody } from './couponSchemas';

vi.mock('./couponApi', () => ({
  couponApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn() },
  offerApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn() },
}));

const coupon = (overrides: Partial<AdminCoupon> = {}): AdminCoupon => ({
  id: 'c1', code: 'WELCOME10', title: 'Welcome offer', description: 'For your first trip', discountType: 'PERCENT', discountValue: 10,
  maxDiscount: 1500, minBookingAmount: 2000, appliesTo: 'ALL', destinationCity: null, validFrom: '2026-11-01T00:00:00+05:30',
  validTo: '2026-12-31T23:59:59+05:30', usageLimit: 100, perCustomerLimit: 1, usedCount: 12, reservedCount: 2, consumedCount: 10,
  status: 'ACTIVE', expired: false, demo: true, version: 3, ...overrides,
});

const offer = (overrides: Partial<AdminOffer> = {}): AdminOffer => ({
  id: 'o1', title: 'Goa in winter', description: 'Beach stays', couponId: 'c1', couponCode: 'WELCOME10', couponStatus: 'ACTIVE',
  discountLabel: '10% off, up to ₹1,500', appliesTo: 'HOTEL', destinationCity: 'Goa', validFrom: '2026-11-01T00:00:00+05:30',
  validTo: '2026-12-31T23:59:59+05:30', seasonal: true, theme: 'OCEAN', status: 'ACTIVE', live: true, demo: false, version: 1, ...overrides,
});

const routes = [
  { path: '/admin/coupons', element: <AdminCouponsPage /> },
  { path: '/admin/offers', element: <AdminOffersPage /> },
];

describe('AdminCouponsPage', () => {
  it('lists coupons with discount, validity and usage', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon(), coupon({ id: 'c2', code: 'STAY500', discountType: 'FIXED', discountValue: 500,
      maxDiscount: null, minBookingAmount: 0, usageLimit: null, status: 'INACTIVE', expired: true, demo: false })]));
    renderAdmin(routes, '/admin/coupons');

    const table = await screen.findByRole('table', { name: 'Coupons' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('WELCOME10Demo');
    expect(first).toHaveTextContent('10% off, up to ₹1,500 (bookings from ₹2,000)');
    expect(first).toHaveTextContent('1 Nov 2026 – 31 Dec 2026');
    expect(first).toHaveTextContent('12 of 100');
    expect(first).toHaveTextContent('10 paid · 2 reserved');
    expect(second).toHaveTextContent('₹500 off');
    expect(within(second!).getByText('Expired')).toBeInTheDocument();
    expect(within(second!).getByText('Inactive')).toBeInTheDocument();
  });

  it('creates a coupon after checking the backend rules, with India-day dates as instants', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([]));
    vi.mocked(couponApi.create).mockResolvedValue(coupon({ code: 'DIWALI15' }));
    const { user } = renderAdmin(routes, '/admin/coupons');

    await user.click(await screen.findByRole('button', { name: 'New coupon' }));
    const dialog = screen.getByRole('dialog', { name: 'New coupon' });
    await user.type(within(dialog).getByLabelText('Code'), 'di wali');
    await user.type(within(dialog).getByLabelText('Discount (%)'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(within(dialog).getByText('Use letters, digits and - only')).toBeInTheDocument();
    expect(within(dialog).getByText('Use at least 3 characters')).toBeInTheDocument();
    expect(within(dialog).getByText('A percentage can be at most 100')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose the start date')).toBeInTheDocument();
    expect(couponApi.create).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Code'));
    await user.type(within(dialog).getByLabelText('Code'), 'diwali15');
    await user.type(within(dialog).getByLabelText('Title'), 'Diwali deal');
    await user.clear(within(dialog).getByLabelText('Discount (%)'));
    await user.type(within(dialog).getByLabelText('Discount (%)'), '15');
    await user.type(within(dialog).getByLabelText(/Maximum discount/), '2000');
    await user.selectOptions(within(dialog).getByLabelText('Applies to'), 'Hotels');
    await user.type(within(dialog).getByLabelText('Valid from'), '2026-11-10');
    await user.type(within(dialog).getByLabelText('Valid until'), '2026-11-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(within(dialog).getByText('The end date cannot be before the start date')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Valid until'));
    await user.type(within(dialog).getByLabelText('Valid until'), '2026-11-20');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));

    await waitFor(() => expect(couponApi.create).toHaveBeenCalledWith({
      code: 'DIWALI15', status: 'ACTIVE', title: 'Diwali deal', description: null, discountType: 'PERCENT', discountValue: 15, maxDiscount: 2000,
      minBookingAmount: 0, appliesTo: 'HOTEL', destinationCity: null, validFrom: '2026-11-10T00:00:00+05:30', validTo: '2026-11-20T23:59:59+05:30',
      usageLimit: null, perCustomerLimit: 1,
    }));
    expect(await screen.findByText('Coupon DIWALI15 created.')).toBeInTheDocument();
  });

  it('puts "code taken" next to the code', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([]));
    vi.mocked(couponApi.create).mockRejectedValue(new ApiError(409, 'COUPON_CODE_TAKEN', 'This code is already used by another coupon.'));
    const { user } = renderAdmin(routes, '/admin/coupons');

    await user.click(await screen.findByRole('button', { name: 'New coupon' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'WELCOME10');
    await user.type(within(dialog).getByLabelText('Title'), 'Again');
    await user.type(within(dialog).getByLabelText('Discount (%)'), '10');
    await user.type(within(dialog).getByLabelText('Valid from'), '2026-11-10');
    await user.type(within(dialog).getByLabelText('Valid until'), '2026-11-20');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));

    expect(await within(dialog).findByText('This code is already used by another coupon.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('changes a coupon with its version (the code cannot change) and refuses a limit below the usage', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon()]));
    vi.mocked(couponApi.update).mockResolvedValue(coupon({ version: 4 }));
    const { user } = renderAdmin(routes, '/admin/coupons');

    await user.click(await screen.findByRole('button', { name: 'Change WELCOME10' }));
    const dialog = screen.getByRole('dialog', { name: 'Change WELCOME10' });
    expect(within(dialog).getByLabelText('Code')).toBeDisabled();
    expect(within(dialog).getByLabelText('Valid from')).toHaveValue('Sun, 1 Nov 2026');
    expect(within(dialog).getByLabelText('Valid until')).toHaveValue('Thu, 31 Dec 2026');
    await user.clear(within(dialog).getByLabelText(/Usage limit/));
    await user.type(within(dialog).getByLabelText(/Usage limit/), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(within(dialog).getByText('Already used 12 times: the limit cannot be lower')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/Usage limit/));
    await user.type(within(dialog).getByLabelText(/Usage limit/), '200');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(couponApi.update).toHaveBeenCalledWith('c1', expect.objectContaining({ version: 3, usageLimit: 200 })));
    expect(vi.mocked(couponApi.update).mock.calls[0]![1]).not.toHaveProperty('code');
  });

  it('tells the admin when someone else changed the coupon first', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon()]));
    vi.mocked(couponApi.update).mockRejectedValue(new ApiError(409, 'CONCURRENT_MODIFICATION', 'Someone else changed this.', [], 'corr-6'));
    const { user } = renderAdmin(routes, '/admin/coupons');

    await user.click(await screen.findByRole('button', { name: 'Change WELCOME10' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/Someone else changed this coupon/)).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-6')).toBeInTheDocument();
  });

  it('switches a coupon off and on', async () => {
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon(), coupon({ id: 'c2', code: 'STAY500', status: 'INACTIVE' })]));
    vi.mocked(couponApi.setStatus).mockResolvedValue(coupon({ status: 'INACTIVE' }));
    const { user } = renderAdmin(routes, '/admin/coupons');

    await user.click(await screen.findByRole('button', { name: 'Deactivate WELCOME10' }));
    await waitFor(() => expect(couponApi.setStatus).toHaveBeenCalledWith('c1', 'INACTIVE'));
    await user.click(screen.getByRole('button', { name: 'Activate STAY500' }));
    await waitFor(() => expect(couponApi.setStatus).toHaveBeenCalledWith('c2', 'ACTIVE'));
  });

  it('is closed without COUPON_MANAGE', () => {
    renderAdmin(routes, '/admin/coupons', adminWithout('COUPON_MANAGE'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(couponApi.list).not.toHaveBeenCalled();
  });
});

describe('AdminOffersPage', () => {
  it('lists offers with their coupon and whether they are on the site now', async () => {
    vi.mocked(offerApi.list).mockResolvedValue(pageOf([offer(), offer({ id: 'o2', title: 'City breaks', live: false, couponStatus: 'INACTIVE', status: 'INACTIVE' })]));
    renderAdmin(routes, '/admin/offers');

    const table = await screen.findByRole('table', { name: 'Offers' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Goa in winterHotels · Goa · Ocean theme · seasonal');
    expect(first).toHaveTextContent('WELCOME1010% off, up to ₹1,500');
    expect(first).toHaveTextContent('On the site now');
    expect(second).toHaveTextContent('Coupon inactive');
    expect(second).toHaveTextContent('Not shown now');
  });

  it('creates an offer with a coupon from the picker', async () => {
    vi.mocked(offerApi.list).mockResolvedValue(pageOf([]));
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon(), coupon({ id: 'c2', code: 'GOA15', discountValue: 15, maxDiscount: null, minBookingAmount: 0 })]));
    vi.mocked(offerApi.create).mockResolvedValue(offer());
    const { user } = renderAdmin(routes, '/admin/offers');

    await user.click(await screen.findByRole('button', { name: 'New offer' }));
    const dialog = screen.getByRole('dialog', { name: 'New offer' });
    await user.click(within(dialog).getByRole('button', { name: 'Create offer' }));
    expect(within(dialog).getByText('Choose the coupon customers use')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Title'), 'Goa in winter');
    await within(dialog).findByRole('option', { name: 'GOA15 · 15% off' });
    await user.selectOptions(within(dialog).getByLabelText('Coupon'), 'GOA15 · 15% off');
    await user.selectOptions(within(dialog).getByLabelText('Applies to'), 'Hotels');
    await user.type(within(dialog).getByLabelText(/Destination city/), 'Goa');
    await user.type(within(dialog).getByLabelText('Valid from'), '2026-12-01');
    await user.type(within(dialog).getByLabelText('Valid until'), '2027-01-31');
    await user.selectOptions(within(dialog).getByLabelText('Theme'), 'Sunset');
    await user.click(within(dialog).getByRole('checkbox', { name: /Seasonal offer/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create offer' }));

    await waitFor(() => expect(offerApi.create).toHaveBeenCalledWith({
      title: 'Goa in winter', description: null, couponId: 'c2', appliesTo: 'HOTEL', destinationCity: 'Goa',
      validFrom: '2026-12-01T00:00:00+05:30', validTo: '2027-01-31T23:59:59+05:30', seasonal: true, theme: 'SUNSET', status: 'ACTIVE',
    }));
    expect(couponApi.list).toHaveBeenCalledWith({ q: '', status: 'ACTIVE', page: 0 }, 100);
  });

  it('changes an offer with its version and shows a field error from the server', async () => {
    vi.mocked(offerApi.list).mockResolvedValue(pageOf([offer()]));
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon()]));
    vi.mocked(offerApi.update).mockRejectedValue(new ApiError(422, 'INVALID_VALUE', 'The coupon does not exist.', [], null, { field: 'couponId' }));
    const { user } = renderAdmin(routes, '/admin/offers');

    await user.click(await screen.findByRole('button', { name: 'Change Goa in winter' }));
    const dialog = screen.getByRole('dialog', { name: 'Change offer' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Goa in winter');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(offerApi.update).toHaveBeenCalledWith('o1', expect.objectContaining({ version: 1, couponId: 'c1' })));
    expect(await within(dialog).findByText('The coupon does not exist.')).toBeInTheDocument();
  });

  it('switches an offer off', async () => {
    vi.mocked(offerApi.list).mockResolvedValue(pageOf([offer()]));
    vi.mocked(offerApi.setStatus).mockResolvedValue(offer({ status: 'INACTIVE' }));
    const { user } = renderAdmin(routes, '/admin/offers');

    await user.click(await screen.findByRole('button', { name: 'Deactivate Goa in winter' }));

    await waitFor(() => expect(offerApi.setStatus).toHaveBeenCalledWith('o1', 'INACTIVE'));
    expect(await screen.findByText('Offer switched off.')).toBeInTheDocument();
  });
});

describe('coupon form rules', () => {
  const valid = { ...couponFormDefaults(), code: 'GOA15', title: 'Goa deal', discountValue: '15', validFrom: '2026-12-01', validTo: '2026-12-01' };

  it('accepts a one-day coupon and limits the per-customer uses to 1–100', () => {
    expect(couponSchema().safeParse(valid).success).toBe(true);
    expect(couponSchema().safeParse({ ...valid, perCustomerLimit: '101' }).success).toBe(false);
    expect(couponSchema().safeParse({ ...valid, usageLimit: '1000001' }).success).toBe(false);
    expect(couponSchema().safeParse({ ...valid, discountType: 'FIXED', discountValue: '750.50' }).success).toBe(true);
  });

  it('sends no maximum discount for a fixed amount', () => {
    expect(toCouponBody({ ...valid, discountType: 'FIXED', discountValue: '500', maxDiscount: '1000' }).maxDiscount).toBeNull();
  });
});

describe('Coupons and offers: export', () => {
  it('exports the coupons on the page as CSV: one fact per column, India-day dates', async () => {
    const files = stubFileSaving();
    vi.mocked(couponApi.list).mockResolvedValue(pageOf([coupon()]));
    const { user } = renderAdmin(routes, '/admin/coupons');
    await screen.findByRole('table', { name: 'Coupons' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export coupons' })).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^coupons-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Code","Title","Demo","Discount","Applies to","Destination","Valid from","Valid to","Expired","Used","Usage limit","Paid","Reserved",'
        + '"Per customer","Status"',
      '"WELCOME10","Welcome offer","Yes","10% off, up to ₹1,500 (bookings from ₹2,000)","Flights and hotels",,2026-11-01,2026-12-31,"No",12,100,10,2,1,"Active"',
      '',
    ]);
  });

  it('exports every matching coupon page by page with the search and status of the screen', async () => {
    const files = stubFileSaving();
    const all = [coupon(), coupon({ id: 'c2', code: 'WELCOME20' }), coupon({ id: 'c3', code: 'WELCOME30' })];
    vi.mocked(couponApi.list).mockImplementation(async (filters) => pageOf(all.slice(filters.page * 2, filters.page * 2 + 2),
      { page: filters.page, size: 2, totalElements: 3, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/coupons?q=WELCOME&status=ACTIVE');
    await screen.findByRole('table', { name: 'Coupons' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(couponApi.list).toHaveBeenCalledWith({ q: 'WELCOME', status: 'ACTIVE', page: 0 }, 100);
    expect(couponApi.list).toHaveBeenCalledWith({ q: 'WELCOME', status: 'ACTIVE', page: 1 }, 100);
    const lines = (await files.blobs[0]!.text()).split('\r\n').filter(Boolean);
    expect(lines.map((line) => line.split(',')[0])).toEqual(['"Code"', '"WELCOME10"', '"WELCOME20"', '"WELCOME30"']);
  });

  it('exports the offers on the page as CSV', async () => {
    const files = stubFileSaving();
    vi.mocked(offerApi.list).mockResolvedValue(pageOf([offer()]));
    const { user } = renderAdmin(routes, '/admin/offers');
    await screen.findByRole('table', { name: 'Offers' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export offers' })).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Offer","Applies to","Destination","Theme","Seasonal","Demo","Coupon","Discount","Coupon status","Valid from","Valid to","Status",'
        + '"On the site now"',
      '"Goa in winter","Hotels","Goa","Ocean","Yes","No","WELCOME10","10% off, up to ₹1,500","Active",2026-11-01,2026-12-31,"Active","Yes"',
      '',
    ]);
  });
});
