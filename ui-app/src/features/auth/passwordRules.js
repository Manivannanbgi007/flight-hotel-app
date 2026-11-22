export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 64;
const PASSWORD_MAX_BYTES = 72;

/** Same list as the backend: popular passwords that would otherwise pass the rules. */
const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  'password12345',
  'qwerty12345',
  'qwerty123456',
  '1234567890a',
  'a1234567890',
  'welcome123',
  'welcome1234',
  'iloveyou123',
  'admin12345',
  'letmein1234',
  'abc1234567',
  'abcd123456',
  'passw0rd123',
  'p@ssw0rd123',
  'travel12345',
  'flighthotel1',
  'india123456',
  'summer2026',
  'winter2026',
  'monkey12345',
  'dragon12345',
  'football123',
  'sunshine123',
]);

export const PASSWORD_RULE_LABELS = {
  LENGTH: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
  LETTER: 'At least one letter',
  DIGIT: 'At least one number',
  NOT_EMAIL: 'Not the same as your email',
  NOT_COMMON: 'Not a commonly used password',
  MAX_BYTES: 'Not too long when special characters are used',
};

/** Every rule with pass/fail, in the order they are shown in the checklist. */
export function checkPassword(password, email) {
  const bytes = new TextEncoder().encode(password).length;
  const results = {
    LENGTH: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    LETTER: /\p{L}/u.test(password),
    DIGIT: /\p{Nd}/u.test(password),
    NOT_EMAIL: !email || password.toLowerCase() !== email.trim().toLowerCase(),
    NOT_COMMON: !COMMON_PASSWORDS.has(password.toLowerCase()),
    MAX_BYTES: bytes <= PASSWORD_MAX_BYTES,
  };
  return (
    Object.keys(PASSWORD_RULE_LABELS)
      // The byte rule only matters (and is only shown) when it fails.
      .filter((id) => id !== 'MAX_BYTES' || !results.MAX_BYTES)
      .map((id) => ({ id, label: PASSWORD_RULE_LABELS[id], passed: results[id] }))
  );
}

export function isPasswordValid(password, email) {
  return checkPassword(password, email).every((rule) => rule.passed);
}

/** Human text for the rule ids the server returns with WEAK_PASSWORD. */
export function describeFailedRules(ruleIds) {
  const ids = Array.isArray(ruleIds) ? ruleIds.filter((id) => id in PASSWORD_RULE_LABELS) : [];
  if (ids.length === 0) {
    return 'Choose a stronger password.';
  }
  return `Choose a stronger password: ${ids.map((id) => PASSWORD_RULE_LABELS[id].toLowerCase()).join(', ')}.`;
}
