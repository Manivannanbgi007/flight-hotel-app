import { Navigate, useLocation } from 'react-router';

import { HOME_PATH } from '@/lib/paths';

/** `/` → `/customer/home`, with the same query and hash (campaign links, e-mails); replaces the history entry. */
export function HomeRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: HOME_PATH, search, hash }} replace />;
}
