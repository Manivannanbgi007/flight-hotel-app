# Testing Guide

How to run every kind of test in this project, what each one proves, and what to do when one fails.
Commands are for **Windows PowerShell** from the repository root unless a section says otherwise.

## 1. Overview

| Kind | Tool | Where | Count | Needs | Command |
|------|------|-------|-------|-------|---------|
| Backend unit + integration | JUnit 5, Spring Boot Test, Testcontainers | `platform/*/src/test`, `services/*/src/test` | 618 | Docker Desktop | `.\mvnw.cmd verify` |
| Frontend unit + component | Vitest, Testing Library, jsdom | `frontend/src/**/*.test.ts(x)` | 1,572 | nothing | `npm test` |
| End-to-end (both §30 journeys, the customer dashboard) | Playwright (Chromium) | `frontend/e2e/*-journey.spec.ts`, `customer-dashboard.spec.ts` | 3 | the Docker stack | `npm run test:e2e` |
| End-to-end, staff portals (Phase 11) | Playwright (Chromium) + axe-core | `frontend/e2e/staff-portals.spec.ts` | 18 | the Docker stack | `npm run test:e2e` |
| End-to-end, pickers (date calendar, selects, suggestions; public pages, no login) | Playwright (Chromium) + axe-core | `frontend/e2e/pickers.spec.ts` | 3 | the Docker stack | `npx playwright test e2e/pickers.spec.ts` |
| End-to-end, pagination and the assistant's size (pagination never under the assistant button, page sizes, normal / maximized / minimized; one admin login) | Playwright (Chromium) + axe-core | `frontend/e2e/pagination-assistant.spec.ts` | 2 | the Docker stack | `npx playwright test e2e/pagination-assistant.spec.ts` |
| End-to-end, layout (staff sidebar expand/collapse with the page following, tooltips, submenu, header search, drawer; the hand cursor on clickable controls; the customer area's sidebar and drawer; no overlap with the header or the assistant; no sideways scroll) | Playwright (Chromium) + axe-core | `frontend/e2e/layout.spec.ts` | 2 | the Docker stack | `npx playwright test e2e/layout.spec.ts` |
| End-to-end, global search (signed out: typo, keyboard, results page, other city name; admin: a booking reference opens the admin booking; customer: pages by typo and nothing of another customer; hotel manager: their hotel's inventory; support: understood words on the results page) | Playwright (Chromium) + axe-core | `frontend/e2e/global-search.spec.ts` | 5 | the Docker stack | `npx playwright test e2e/global-search.spec.ts` |
| End-to-end, AI assistant UI (Phase 11) | Playwright (Chromium) + axe-core, real model | `frontend/e2e/assistant.spec.ts` | 8 | the Docker stack (+ profile `voice` for the voice test) | `npx playwright test e2e/assistant.spec.ts` |
| Accessibility | Playwright + axe-core | `frontend/e2e/accessibility.spec.ts` | 44 tests, 44 page scans | the Docker stack | `npm run test:e2e` |
| Data export (CSV, Excel, PDF): the writers, the menu, and each screen's columns and "All matching rows" | Vitest; openpyxl for an independent check of a downloaded `.xlsx` | `frontend/src/lib/export/export.test.ts`, `components/export/ExportMenu.test.tsx`, each page's test | 52 | nothing | `npx vitest run src/lib/export src/components/export` |
| Background exports of the audit log (requested 2026-11-09): the streamed Excel / CSV files (opened with Apache POI), the job flow, keyset reading for every filter shape, one-time links, limits, cancel, expiry; the menu's server mode, "Your exports", the ready toast | JUnit 5 + Testcontainers + POI (test scope); Vitest | `reporting-service/src/test/.../export/*`, common-lib `*FileStorageTest`, `frontend/src/features/admin/audit/*.test.tsx`, `ExportMenu.test.tsx` | 14 backend, 18 frontend | Docker Desktop (backend) | `.\mvnw.cmd -pl services/reporting-service -am verify`; `npx vitest run src/features/admin/audit src/components/export` |
| Security checks | Node.js scripts | `tests/security/` | 4 scripts | the Docker stack | `node tests/security/<script>.mjs` |
| AI assistant with the real model | Node.js scripts | `tests/assistant/` | 2 scripts | the Docker stack | see §7.5 |
| Dependency and secret scans | npm audit, Trivy, gitleaks | none (tools only) | none | Docker | see §7.4 |
| Load test | k6 | `tests/load/search-and-booking.js` | 3 scenarios | the Docker stack | see §8 |
| Kubernetes manifests (CI: `k8s-manifests`, `iac-scan`) | Helm lint/template, kubeconform, Trivy config | `deploy/charts`, `deploy/environments` | 14 releases (kind) | Git Bash, helm, kubeconform | `bash scripts/ci/validate-k8s.sh` ([docs/CI_CD.md](docs/CI_CD.md) §7) |
| Kubernetes deployment (HA, blue-green, canary, rollback, Argo CD, autoscaling, network policies) | kubectl, Argo Rollouts, Argo CD | `deploy/` | manual, step by step | the kind cluster | [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md) §3, §9, §10, §12 (record in §16) |

The fast checks (backend + frontend unit tests) run anywhere. Everything that says "the Docker stack" runs against
the real system started with `docker compose up -d` ([DOCKER_SETUP.md](DOCKER_SETUP.md)), so it tests the real
services, Kafka sagas, e-mails and payments together.

## 2. Before you start

- **JDK 21**, **Node.js 24**, **Docker Desktop** (at least 16 GB of memory since the AI assistant of Phase 11; 20 GB
  recommended), as in [LOCAL_SETUP_GUIDE.md](LOCAL_SETUP_GUIDE.md) and [DOCKER_SETUP.md](DOCKER_SETUP.md).
- A `.env` file (copy `.env.example`). The browser, security and load tests log in with the demo accounts, so for them:
  - `DEMO_USERS_ENABLED=true`
  - `DEMO_USER_PASSWORD=<10–64 letters and digits>`
  - `PAYMENT_PROVIDER=demo`
- The Docker stack also needs `MCP_SERVER_API_KEY` (Phase 11, at least 32 random characters), otherwise the assistant's
  services do not start ([AI_ASSISTANT.md](AI_ASSISTANT.md) §3).
- The test scripts read `DEMO_USER_PASSWORD` from `.env` themselves and **never print it**. Never paste it into a
  command line or a commit.
- Frontend packages: `cd frontend; npm ci`. For the browser tests also run, once: `npx playwright install chromium`.

## 3. Backend tests (Maven)

### 3.1 Run them

```powershell
.\mvnw.cmd verify                                        # everything: about 10 minutes
.\mvnw.cmd -pl services/booking-service -am verify       # one service (+ the modules it needs)
.\mvnw.cmd -pl services/booking-service -am verify "-Dtest=CancellationPolicyTest" "-Dsurefire.failIfNoSpecifiedTests=false"
```

Expected result: `BUILD SUCCESS` and, per module, `Tests run: N, Failures: 0, Errors: 0`.

- **Docker must be running.** Integration tests start their own MySQL, Kafka, Redis and Elasticsearch containers with
  Testcontainers. They do **not** use the Docker Compose stack, so both can run at the same time (if memory allows).
- Names: `*Test` is a fast unit test (no Spring, no containers); `*IntegrationTest` starts the service with real
  containers and calls it over HTTP with MockMvc.

### 3.2 Coverage report (JaCoCo)

`verify` writes a report for every module and one for all modules together:

| Report | File |
|--------|------|
| One module | `<module>/target/site/jacoco/index.html` (+ `jacoco.xml` for CI tools) |
| All modules | `platform/coverage-report/target/site/jacoco-aggregate/index.html` |

Use the **aggregate** report. A module's own report only counts its own tests, so `common-lib` looks low (33 %) there,
because the services' tests use most of its code.
- Generated Avro event classes are excluded.
- Lombok-generated getters and setters are excluded (root `lombok.config`).
- There are no coverage thresholds. The numbers are reported, never enforced.

### 3.3 What is tested where (requirements §30)

| §30 item | Main test classes |
|----------|-------------------|
| Unit tests for services | `CancellationPolicyTest`, `BookingStateMachineTest` (every transition of the booking diagram), `CouponServiceTest`, `PricingServiceTest`, `ReportRangeTest`, `ReportExporterTest`, `SignaturesTest`, `PasswordPolicyTest`, `HotelRatingsTest`, `IndianDigitsTest` |
| Controller tests | every `*IntegrationTest` (MockMvc through the real controllers), `GlobalExceptionHandlerTest` |
| Repository tests | `InventoryConcurrencyIntegrationTest`, `RepositoryQueriesIntegrationTest` (booking), `SeasonalRateQueryIntegrationTest` (hotel), `DemoAirlineContractTest` (flight seat SQL), the backfill tests (keyset paging) |
| Security tests | `EndpointSecurityTest` in each of the 9 services (the 7 business services and the two assistant services), `GatewaySecurityTest`, `GatewayRolePathsTest`, `RateLimitConfigTest`, `AuthenticationIntegrationTest` |
| Flight search | `FlightSearchIntegrationTest` |
| Hotel search | `HotelSearchIntegrationTest` (Elasticsearch) |
| Booking workflow | `HotelBookingSagaIntegrationTest`, `FlightBookingSagaIntegrationTest` (in booking, hotel and flight), `BookingIntegrationTest`, `CouponIntegrationTest` |
| Room inventory concurrency | `InventoryConcurrencyIntegrationTest`, `DemoAirlineContractTest.aHoldOfSeveralFlightsIsAllOrNothing`, and the load test's `lastRooms` scenario (§8) |
| Payment verification | `DemoPaymentFlowTest`, `RazorpayPaymentFlowTest`, `SignaturesTest`, `RazorpayPaymentProviderTest` |
| Webhook idempotency | `RazorpayPaymentFlowTest` (the same event delivered 6 times at once → applied once), duplicate-event tests in every Kafka listener |
| Cancellation and refund | `CancellationIntegrationTest`, `FlightCancellationIntegrationTest`, `CancellationPolicyTest`, `AdminBookingIntegrationTest` (goodwill refunds) |
| Supplier integration (mocks / sandbox) | `RazorpayPaymentProviderTest` (local HTTP server: timeouts, retries, error mapping), `DemoAirlineContractTest` (the DEMO airline as the sandbox) |
| Reports match the data | `ReportConsistencyIntegrationTest` |
| Sign-in per portal (Phase 11) | `PortalSignInIntegrationTest`, `PortalTest` (identity-service) |
| Dashboards and analytics (Phase 11) | `AnalyticsMathTest` (common-lib: ranges, previous period, interval buckets, growth); `ReportConsistencyIntegrationTest` (admin dashboard v2: figures, series and comparison against the source events); `CustomerSummaryIntegrationTest` (booking-service), `HotelAnalyticsIntegrationTest` (hotel-service), `SupportMetricsIntegrationTest` (notification-service): every new figure against its source rows |
| Global search (search-service) | `GlobalSearchIntegrationTest` (real Elasticsearch): exact references first, typos, prefixes, partial words, ranking, words understood as filters, paging, validation, every role's isolation and links, signed-out visitors, duplicate and out-of-order events, ranked statuses, payments before bookings, removals; `EndpointSecurityTest`; `QueryUnderstandingTest`, `AccessRulesTest`, `SearchFailuresTest` (Elasticsearch down, retry rule, safe highlights). Snapshot events: notification-service `SupportTicketSnapshotIntegrationTest`, hotel-service `HotelReviewIntegrationTest` |
| AI assistant: grounding check | `GroundingGuardTest`, `StreamingGuardTest` (mcp-client-service): invented references, codes, PNRs, e-tickets and amounts are caught in any format; nothing unverified is streamed |
| AI assistant: chat flow | `AssistantFlowIntegrationTest` (stub Ollama + stub MCP server + Redis): SSE events in order, tools with the user's own token, sources, memory and ownership, replacement of invented data, model and tool-server failures as `error` events, validation and `409` before the stream, six users at the same time |
| AI assistant: token propagation | `McpTokenPropagationTest`: 24 parallel MCP calls each carry their own token |
| AI assistant: memory | `ConversationStoreTest` (Redis): owner only, 24 h TTL, last 20 messages, one answer at a time |
| AI assistant: voice | `VoiceIntegrationTest` (stub speech server): format from the bytes, 5 MB / 60 s limits, MP3 speech |
| AI assistant: tools | `McpToolServerIntegrationTest` (real MCP client + stub gateway): tool list per role, the user's token on every gateway call, other users' bookings not found, masked passports; `ToolInputValidationTest`, `ToolExecutorTest` (role check, error mapping), `GatewayClientTest` (retry, timeouts, circuit breaker), `OutTest` (compact results) |
| AI assistant: access | `EndpointSecurityTest` in both assistant services; `GatewayAssistantRouteTest` (login needed, every role allowed, streaming route without timeout, rate limits, MCP server never routed) |
| Gateway rate limits (Phase 11) | `GatewayRateLimitIntegrationTest` (real Redis via Testcontainers, 6 tests): a login takes 1 of 10 tokens and 10 logins in a row pass; browsing does not use up the login allowance of the same IP; the default limit counts per user and route; an assistant question costs 10 of 30 tokens once, so 3 fit; every route with its own limiter is marked `own-rate-limit`. With the old configuration (every request charged twice) 4 of the 6 fail |

### 3.4 Writing a backend test

- **Pure logic** (prices, fees, states, formatting): a plain JUnit test, no Spring. It runs in milliseconds.
- **An endpoint or a saga step**: add a method to the service's existing `*IntegrationTest`. The Spring context and
  containers are started once and reused by every test that uses the same configuration.
- **A new endpoint**: add it to the service's `EndpointSecurityTest`.
  - The test fails if a staff endpoint is missing from its `AccessMatrix`, or if a new endpoint answers without a token
    and is not in the test's public list.
  - Send a **valid** body: the request body is validated before the permission check, so an invalid body would give
    `400`, not the `403` the test wants to prove.
- Helpers in `platform/test-support` (test scope only):
  - `Endpoints`: every controller mapping of a service;
  - `RoleTokens`: JWTs with exactly the permissions of each role from `V3__roles_and_permissions.sql`;
  - `AccessMatrix`: the 401/403 checks; since Phase 11 also `allow` / `assertAllowed` for endpoints every role may call
    for its own data (such as `GET /api/bookings/summary`).
- Kafka: wait for results with Awaitility (`await().atMost(...)`), never `Thread.sleep`.
- Dates: use dates relative to today, and check the seeded data for those days. For example, the demo flight test
  searches on a Monday, because every seeded flight runs on Mondays.

## 4. Frontend unit tests (Vitest)

### 4.1 Run them

```powershell
cd frontend
npm test                    # all tests (1,455 on 2026-11-08, after the global search)
npx vitest run src/features/bookings          # one folder
npm run test:watch          # re-runs on every change
npm run test:coverage       # with coverage: frontend/coverage/index.html
npm run typecheck; npm run lint; npm run build # the other checks every change must pass
```

Expected result: every test file and every test passes (`Test Files 124 passed`, `Tests 1323 passed` on 2026-11-06).
Run only one coverage run at a time. Two at once fail
with "directory already in use" (`coverage/`).

### 4.2 What is tested where (requirements §30)

| §30 item | Test files (under `frontend/src/`) |
|----------|-----------------------------------|
| Component tests | `components/ui/*.test.tsx` (Field, Controls, Dialog, StarRatingInput), `components/ui/chartMath.test.ts` (`niceScale`, `chartSummary`; Phase 11, replaces the retired `Chart.test.tsx`), `components/layout/PublicLayout.test.tsx`, `components/layout/PageHero.test.tsx` (PageHero, PageContainer), `components/illustrations/illustrations.test.tsx` (a width class sizes a drawing), `features/hotels/HotelFilters.test.tsx`, `HotelBadges.test.tsx`, `pages/StatusPages.test.tsx` |
| Form validation | `features/auth/*Page.test.tsx`, `features/account/ProfilePage.test.tsx`, `SecurityPage.test.tsx`, `schemas.test.ts`, `features/hotel-manager/*Page.test.tsx`, `schemas.test.ts`, `lib/api/apiError.test.ts` (server field errors) |
| Authentication | `lib/api/client.test.ts` (401 → refresh → retry once), `lib/auth/sessionStore.test.ts`, `app/providers/AuthProvider.test.tsx`, `app/guards.test.tsx`, `lib/auth/redirects.test.ts` |
| Flight search | `features/flights/FlightSearch.test.tsx`, `FlightTripPages.test.tsx`, `flightLogic.test.ts`, `searchParams.test.ts` |
| Hotel search | `features/hotels/HotelSearchPage.test.tsx`, `HotelPages.test.tsx`, `HotelQuotePage.test.tsx`, `searchParams.test.ts` |
| Booking workflow | `features/bookings/BookingPages.test.tsx`, `FlightBookingPages.test.tsx`, `Cancellation.test.tsx`, `bookingLogic.test.ts`, `cancellation.test.ts`, `features/apiContracts.test.ts` (Idempotency-Key headers) |
| Payment result | `features/payments/PaymentPages.test.tsx`, `createOrderWhenReady.test.ts`, `razorpay.test.ts` |
| Role-based navigation | `app/roleNavigation.test.tsx` (4 roles × every portal), `app/router.test.tsx`, `app/guards.test.tsx` |
| Customer dashboard (Phase 11) | `features/customer/summaryRange.test.ts` (period in the URL, custom range checks, previous period, growth rules of API_DOCUMENTATION.md §14.0: `null` when the previous figure is 0, never ∞ or NaN), `CustomerDashboardPage.test.tsx` (next trip, KPI figures and changes, trips, the charts' tables, recent bookings, period filter, "All time" not compared, first-time customer, errors), `lib/realtime/invalidationRules.test.ts` (booking, payment and refund events refresh the summary) |
| Staff dashboards: ranges and growth (Phase 11) | `components/analytics/analytics.test.ts`: range presets → India days (month and year edges), India "today" against the browser's zone, custom dates (in order, at most 1,827 days), points per interval (ISO weeks, cut ends), the server's own interval choice, refused intervals disabled with the reason, the period in the URL (broken ranges and refused intervals dropped), API parameters (`interval` only when chosen), growth: relative %, `changePercent: null` → "New" (never ∞ or NaN), negative changes, rates in percentage points ("+3.5 pp"), the payment success-rate change worked out from counts |
| Admin dashboard (Phase 11) | `features/admin/dashboard/AdminDashboardPage.test.tsx`: every KPI of the v2 answer with its chip (good or bad colour by figure), the charts' screen-reader summaries and tables at the server's interval, Gross/Net switch, top lists and recent activity, range and interval in the URL and the request, refused intervals not sent, `400 INVALID_INTERVAL` → "Choose the interval automatically", live refresh on `dashboard.updated`, errors with the support reference, `REPORT_VIEW` required |
| Hotel manager dashboard and portfolio (Phase 11) | `features/hotel-manager/HotelDashboardPage.test.tsx` (today's guests and rooms, occupancy in points, revenue, ADR, RevPAR, room nights, reservations, cancellations, ratings and pending reviews, trend charts, range and interval in the URL, five-year limit, `INVALID_RANGE`, `INVALID_INTERVAL`, `403 HOTEL_NOT_ASSIGNED` without retry, retry on `503`), `ManagerPortal.test.tsx` (each hotel's card from its own dashboard call, no hotels), `useHotelDashboard.test.ts` (at most 2 hotel dashboards at a time, in order; a failure frees its slot) |
| Support dashboard (Phase 11) | `features/support/SupportDashboard.test.tsx` (the "right now" tiles, opened and resolved with chips, open now and average age, first response average and median where down is good, resolution time, the four charts' tables, no chip without answered tickets, range and interval in the URL, each request failing on its own), `durations.test.ts` ("Under 1 min", "42 min", "1 h 35 min", "1.5 days", "–") |
| AI assistant UI (Phase 11) | Under `features/assistant/`: `chatStream.test.ts` (the SSE stream: several events per chunk, events split anywhere, CR LF and UTF-8 split across chunks, keep-alives, unknown events; the request, `401` → refresh → one retry, Problem Details, the gateway's empty `429` with `Retry-After` or the `X-RateLimit-*` headers, a non-SSE `200`), `chatReducer.test.ts` (status, delta, replace, done, error, stop, retry, restore), `useAssistantChat.test.ts` (asking again after a short `429` or a `409` right after Stop, giving up after two waits, no second question while one streams), `assistantConfig.test.ts` (launcher visibility from the config and the sign-in state, sign-in pages, portal accent, the conversation id in `sessionStorage` per user, blocked storage), `AssistantLauncher.test.tsx` (visitor, disabled, config error, open and close with the focus back on the launcher, sign-out and account switch forget the conversation), `AssistantPanel.test.tsx` (role suggestions, streaming with status and sources, Enter / Shift+Enter, character limit, Stop, error + Try again, `429` / `503` / network, grounding note, plain text without links or HTML, `401` refresh and retry, restore after reload, expired conversation, New chat, Escape, unavailable state, recording → transcription in the box, voice conversation sends at once, blocked microphone, closing frees the microphone), `MessageText.test.tsx` (a URL stays text, lists, bold, sentence chunks for screen readers), `voice/voiceSupport.test.ts` (feature detection; server, browser or no voice), `voice/recorder.test.ts` (format, stop at 60 s and at the size limit, stop after a pause, no speech, cancel, denied and missing microphone), `voice/speech.test.ts` (speakable text, parts ≤ the limit, MP3 playback from `blob:` URLs and stop, browser voice queue, browser dictation), `useAvoidBottomBars.test.ts` (the launcher moves above bottom bars only) |

### 4.3 Writing a frontend test

- **Mock the feature's API module**, not `fetch`: `vi.mock('./bookingApi')`, then render the page with
  `renderRoutes(...)` and `fakeAuth(...)` from `src/test/renderRoutes.tsx`. To check the exact HTTP request (URL,
  headers, body), spy on `apiClient.get/post`, as `features/apiContracts.test.ts` does.
- **Query by what the user sees**: `getByRole('button', { name: 'Pay' })`, `getByLabelText('Email')`. Never by CSS
  class.
- **Mocks between tests:** `restoreMocks: true` clears call history before each test, but a `vi.fn()`'s return value
  stays. Set return values in each test or in `beforeEach`.
- **Fake timers:** `findBy…` and `waitFor` do not move Vitest's fake clock. Use
  `await act(() => vi.advanceTimersByTimeAsync(ms))`, then assert.
- **Values used inside a `vi.mock(...)` factory** must come from `vi.hoisted(...)`.
- **Toasts** are dismissed after every test (`src/test/setup.ts`). Without this, a toast from one test would appear in
  the next one.
- **Dates:** the hotel search form refuses stays more than a year ahead. Tests that submit it use dates relative to
  today. Far-future fixture dates (2099) are only for display.
- **Optional fields:** jsdom names a field "Postal code(optional)" (no space). Query it with a regex: `/Postal code/`.

## 5. End-to-end tests (Playwright)

These tests drive a real Chromium browser through the whole system, like a customer would.

### 5.1 Run them

```powershell
docker compose up -d                 # the whole stack, wait until every service is healthy
cd frontend
npm run test:e2e                     # all specs, about 2 minutes
npx playwright test e2e/hotel-journey.spec.ts   # one file
npx playwright show-report           # HTML report: steps, screenshots, traces of failures, axe results
```

Expected result: every test passes (`npm run test:e2e` runs all specs in `e2e/`, including the staff portals' own
spec). Settings (`frontend/e2e/support/env.ts`):

| Variable | Default | Use |
|----------|---------|-----|
| `E2E_BASE_URL` | `http://localhost:3000` | the app; `http://localhost:5173` to test `npm run dev` |
| `E2E_MAILPIT_URL` | `http://localhost:8025` | where the verification e-mail is read |
| `DEMO_USER_PASSWORD` | read from the repo's `.env` | the demo accounts (accessibility pages of staff portals) |
| `E2E_ENV_FILE` | `../.env` | another `.env` to read the password from |

The tests run one at a time (1 worker), because they share the gateway's rate limits and the demo inventory. Saga
steps (Kafka) are waited for with `expect.poll` / `toPass` (up to 90 s), never with fixed sleeps. Since Phase 11
`logIn()` (`e2e/support/auth.ts`) retries a `429` from the login rate limit up to four times (`Retry-After`, otherwise
1, 2, 4 and 8 s), because several suites may run on the same machine.

### 5.2 The two journeys (requirements §30, steps 1–10)

| Step | Flight journey (`flight-journey.spec.ts`) | Hotel journey (`hotel-journey.spec.ts`) |
|------|------------------------------------------|----------------------------------------|
| 1. Register and log in | new account → "Check your inbox" → the link from Mailpit → "Email confirmed" → log in | same |
| 2. Search | DEL → BOM from the airport suggestions, a date 30–150 days ahead, "Refundable" filter | Goa, 2 nights 30–300 days ahead, 1 room / 2 adults, "Free cancellation" filter |
| 3. Select | first refundable fare → the re-priced trip page | "See rooms" → a "Flexible with breakfast" rate → "Review your stay" |
| 4. Details | passenger and contact details, review page, accept terms | guest, contact, special requests, review page |
| 5. Demo payment | the labelled DEMO payment panel → Pay | same |
| 6. Confirmed by the provider | "Your booking is confirmed", FL- reference, 6-character airline PNR | HT- reference, hotel confirmation number, total = quote |
| 7. My Trips | the card shows the reference, Confirmed and Cancel | same |
| 8. Download the confirmation | a real PDF: `application/pdf`, `<ref>-confirmation.pdf`, `%PDF-` … `%%EOF`, 2 KB – 5 MB | same |
| 9. Cancel | refund calculation with the airline's fee, reason, "I understand", confirm | fee ₹0.00, refund = total |
| 10. Final status | Cancelled, DX… airline reference, refund "Refunded", booking "Partly refunded" | Cancelled, HX… number, "Refunded" in full |

Since Phase 11 a customer signs in to `/customer/dashboard` (not the home page); the journeys go on from there through
the "Main" navigation as before.

Every run creates 5 new `@example.com` customers (2 journeys, the dashboard test, 2 for the accessibility scans). All
their bookings end cancelled, and their dates are random, so leftovers never block the next run.

### 5.3 The customer dashboard (`customer-dashboard.spec.ts`, Phase 11)

Proves that the dashboard shows the API's figures and nothing hard-coded:

1. A new customer is registered and verified, and one stay is booked and paid through the API (`e2e/support/api.ts`).
2. The customer signs in through the form and lands on `/customer/dashboard`. The test takes the access token from the
   page's own `GET /api/bookings/summary` request (never printed) and reads the summary with that same session.
3. The summary itself is checked against the booking: 1 booking, 1 hotel stay, 0 flights, 1 upcoming; `spending.paid`
   equals the booking's `totalAmount`; `nextTrip.reference` is the booking's reference.
4. Every figure on the page equals the API's answer, formatted as the page does (Indian grouping, ₹ without paise):
   - bookings (total, hotel stays, flights, and "x upcoming · y completed · z cancelled");
   - trips (upcoming, completed, cancelled) and spending (paid, refunded, net);
   - the period the server resolved, the next trip (hotel name, "View booking" link) and the "New" chip (nothing in
     the previous period);
   - the latest bookings list shows the booking.
5. "All time": the URL becomes `?range=ALL_TIME`, the figures equal the `ALL_TIME` answer, the page says there is no
   earlier period to compare with, and a reload keeps the period.
6. The stay is cancelled at the end (the room goes back on sale).

The test runs with `reducedMotion: 'reduce'`, so the counting KPI numbers show their final value at once.

### 5.4 The staff portals (`staff-portals.spec.ts`, Phase 11)

18 tests. Each portal (admin, hotel manager, support) signs in **once** with its demo account at its own sign-in page
and keeps the page for its whole `describe` block (`mode: 'serial'`). Reduced motion is on, so the KPI values are final
at once and every section is visible to axe.

| Step | What is checked |
|------|-----------------|
| 1. Sign-in and landing | `/admin/login` → `/admin`, `/hotel-manager/login` → `/hotel-manager` (portfolio), `/support/login` → `/support`; the portal's navigation is there |
| 2. Figures equal the API | The test captures the analytics request the page made (its query and the session's token), reads the same endpoint with that token and range, and compares the figures on screen with the answer, formatted as the app does (₹ with Indian grouping, counts, one-decimal %). Admin (`LAST_7_DAYS`): net and gross revenue, hotel and flight bookings, failed payments, success rate, cancellations, new customers. Hotel manager (first assigned hotel, default range): arriving and in-house guests, occupancy tonight, revenue, occupancy, ADR, available room nights, reservations; the portfolio card shows the same revenue and arrivals. Support (`LAST_7_DAYS`): opened, resolved, open now, the "Open: n" / "Escalated: n" tiles and the status chart's table |
| 3. Filters change the request | A preset sends `range=…` and updates the URL and the chart titles ("Bookings per month"); an interval sends `interval=…`; with "Last 5 years" the "Day" interval is disabled |
| 4. Not assigned | A manager opening a hotel that is not theirs sees "This hotel is not assigned to you" |
| 5. axe | WCAG 2.1 A/AA, 0 serious or critical: each dashboard (desktop and 390 px), the hotel portfolio, and list pages (admin payments and hotels, hotel reviews, support escalations and booking lookup) |
| 6. Phone 390 × 844 | No sideways scrolling on each dashboard and the portfolio; "Open navigation" opens the drawer with the portal's navigation, and choosing a page closes it |
| Refusals | A customer at `/admin/login` gets `403` and "This account can't sign in here", stays on the page, has no `fh_refresh` cookie, and `/admin` still asks to sign in. A signed-in customer opening `/admin` sees "You don't have access to this page" with "Sign in to the admin portal" |

Other suites book and cancel on the same stack at the same time, so the comparisons retry (`toPass`, up to 150 s) until
the page and the API agree. The spec signs in 5 times in total. To run it alone against a dev server:

```powershell
npm run dev -- --port 5176 --strictPort                       # in another terminal
$env:E2E_BASE_URL = 'http://localhost:5176'; npx playwright test e2e/staff-portals.spec.ts
```

### 5.5 The assistant (`assistant.spec.ts`, Phase 11)

8 tests against the real local model, one question at a time (up to 3 minutes per answer). On a quiet machine the spec
takes about 2 minutes, plus about 1 minute for the booking set-up. Answers are much slower while Maven or an image
build uses the CPU ([AI_ASSISTANT.md](AI_ASSISTANT.md) §10).

```powershell
npm run dev -- --port 5177 --strictPort                       # in another terminal (or the Docker frontend on :3000)
$env:E2E_BASE_URL = 'http://localhost:5177'; npx playwright test e2e/assistant.spec.ts
```

| Test | What is checked |
|------|-----------------|
| Visitor | No launcher on `/` and `/hotels`, and no request to `/api/assistant/*` |
| Empty panel | A new customer with a confirmed, paid stay (created through the API): the role's suggestions, the read-only note, axe on the panel (desktop); Escape closes it and the focus returns to the launcher |
| Upcoming trips | The answer contains the booking reference returned by the API, shows "Based on:" with source chips and contains no link; axe on the panel with the answer |
| Phone 390 × 844 | The panel is a full-screen sheet, no horizontal scroll, axe |
| Unknown reference | "HT-ZZ9ZZ9ZZ": the answer says it was not found and names no other reference and no amount (unless it lists the customer's real booking) |
| Reload | The conversation is restored from the server (`GET /conversations/{id}`) |
| Voice round trip (profile `voice`; skipped with the reason otherwise) | The speech server's MP3 of "What are my upcoming trips?" is decoded to WAV and fed to Chromium's fake microphone (`--use-file-for-fake-audio-capture`); the recording stops by itself after the pause and the transcription lands in the question box; with "Read answers aloud" on, the answer's `/voice/speech` call succeeds; no CSP or Permissions-Policy error in the console |
| Admin figure | "How many paid bookings did we get this month in total?" equals `bookings.hotel + bookings.flight` of `GET /api/admin/dashboard?range=THIS_MONTH` (read before and after, as other suites may book meanwhile); the panel has the admin accent and staff suggestions; axe |

The axe scans in this spec cover the launcher and the panel only (`[data-assistant-root]`); the pages around them have
their own scans in `accessibility.spec.ts` and `staff-portals.spec.ts`.

## 6. Accessibility checks (axe)

`e2e/accessibility.spec.ts` (part of `npm run test:e2e`) scans 44 page states in 44 tests against **WCAG 2.1 A and AA** with
axe-core. It fails on any **serious** or **critical** violation.

- **Public pages (desktop):** home, flight results, hotel results, hotel details, the four sign-in pages (customer,
  admin, hotel manager, support), a sign-in at the wrong portal (message and links), old `/login` links, register (also
  showing its errors), offers, about, help.
- **Public pages at phone width (390 × 844):** home with the menu open, hotel results with filters open, flight
  results, the four sign-in pages, offers.
- **Customer pages:** My Trips, booking details, cancellation, profile, notification center, the open account menu and
  the open notification panel, and the **customer dashboard** with a confirmed trip at desktop and phone width.
- **Customer dashboard of a customer who has not booked yet** (a new account): desktop and phone width; it shows the
  invitation ("Your first trip starts here", "How it works") and no figures.
- Both phone scans of the dashboard also check that the page does not scroll sideways at 390 px
  (`document.documentElement.scrollWidth === clientWidth`).
- **Staff pages:**
  - admin: dashboard, reports, a report, bookings, users, and the dashboard at phone width with the navigation drawer
    open;
  - hotel manager: dashboard, reservations;
  - support: access denied (a support agent opens the admin portal), dashboard, ticket queue.
- `staff-portals.spec.ts` (§5.4) adds its own axe scans of the staff dashboards, the hotel portfolio and list pages;
  `assistant.spec.ts` (§5.5) scans the assistant's launcher and panel.

Result on 2026-11-06: **0 violations of any severity**. The fixes in Phase 10:
- text contrast in the admin menu and the notification panel;
- buttons whose accessible name did not match their visible text (account menu, notification bell, support tiles);
- the unread dot, which screen readers did not announce.

The only exclusion is the OpenStreetMap iframe on the hotel page (third-party content). Its `title` is still checked.
The axe result of every scan is attached to the HTML report.

When you build a page:
- give every input a `<label>`;
- give every icon-only button an accessible name;
- name a link that is a whole card or tile by its visible text: keep badges and notes outside the link, and do not put
  a screen-reader-only colon inside a flex item (Chrome then reads "Open : 4"); axe reports
  `label-content-name-mismatch` (fixed in Phase 11 on the hotel portfolio cards and the support tiles);
- keep text at `text-slate-500` or darker on white;
- add the page to `accessibility.spec.ts`.

## 7. Security checks

### 7.1 Endpoint access matrix

```powershell
node tests/security/endpoints.mjs
```

The script reads all 159 operations from the services' OpenAPI documents and calls each one through the gateway:
- without a token: every non-public operation must answer `401`;
- as customer, hotel manager and support agent: every staff endpoint the role has nothing to do with must answer `403`.

Expected: `anonymous: every non-public endpoint answered 401…`, `roles outside their areas: every call answered 403`,
then `OK` and exit code 0. The webhook is public but answers an unsigned call with `401 INVALID_WEBHOOK_SIGNATURE`;
the script knows this. Inside its own area a role may get `400`/`404` (random ids, empty bodies). The services'
`EndpointSecurityTest` proves the exact permissions there with valid requests.

### 7.2 Live checks

```powershell
node tests/security/checks.mjs       # about 1 minute, expected: "81 passed, 0 failed"
node tests/security/auth-extra.mjs   # about 1 minute (waits 32 s), expected: "19 passed, 0 failed"
```

They create their own customers and a paid hotel booking, then test it as an attacker would:
- another customer's bookings, documents, payments, tickets, passengers and notifications → `404`;
- forged tokens: changed payload, `alg: none`, HS256 key confusion → `401`;
- logout revokes the access token;
- the refresh cookie is HttpOnly, SameSite=Strict, `Path=/api/auth`;
- refresh needs the `X-Requested-With` header and our Origin;
- an old refresh token works for 30 s (other tabs), then ends the whole session;
- 5 wrong passwords lock the account (`423`);
- login, register and forgot-password answer the same for known and unknown e-mails;
- uploads:
  - text, HTML, SVG or an `.exe` named `.jpg` → `422 INVALID_IMAGE`;
  - more than 2 MB → `413`;
  - a real image is re-encoded (its metadata is removed);
- downloads: `attachment`, `Cache-Control: no-store`, `nosniff`;
- SQL and sort injection → `400` or empty results, never `5xx`;
- HTML in tickets stays text in e-mails;
- security headers are present, and the actuator endpoints are closed;
- passport numbers are stored encrypted, and only the last 4 digits are shown.

Note: `checks.mjs` makes many login calls, and the gateway allows 2 per second (burst 10) per IP. If you run it right
after another script, some calls wait a few seconds for the limit.

### 7.3 Logs

```powershell
node tests/security/logscan.mjs
```

The script reads every container's log and looks for:
- any secret value from `.env`;
- JWTs, `Bearer` headers and refresh cookies;
- passwords, passport numbers and card numbers;
- payment signatures;
- e-mail-link tokens.

It prints only counts and a masked example, never the value. Expected: `no secrets, tokens or personal data patterns
in any log`. Run it after the e2e tests, so the logs contain real traffic.

Since Phase 11 it also scans the assistant's containers: `mcp-client-service`, `mcp-server-service`, `ollama` and
`speaches` (13 containers). Their logs must never contain questions, answers or tool data, so for these four it also
looks for booking references (`HT-…`, `FL-…`) and rupee amounts. Run it after `assistant.spec.ts` or
`tests/assistant/live-checks.mjs`, so the logs contain real conversations.

### 7.4 Dependencies and secrets

```powershell
cd frontend; npm audit --omit=dev; npm audit; cd ..   # expected: found 0 vulnerabilities (both)

# Every image: OS packages and Java/JS libraries (HIGH and CRITICAL)
docker compose build
foreach ($i in 'api-gateway','identity-service','hotel-service','flight-service','booking-service','payment-service','notification-service','reporting-service','mcp-server-service','mcp-client-service','search-service','frontend') {
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache aquasec/trivy:latest image --quiet --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed "flighthotel/${i}:local"
}

# Secrets in the working tree (the report is redacted)
docker run --rm -v "${PWD}:/repo:ro" zricethezav/gitleaks:latest dir /repo --redact --no-banner --max-target-megabytes 5
```

- **Trivy:** expected 0 HIGH or CRITICAL findings with a fix available. If one appears:
  - for a Java library, pin the fixed version in `<dependencyManagement>` of the root `pom.xml`;
  - for an OS package, rebuild the image (both Dockerfiles install the OS security updates);
  - for an npm package, update it or add an `overrides` entry in `frontend/package.json`.
- **gitleaks:** findings in `.env` are expected, because `.env` is git-ignored and holds the real local secrets.
  Findings in tests (fixed test keys, idempotency keys) and in `target/` (ids in test logs) are not secrets. Anything
  else must be removed and the secret rotated.

### 7.5 AI assistant (live, real model)

```powershell
node tests/assistant/live-checks.mjs          # questions of all four roles, attacks, voice round trip, timings (5–15 min)
node tests/assistant/model-eval.mjs --models granite4:tiny-h,granite4.1:3b     # model evaluation (AI_ASSISTANT.md §5)
node tests/assistant/model-eval.mjs --snapshot-tools                            # after changing a tool
```

`live-checks.mjs` runs against the Docker stack with the real model. It creates customer A with a paid booking and
customer B, then:
- asks A's questions (upcoming trips, booking details, refund quote);
- lets B ask for A's booking: the answer must be "not found", without any of A's data;
- asks for a booking that does not exist: no invented status or amount;
- tries a prompt injection: no data, no staff tools;
- asks as admin (bookings this month, failed payments last week, compared with the APIs), hotel manager (arrivals
  today) and support agent (open tickets).

Like the security scripts, it reads `DEMO_USER_PASSWORD` from `.env` and never prints it. The latest results are in
[AI_ASSISTANT.md](AI_ASSISTANT.md) §11.4. Answers are slow while Maven or an image build uses the CPU, so run it alone.

## 8. Load test (k6)

`tests/load/search-and-booking.js` runs three scenarios at the same time against the Docker stack:

| Scenario | Users | What they do | Thresholds (the run fails if missed) |
|----------|-------|--------------|--------------------------------------|
| `search` | ramps to 30 | hotel search → rooms of a hotel → flight search, 1–3 s think time | errors < 1 % (a `429` counts as an error); p95 hotel search < 1.5 s, rooms < 1 s, flight search < 1.5 s |
| `booking` | 6 | hotel and flight bookings end to end: quote → booking → DEMO payment → `CONFIRMED` | p95 create booking < 1.5 s, create order < 1.5 s; > 95 % confirmed; p95 time to confirmed < 20 s |
| `lastRooms` | 15 at once | all try to book the same room type on the same night, where only **3** rooms are on sale | exactly 3 bookings hold a room; every other attempt is refused cleanly; 0 errors |
| all | | | failed requests < 1 % in the whole run. "No rooms left" (`409`) and the setup's waits for the auth rate limit (`429`) are expected answers, not failures |

Each virtual user registers its own account first (through Mailpit). The gateway limits requests **per user**, so one
shared account would only measure the rate limiter.

```powershell
$env:DEMO_USER_PASSWORD = (Select-String -Path .env -Pattern '^DEMO_USER_PASSWORD=(.*)$').Matches[0].Groups[1].Value
docker run --rm -i --network flight-hotel_default -e DEMO_USER_PASSWORD -v "${PWD}/tests/load:/scripts:ro" grafana/k6:latest run /scripts/search-and-booking.js
Remove-Item Env:DEMO_USER_PASSWORD
```

- k6 runs **inside** the Compose network and calls `http://frontend` (nginx), like a browser.
- The manager password is only used to put 3 rooms on sale for `lastRooms`. Without it, that scenario is skipped.
- Options as environment variables (`-e NAME=value`): `SEARCH_VUS` (30), `BOOKING_VUS` (6), `LAST_ROOM_VUS` (15),
  `ACCOUNTS` (30), `HOLD` (2m, how long the full load lasts).
- Smoke run, for example after changing the script: `-e ACCOUNTS=4 -e SEARCH_VUS=2 -e BOOKING_VUS=2 -e LAST_ROOM_VUS=5 -e HOLD=40s`.
- Expected result: every threshold marked `✓` and exit code 0. The last-rooms night (250–330 days ahead) keeps 3 rooms
  on sale afterwards. It is demo data; change it back on the manager's inventory calendar if needed.

This is a **basic** load test on one developer machine. It proves the system stays correct and responsive under
moderate concurrent use. It does not measure production capacity.

## 9. Simulation switches (failure paths)

The DEMO providers can simulate supplier problems, so every failure path can be tried by hand or in tests.

| How | Effect |
|-----|--------|
| Flight passenger last name `REJECT` | the airline refuses the order after payment → full refund → booking `REFUNDED` |
| Last name `TIMEOUT` | the order **is** issued but the answer is lost → reconciliation finds it → `CONFIRMED` |
| Last name `TIMEOUTLOST` | the answer and the order are lost → reconciliation finds nothing → refunded |
| Last name `NOCANCEL` | the airline refuses the cancellation → a support ticket is opened |
| Last name `CANCELTIMEOUT` | cancelled, but the answer is lost → found by reconciliation |
| Last name `CANCELLOST` | no answer and nothing cancelled → after several looks, the customer is told the booking stays valid |
| `travel.flight.demo.failure-rate`, `timeout-rate` (flight-service, 0–1, default 0) | `REJECT` / `TIMEOUT` at random for every order |
| "Fail the payment" on the DEMO payment panel (`POST /api/payments/demo/fail`) | a declined payment; the customer can try again while the booking waits for payment |

Details: [SUPPLIER_INTEGRATION.md](SUPPLIER_INTEGRATION.md) §4 and [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md).

## 10. Before a release

Run these in order. Stop at the first failure.

1. `.\mvnw.cmd verify`: backend tests and the coverage report.
2. `cd frontend; npm run typecheck; npm run lint; npm test; npm run build`.
3. `docker compose build; docker compose up -d`, then wait until every container is healthy.
4. `cd frontend; npm run test:e2e`: every spec (journeys, dashboards, accessibility scans).
5. `node tests/security/endpoints.mjs`, `checks.mjs`, `auth-extra.mjs`, `logscan.mjs`.
6. The dependency scans (§7.4).
7. The load test (§8).
8. A short manual look at the phone layout of the changed pages.

## 11. Results (Phase 11, 2026-11-06)

| Check | Result |
|-------|--------|
| Backend (`mvnw clean verify`, fresh copy) | **515 tests, 0 failures** (11:44 min); coverage 90.5 % of lines, 73.3 % of branches (all modules) |
| Frontend (`npm test`) | **1,233 tests, 0 failures** (117 files); coverage 91.2 % of lines, 86.3 % of branches; type-check, lint and build clean. One of four coverage runs had 2 failures that did not repeat (likely timeouts under load) |
| End-to-end + accessibility (`npm run test:e2e`, final images) | **72 passed, 1 skipped** in 4.6 min (2 journeys, customer dashboard, staff portals 18, assistant 8, accessibility 44); the skipped test is the voice round trip, which passed with the `voice` profile running (`assistant.spec.ts` 8/8). 0 axe violations of any impact |
| Endpoint matrix | 167 operations in 8 services: all non-public → `401`; roles outside their areas → `403` |
| Live security checks | `checks.mjs` 81/81, `auth-extra.mjs` 19/19 |
| Assistant live checks | `live-checks.mjs` 20/20 with the real model: another customer's booking → not found, no invented data, injection refused, staff figures equal the API; answers in 5–20 s |
| Logs | clean in all 13 containers, after all the test traffic (including conversations) |
| npm audit / Trivy / gitleaks | 0 / 0 fixable findings (HIGH, CRITICAL or MEDIUM) in all 11 of our images / only the expected findings (`.env`, test fixtures, `target/`). Third-party: `ollama` 2 HIGH, `speaches` 83 (see the plan, §11.6) |
| Load test | search: 2,334 requests, 0 errors, p95 ≤ 42 ms; bookings: 199/199 confirmed, p95 3.0 s to `CONFIRMED`; last rooms: exactly 3 of 15; 0 of 5,252 requests failed |

## 12. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not find a valid Docker environment` | Start Docker Desktop. |
| Backend tests fail with `No qualifying bean of type ...Mapper` | An IDE rebuilt `target/` at the same time without MapStruct. Close the IDE's automatic build, or run Maven from a copy of the repository. |
| A flight test finds no flights on some days | The demo timetable has flights that do not run every day. Search on a day every flight runs (Monday). |
| Playwright: `Executable doesn't exist` | `cd frontend; npx playwright install chromium` |
| Playwright: login or register gets `429` | The gateway's auth limit (2/s per IP, burst 10). `logIn()` retries a `429` four times; if it still fails, run one suite at a time and wait a minute after the security scripts. |
| Playwright: "no verification e-mail" | Mailpit is not running or `E2E_MAILPIT_URL` is wrong. Open http://localhost:8025. |
| Playwright against `npm run dev`: "element was detached" or repeated navigations | Vite reloads the page whenever a source file changes, for example while other work edits `src/`. Test a build instead: `npx vite build --outDir <dir>`, then `npx vite preview --outDir <dir> --port 5175 --strictPort` (same `/api` proxy) and `E2E_BASE_URL=http://localhost:5175`. Vite also reloads when an `.html` file under `frontend/` changes, and Playwright writes traces as `.html`: the dev server ignores `test-results*/` and `playwright-report*/` (`vite.config.ts`), so keep any other `--output` folder outside `frontend/`. |
| A saga step times out in e2e | Check `docker compose ps`: every service must be healthy, especially Kafka and kafka-connect. |
| Security scripts: `login … -> 401` | `DEMO_USERS_ENABLED=true` and the right `DEMO_USER_PASSWORD` in `.env`. The demo accounts are created on first start. |
| `checks.mjs` fails one IDOR step with "has bookings to probe with" | The booking for customer A did not confirm. Check the payment and booking services' health. |
| k6: `lookup frontend: no such host` | Add `--network flight-hotel_default`, or set `-e BASE_URL=http://host.docker.internal:3000 -e MAILPIT_URL=http://host.docker.internal:8025`. |
| k6: `last_room_holds` is 0 | `DEMO_USER_PASSWORD` was not passed (`-e DEMO_USER_PASSWORD`), so the scenario was skipped. |
| `npm run test:coverage`: "directory already in use" | Another coverage run is still going. Wait, or pass `--coverage.reportsDirectory=<other folder>`. |
