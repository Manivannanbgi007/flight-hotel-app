import { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router';

import { AuthNavigatorRegistry } from '@/app/providers/authContext';

/**
 * Lives inside the router and lends AuthProvider (which is outside it) a way to navigate, so logout can leave a
 * protected page BEFORE the session is cleared.
 */
export function AuthRouterBridge() {
  const register = useContext(AuthNavigatorRegistry);
  const navigate = useNavigate();

  useEffect(() => {
    if (!register) {
      return undefined;
    }
    register(async (pathname) => {
      await navigate(pathname, { replace: true });
      // Let React commit the new page before the caller continues.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return () => register(null);
  }, [register, navigate]);

  return null;
}
