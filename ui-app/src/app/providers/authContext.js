import { createContext } from 'react';

export const AuthContext = createContext(null);

/**
 * AuthProvider sits outside the router (it must wrap RouterProvider to show the loader). The router-side
 * AuthRouterBridge hands it a navigator through this context.
 */
export const AuthNavigatorRegistry = createContext(null);
