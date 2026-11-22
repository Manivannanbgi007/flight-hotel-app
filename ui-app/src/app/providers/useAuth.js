import { useContext } from 'react';

import { AuthContext } from './authContext';

/** Current user, auth status and login/logout actions. Must be used inside AuthProvider. */
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
