import { checkPassword, describeFailedRules, isPasswordValid } from './passwordRules';

const failed = (password: string, email?: string) =>
  checkPassword(password, email).filter((rule) => !rule.passed).map((rule) => rule.id);

describe('password rules (mirror of identity-service PasswordPolicy)', () => {
  it('accepts a good password, in any language', () => {
    expect(isPasswordValid('Travel2026Safe', 'asha@example.com')).toBe(true);
    expect(isPasswordValid('पासवर्ड2026सुरक्षित')).toBe(true);
  });

  it('reports each broken rule', () => {
    expect(failed('short1')).toEqual(['LENGTH']);
    expect(failed('onlyletterslong')).toEqual(['DIGIT']);
    expect(failed('12345678901')).toEqual(['LETTER']);
    expect(failed('Password123')).toEqual(['NOT_COMMON']);
    expect(failed('Asha2026@Example.com', 'asha2026@example.com')).toEqual(['NOT_EMAIL']);
  });

  it('shows the byte rule only when it fails (BCrypt uses at most 72 bytes)', () => {
    expect(checkPassword('Travel2026Safe').map((rule) => rule.id)).not.toContain('MAX_BYTES');
    expect(failed('€'.repeat(24) + '1234567890a')).toContain('MAX_BYTES');
  });

  it('turns server rule ids into a sentence', () => {
    expect(describeFailedRules(['DIGIT', 'NOT_COMMON'])).toBe(
      'Choose a stronger password: at least one number, not a commonly used password.',
    );
    expect(describeFailedRules(undefined)).toBe('Choose a stronger password.');
  });
});
