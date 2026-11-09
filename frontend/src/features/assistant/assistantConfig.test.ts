import { accentClassOf, DEFAULT_LIMITS, isSignInPath, normalizeConfig, shouldShowLauncher } from './assistantConfig';
import { clearConversationId, readConversationId, writeConversationId } from './conversationStorage';

const enabled = normalizeConfig({ enabled: true, model: 'granite4:tiny-h', voice: { transcription: false, speech: true }, limits: { maxMessageLength: 500 } });

describe('assistant config', () => {
  it('reads the config and fills missing limits with the contract defaults', () => {
    expect(enabled).toEqual({
      enabled: true,
      model: 'granite4:tiny-h',
      voice: { transcription: false, speech: true },
      limits: { ...DEFAULT_LIMITS, maxMessageLength: 500 },
    });
  });

  it('treats anything unexpected as "not available"', () => {
    expect(normalizeConfig(null)).toMatchObject({ enabled: false, voice: { transcription: false, speech: false }, limits: DEFAULT_LIMITS });
    expect(normalizeConfig({ enabled: 'yes', limits: { maxMessageLength: -1 } })).toMatchObject({ enabled: false, limits: DEFAULT_LIMITS });
  });
});

describe('launcher visibility', () => {
  it('shows only for a signed-in user while the assistant is enabled, never on a sign-in page', () => {
    expect(shouldShowLauncher({ status: 'authenticated', config: enabled, pathname: '/my-trips' })).toBe(true);
    expect(shouldShowLauncher({ status: 'authenticated', config: enabled, pathname: '/admin/bookings' })).toBe(true);

    expect(shouldShowLauncher({ status: 'anonymous', config: enabled, pathname: '/' })).toBe(false);
    expect(shouldShowLauncher({ status: 'loading', config: enabled, pathname: '/' })).toBe(false);
    expect(shouldShowLauncher({ status: 'authenticated', config: undefined, pathname: '/' })).toBe(false);
    expect(shouldShowLauncher({ status: 'authenticated', config: { ...enabled, enabled: false }, pathname: '/' })).toBe(false);
    expect(shouldShowLauncher({ status: 'authenticated', config: enabled, pathname: '/admin/login' })).toBe(false);
  });

  it('knows the sign-in pages', () => {
    expect(['/login', '/customer/login', '/admin/login', '/hotel-manager/login', '/support/login'].every(isSignInPath)).toBe(true);
    expect(isSignInPath('/admin/login-history')).toBe(false);
    expect(isSignInPath('/account/security')).toBe(false);
  });

  it('takes the accent of the portal from the route', () => {
    expect(accentClassOf('/my-trips')).toBe('');
    expect(accentClassOf('/admin')).toBe('role-admin');
    expect(accentClassOf('/hotel-manager/hotels/1/dashboard')).toBe('role-manager');
    expect(accentClassOf('/support/tickets')).toBe('role-support');
  });
});

describe('conversation id storage', () => {
  const id = '01a1afe8-274d-7009-b220-93959948511e';

  afterEach(() => window.sessionStorage.clear());

  it('keeps one id per user in sessionStorage', () => {
    writeConversationId('user-a', id);

    expect(readConversationId('user-a')).toBe(id);
    expect(readConversationId('user-b')).toBeNull();
    clearConversationId('user-a');
    expect(readConversationId('user-a')).toBeNull();
  });

  it('ignores values that are not conversation ids', () => {
    writeConversationId('user-a', '<script>');
    window.sessionStorage.setItem('fh.assistant.conversation.user-b', 'garbage');

    expect(readConversationId('user-a')).toBeNull();
    expect(readConversationId('user-b')).toBeNull();
  });

  it('works without storage (blocked or private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => writeConversationId('user-a', id)).not.toThrow();
    expect(readConversationId('user-a')).toBeNull();
  });
});
