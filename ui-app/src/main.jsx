import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { config as zodConfig } from 'zod/v4/core';

import { AppProviders } from '@/app/providers/AppProviders';
import { router } from '@/app/router';
import './index.css';

// zod would probe `new Function("")` to compile fast parsers. The CSP forbids eval, so the probe only produced a
// CSP violation report on every page with a form; the plain parsers are fast enough for our forms.
zodConfig({ jitless: true });

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
