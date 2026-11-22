import { Navigate, useLocation } from 'react-router';

import { PORTALS } from '@/lib/auth/portals';

/**
 * `/login` (older links, e-mails): the customer sign-in, keeping the query (`?redirect=`, `?reason=`, `?email=`) and
 * the hash.
 */
export function LoginRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`${PORTALS.CUSTOMER.signInPath}${search}${hash}`} replace />;
}
