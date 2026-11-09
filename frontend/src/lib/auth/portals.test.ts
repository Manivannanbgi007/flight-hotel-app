import { areaOfPath, canUsePortal, parsePortal, portalLinks, primaryPortal, signInPath } from './portals';

describe('portals', () => {
  it('lets each role use its own portal, and admins the partner and support portals too', () => {
    expect(canUsePortal({ roles: ['CUSTOMER'] }, 'CUSTOMER')).toBe(true);
    expect(canUsePortal({ roles: ['CUSTOMER'] }, 'ADMIN')).toBe(false);
    expect(canUsePortal({ roles: ['ADMIN'] }, 'ADMIN')).toBe(true);
    expect(canUsePortal({ roles: ['ADMIN'] }, 'HOTEL_MANAGER')).toBe(true);
    expect(canUsePortal({ roles: ['ADMIN'] }, 'SUPPORT')).toBe(true);
    expect(canUsePortal({ roles: ['ADMIN'] }, 'CUSTOMER')).toBe(false);
    expect(canUsePortal({ roles: ['HOTEL_MANAGER'] }, 'SUPPORT')).toBe(false);
    expect(canUsePortal({ roles: ['SUPPORT_AGENT'] }, 'SUPPORT')).toBe(true);
  });

  it("names a user's main portal", () => {
    expect(primaryPortal({ roles: ['CUSTOMER'] })).toBe('CUSTOMER');
    expect(primaryPortal({ roles: ['SUPPORT_AGENT'] })).toBe('SUPPORT');
    expect(primaryPortal({ roles: ['HOTEL_MANAGER', 'SUPPORT_AGENT'] })).toBe('HOTEL_MANAGER');
    expect(primaryPortal({ roles: ['CUSTOMER', 'ADMIN'] })).toBe('ADMIN');
  });

  it('reads the area of a path', () => {
    expect(areaOfPath('/admin')).toBe('admin');
    expect(areaOfPath('/admin/users?x=1')).toBe('admin');
    expect(areaOfPath('/hotel-manager/hotels/h1')).toBe('hotel-manager');
    expect(areaOfPath('/support?tab=1')).toBe('support');
    expect(areaOfPath('/administrator')).toBe('customer');
    expect(areaOfPath('/account/support')).toBe('customer');
  });

  it('reads portal names from links in either spelling', () => {
    expect(parsePortal('ADMIN')).toBe('ADMIN');
    expect(parsePortal('hotel-manager')).toBe('HOTEL_MANAGER');
    expect(parsePortal('support')).toBe('SUPPORT');
    expect(parsePortal('root')).toBeNull();
    expect(parsePortal(null)).toBeNull();
  });

  it('builds sign-in links with the page to return to and the reason', () => {
    expect(signInPath('ADMIN')).toBe('/admin/login');
    expect(signInPath('SUPPORT', { redirect: '/support/tickets', reason: 'session-ended' }))
      .toBe('/support/login?redirect=%2Fsupport%2Ftickets&reason=session-ended');
  });

  it('lists the work portals of the user menu', () => {
    expect(portalLinks({ roles: ['ADMIN'] }).map((link) => link.to)).toEqual(['/admin', '/support']);
    expect(portalLinks({ roles: ['CUSTOMER'] })).toEqual([]);
  });
});
