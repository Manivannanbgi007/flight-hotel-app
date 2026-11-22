# FlightHotel UI (React + JavaScript)

The customer, admin, hotel-manager and support front end of the flight & hotel booking platform, written in plain
JavaScript (ES2022) with React, Vite and Tailwind CSS. It is a line-for-line port of the TypeScript app in
`../frontend`: same screens, same API calls, same routes, same validation rules. Only the types are gone.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (API calls are proxied to the gateway on http://localhost:8080)
npm run build      # production bundle in dist/
npm run preview    # serves dist/ locally
npm run lint       # ESLint (plain JavaScript + React hooks rules)
```

Set `VITE_GATEWAY_URL` when the API gateway is not on `http://localhost:8080`. `.env.development` turns on the
"Development test accounts" panel of the sign-in pages (`VITE_DEV_ACCOUNTS=true`); production builds leave it out.

## Stack (and why each piece is there)

| Piece | Used for |
|-------|----------|
| React 19 + Vite | The UI and the dev server / bundler |
| Tailwind CSS 4 | Styling; every colour, radius and shadow is a token in `src/index.css` (`@theme`) |
| react-router | Routes, lazy-loaded pages and the auth guards (`src/app/router.jsx`) |
| @tanstack/react-query | Server data: fetching, caching, retries, refetch after live updates |
| axios | The one API client (`src/lib/api/client.js`): `/api` base URL, bearer token, token refresh, error normalising |
| react-hook-form + zod | Forms and their validation rules (`schemas.js` next to each feature) |
| lucide-react | Icons |
| sonner | Toast messages |
| date-fns, react-day-picker | Dates and the calendar picker |
| recharts | Dashboard charts |
| jspdf, jspdf-autotable, fflate | CSV / Excel / PDF export of tables (`src/lib/export`) |

## Folder map

```
src/
  main.jsx                 Entry point: providers + router
  index.css                Tailwind import, design tokens, global utilities
  app/                     Router, route guards, providers (auth session, query client, realtime, toasts)
  components/
    ui/                    Buttons, fields, dialogs, tables, pagination, ... (the design system primitives)
    layout/                Public layout, staff shell, sidebar navigation, footer, user menu
    charts/, analytics/    Chart kit and dashboard helpers (ranges, growth, KPI grid)
    illustrations/         Inline SVG scenes and state illustrations
    motion/                Reveal and animated numbers (respect reduced motion)
  features/                One folder per screen group; each holds its pages, parts, *Api.js and schemas.js
    auth/                  Sign-in per portal, register, verify e-mail, forgot / reset password
    home/, flights/, hotels/, offers/, help/, about/, search/, newsletter/
    bookings/, payments/, documents/, reviews/, tickets/, account/, customer/, notifications/
    admin/, hotel-manager/, support/     The three staff portals
    assistant/             The AI assistant panel (streaming answers, voice input / output)
  lib/
    api/                   axios client, ApiError, query keys, form error mapping
    auth/                  Session store, portals, redirects, role helpers
    realtime/              Server-Sent Events client, cross-tab leader election, cache invalidation rules
    export/                CSV / XLSX / PDF writers
    format.js, paths.js, cn.js, use*.js   Formatting, route paths, class names, small hooks
  pages/                   Not found, forbidden, route error, under construction
```

`@/` is an alias for `src/` (see `vite.config.js` and `jsconfig.json`), so imports read as
`import { Button } from '@/components/ui/Button'`.

## How the pieces fit together

1. **Routing** – `src/app/router.jsx` lists every URL. Most pages are `lazy` so the first load stays small.
   `RequireAuth` / `RequireRole` (`src/app/guards.jsx`) send visitors to the right sign-in page; the API checks
   roles again on every call.
2. **Session** – `AuthProvider` restores the session on page load (refresh cookie → access token) and exposes
   `useAuth()`. The axios client adds the bearer token and retries one time after a silent refresh on `401`.
3. **Data** – each feature has an `...Api.js` (plain functions around `apiClient`) and hooks built on
   `useQuery` / `useMutation`. Query keys live in `src/lib/api/queryKeys.js`; the realtime layer invalidates them when
   the server pushes an event.
4. **Forms** – `useForm({ resolver: zodResolver(schema) })`. Server-side field errors are mapped back onto the form
   with `applyFieldErrors` from `src/lib/api/formErrors.js`.
5. **Styling** – Tailwind utility classes. The portal colour (`role-*` tokens) changes per area (customer, admin,
   hotel manager, support) from the layout, so components stay the same everywhere.

## Differences from the TypeScript original

- No TypeScript: `.ts` → `.js`, `.tsx` → `.jsx`, type annotations, interfaces and `import type` lines removed.
  Modules that held only types were dropped; the API shapes they described are documented in
  `../API_DOCUMENTATION.md`.
- Constructor parameter properties (`constructor(private readonly x)`) became explicit `this.x = x` assignments.
- The unit and end-to-end test suites of the original were not ported (they are TypeScript); everything else,
  including the development-only component gallery at `/dev/design-system`, is here.
