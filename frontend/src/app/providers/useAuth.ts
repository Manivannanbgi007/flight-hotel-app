import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from './authContext';

/** Current user, auth status and login/logout actions. Must be used inside AuthProvider. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
