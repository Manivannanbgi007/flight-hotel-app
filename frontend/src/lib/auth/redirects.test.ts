import { canOpenPath, defaultLanding, loginPath, safeRedirect } from './redirects';

describe('safeRedirect', () => {
  it.each(['/account/profile', '/hotels?city=Goa', '/', '/admin/users', '/customer/dashboard'])('allows same-site path %s', (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each([
    'https://evil.example.com',
    '//evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    '/account\n/x',
    'account',
    '',
    null,
    undefined,
  ])('rejects %s', (path) => {
    expect(safeRedirect(path)).toBeNull();
  });

  it('never loops back into the auth pages', () => {
    expect(safeRedirect('/login')).toBeNull();
    expect(safeRedirect('/login?redirect=/x')).toBeNull();
    expect(safeRedirect('/reset-password?token=abc')).toBeNull();
    expect(safeRedirect('/logins-report')).toBe('/logins-report');
  });

  it.each(['/customer/login', '/admin/login?redirect=/admin', '/hotel-manager/login', '/support/login#x'])(
    'never loops back into the portal sign-in page %s',
    (path) => {
      expect(safeRedirect(path)).toBeNull();
    },
  );
});

describe('defaultLanding', () => {
  it('sends staff to their portal and customers to their dashboard', () => {
    expect(defaultLanding({ roles: ['ADMIN'] })).toBe('/admin');
    expect(defaultLanding({ roles: ['HOTEL_MANAGER'] })).toBe('/hotel-manager');
    expect(defaultLanding({ roles: ['SUPPORT_AGENT'] })).toBe('/support');
    expect(defaultLanding({ roles: ['CUSTOMER'] })).toBe('/customer/dashboard');
    expect(defaultLanding({ roles: ['CUSTOMER', 'ADMIN'] })).toBe('/admin');
  });
});

describe('canOpenPath', () => {
  it('limits the staff areas by role and leaves the rest to the page guards', () => {
    expect(canOpenPath({ roles: ['CUSTOMER'] }, '/my-trips')).toBe(true);
    expect(canOpenPath({ roles: ['CUSTOMER'] }, '/admin/users')).toBe(false);
    expect(canOpenPath({ roles: ['ADMIN'] }, '/support/tickets')).toBe(true);
    expect(canOpenPath({ roles: ['ADMIN'] }, '/hotel-manager')).toBe(true);
    expect(canOpenPath({ roles: ['SUPPORT_AGENT'] }, '/hotel-manager')).toBe(false);
  });
});

describe('loginPath', () => {
  it("sends customer pages to the customer sign-in and remembers the page", () => {
    expect(loginPath('/account/security?tab=1')).toBe('/customer/login?redirect=%2Faccount%2Fsecurity%3Ftab%3D1');
    expect(loginPath('/')).toBe('/customer/login');
    expect(loginPath('/customer/home')).toBe('/customer/login');
    expect(loginPath('//evil.example.com')).toBe('/customer/login');
  });

  it("sends each staff area to its own portal's sign-in", () => {
    expect(loginPath('/admin/users')).toBe('/admin/login?redirect=%2Fadmin%2Fusers');
    expect(loginPath('/hotel-manager/hotels/h1/rooms')).toBe('/hotel-manager/login?redirect=%2Fhotel-manager%2Fhotels%2Fh1%2Frooms');
    expect(loginPath('/support')).toBe('/support/login?redirect=%2Fsupport');
    // `/supporting-docs` is not the support portal.
    expect(loginPath('/supporting-docs')).toBe('/customer/login?redirect=%2Fsupporting-docs');
  });
});
