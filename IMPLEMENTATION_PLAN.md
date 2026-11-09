# Implementation Plan

> Updated: 2026-11-09 · Phase 11 done + portal upgrades, global search, Inter font · **Kubernetes on kind (HA), Argo Rollouts, Argo CD, GitHub Actions: done and tested** · Hotel manager pages redesigned · CSV / Excel / PDF export on every table · Background export of the whole audit log (10 million rows in about 3 minutes) · Next: manual testing (Docker Compose or kind) · Phase 12 (AWS EKS with Argo CD) when you give the go-ahead

## How we work

- Each phase is a **vertical slice**: backend + frontend pages + tests + docs for that area, so every phase ends
  with something that really works end to end.
  *(Changed from §34, which put all frontend work in Phase 7. A module can only be verified when its UI and API
  work together.)*
- A phase is done only when its **exit checks** pass. Tests are run, results are recorded here, and the docs are updated.
- Status legend: ⬜ not started · 🟡 in progress · ✅ done (verified) · ⏸ on hold

---

## Phase 1 — Analysis and architecture ✅

- [x] Inspect repository (empty apart from requirements; Java 21, Maven 3.9, Node 24, Docker 29 available)
- [x] Resolve the monolith vs microservices conflict → coarse microservices (D1)
- [x] Evaluate flight/hotel suppliers → DEMO flight provider, internal hotel inventory (D2, D3)
- [x] Payment provider requirements (Razorpay + DEMO)
- [x] Architecture, database design, booking workflow, supplier and payment docs
- [x] **Approved** 2026-11-02, plus auto refresh requirement → SSE + client pub/sub (D10, REALTIME_UPDATES.md)

## Phase 2 — Foundation ✅

**Verified 2026-11-03**
- `mvnw verify`: 36 backend tests green (common-lib 19, api-gateway 5, notification-service 6 incl. Redis → hub → real
  SSE stream, reporting-service 6 against MySQL via Testcontainers). `npm test`: 23 frontend tests green; lint,
  type-check and production build clean.
- `docker compose up`: all 16 containers healthy; 7 Debezium connectors RUNNING.
- Pipeline check: reporting-service's 12 default settings went outbox → Debezium → `settings.events` (Avro, subject
  registered in Schema Registry, headers `id`/`eventType`/`correlationId`) → **consumed by all 7 services**.
- Gateway: public vs protected routes (401), CORS allow/deny, Redis rate-limit headers, one correlation ID per
  response (also on 401s), Swagger UI aggregating all services.
- Frontend via nginx: SPA + deep links, `/api` proxy, SSE route, security headers.
- Running a service from PowerShell (`scripts\run-service.ps1`) against the Docker infrastructure.

**Carried into Phase 3:** SSE through the gateway with a real JWT (needs identity-service's JWKS); context smoke
tests for the services that are still skeletons are added when each service gets its first feature.

Original scope:

- `git init`, `.gitignore`, `.editorconfig`, `.env.example`
- Maven parent + `common-lib` (Problem Details errors, correlation ID filter, logging aspect, outbox writer,
  idempotent consumer, JWT resource-server config, pagination) + `event-schemas` (Avro plugin)
- 8 service skeletons: health endpoint, Swagger UI, Flyway baseline (`outbox_events`, `processed_events`)
- `docker-compose.yml`: MySQL (binlog on, 7 DBs + 7 users), Redis, Kafka (KRaft), Schema Registry, Kafka Connect +
  Debezium, Elasticsearch, Mailpit, optional Kafka UI; health checks, volumes, memory limits
- Debezium outbox connector per service; gateway routes
- React app skeleton: Vite, Tailwind, router, Axios client, TanStack Query, design-system primitives, layouts
- **Realtime foundation**: `RealtimePublisher` (common-lib), realtime hub with SSE endpoint in notification-service,
  gateway streaming route; frontend SSE client, tab coordinator, event bus, provider, invalidation rules, live indicator
- **System settings broadcast** (reporting-service → `settings.events` → every service) as the first real
  outbox → Debezium → Kafka → consumer flow
- PowerShell scripts for running services without Docker
- Docs: README, LOCAL_SETUP_GUIDE.md, DOCKER_SETUP.md

**Exit checks:** `docker compose up` → all containers healthy · a settings change goes outbox → Debezium → Kafka
(Avro) → consumers · a realtime message published to Redis reaches an SSE client (automated test) · frontend loads
through the gateway · `mvn verify` and `npm test` green.

## Phase 3 — Identity and authentication ✅

Registration, email verification, login/logout, access + refresh tokens (rotation, reuse detection), forgot/reset
password, roles & permissions, profile + photo upload, saved passengers (encrypted passport), travel preferences,
login history, admin activate/deactivate. Minimal notification-service email sending (Mailpit).
Frontend: Login, Register, Verify Email, Forgot/Reset Password, Profile sections, role-based route guards.
Docs: SECURITY_GUIDE.md, API_DOCUMENTATION.md (auth).

**Exit checks:** security tests (401/403 per role), token rotation/reuse tests, form validation tests,
manual run-through: register → email in Mailpit → verify → log in.

**Backend ✅ verified 2026-11-05**
- identity-service: all endpoints of API_DOCUMENTATION.md §2–4 (auth, JWKS, profile + photo, saved passengers,
  preferences, security, admin users), demo users per role (local only), daily housekeeping job.
- notification-service: account emails from `identity-email.events` (new topic, 24 h retention) → Thymeleaf HTML +
  text → SMTP; idempotent (inbox), log in `email_messages`, expired links not sent.
- `mvnw verify`: **95 backend tests green** (was 36). identity-service 40 (28 integration against MySQL + Redis:
  401/403 per role, refresh rotation, two-tab grace, reuse → family revoked, lockout, reset/invitation, deactivation,
  role change, passenger ownership + encryption at rest, photo pipeline; 12 unit), notification-service +12 (Mailpit
  end-to-end, idempotency, template escaping).
- Docker end to end through the gateway: register → email in Mailpit (~1 s via outbox → Debezium → Kafka) → verify →
  login → profile → refresh rotation + CSRF header check → **SSE through the gateway with a real JWT** (Phase 2
  carry-over) → "log out everywhere" delivers `session.revoked` to the open stream → tokens and cookie rejected.
- Fixed on the way (all services): Spring Boot's Problem Details handler hid our `code`/`correlationId` on framework
  errors (now disabled; ours handles all); Jackson 3 rejected a missing `boolean` such as `rememberMe` (now defaults to
  false); oversized uploads answer `413 FILE_TOO_LARGE`. Compose passes `DATA_ENCRYPTION_KEY` to identity-service
  (it could not start before) and keeps profile photos in the `identity-storage` volume.

**Frontend ✅ verified 2026-11-05**
- Pages: Login (reasons, resend verification, lockout time), Register (live password checklist), Verify Email,
  Forgot/Reset Password (also the staff invitation), My account → Profile + photo, Saved passengers, Travel
  preferences, Security (change password, log out everywhere, login history). Header account menu with avatar.
- `AuthProvider`: session restored from the HttpOnly cookie on load, tab sync (login/logout), realtime
  `session.revoked` logs out every tab, user data removed from the cache on logout/user change. Guards `RequireAuth`
  (with `?redirect=`, open-redirect safe) and `RequireRole`; admin, hotel-manager and support portals are guarded now
  and built in their phases. Auth pages and "My account" are lazy-loaded chunks.
- `npm test`: **96 tests green** (was 23): form validation (schemas + pages), server error mapping, guards,
  AuthProvider (restore, logout, revoked), passengers UI, refresh client. Lint (0 warnings), type-check, build clean.
- Browser run-through (Chromium, Docker stack, 21/21 checks, no console errors): register → validation → email in
  Mailpit → verify link → wrong password → log in → profile + photo → passenger (passport masked) → preferences →
  reload keeps the session → customer gets "no access" on /admin → login history → log out everywhere also logs out
  the second tab → visitor redirected to login and back → admin lands in the admin portal.
- Found and fixed by the run-through: profile photo 406 (Accept header); behind nginx every anonymous visitor shared
  ONE rate-limit bucket and the gateway dropped client IPs (login history showed the gateway) → gateway
  `trusted-proxies` + client-IP key resolver, nginx overwrites `X-Forwarded-For`; `/api/auth/refresh` and `/logout`
  no longer count against the strict login limit; a 429/5xx/network error on refresh no longer logs the user out.

## Phase 4 — Hotel catalog, inventory and search ✅

Hotel manager CRUD (hotels, images, amenities, policies, room types, rate plans, seasonal prices, inventory
calendar), admin hotel management and manager assignment, Elasticsearch indexing via events, search with all
filters, hotel details, room list, availability quote. Labelled demo hotel data.
Frontend: Hotel Search, Results, Details (gallery, map, reviews placeholder), Room Selection; Hotel Manager:
Hotel Profile, Room Management, Inventory Calendar, Room Pricing.

**Exit checks:** inventory concurrency test (parallel holds on last room → exactly one wins) · search filter
tests · manager can't access unassigned hotel (test).

**Verified 2026-11-05**
- hotel-service: catalogue (hotels, amenities, rules, photos 1600/480 px), room types, rate plans with cancellation
  terms, seasonal prices, per-night inventory (365 days, extended nightly), atomic hold/release/confirm for Phase 5,
  GST pricing from System Settings, Elasticsearch read model rebuilt from MySQL on every `HotelCatalogChanged`
  (versioned mapping, self-repair on startup), search with every §10 filter + facets + sorting, details, rooms for a
  stay, quotes in Redis (15 min). Admin: create, publish (with readiness check), manager assignment by email (local
  copy of identity's users from `identity.events`). 16 labelled demo hotels in 8 cities.
- **Exit checks green:** 20 parallel holds on the last room → exactly 1 wins, overlapping stays never double-hold a
  night, failed holds leave no partial nights (`InventoryConcurrencyIntegrationTest`); 16 search tests covering every
  filter, sort, availability, capacity, validation, details, rooms and quotes (`HotelSearchIntegrationTest`); managers
  get `403 HOTEL_NOT_ASSIGNED` on every endpoint of an unassigned hotel, access ends when unassigned
  (`HotelManagementIntegrationTest`). All against real MySQL, Redis and Elasticsearch (Testcontainers).
- `mvnw verify`: **127 backend tests green** (hotel-service 28). `npm test`: **117 frontend tests green**; lint,
  type-check, build clean.
- Browser run-through (Chromium, Docker stack, 18/18): home search → results → star/distance filters, price sort →
  hotel page with OpenStreetMap → reserve → quote with GST and 15-minute countdown; manager sees only assigned
  hotels, edits profile, adds a seasonal price, sets stop-sell in the calendar, is refused on another hotel; admin
  creates a draft, publishing is refused with the missing items, assigns a manager.
- Frontend: Hotel search widget (home, /hotels), Results with filters in the URL, Details (gallery, map, rules,
  nearby, reviews placeholder), Room selection, Quote review; Hotel manager portal (My hotels, Profile, Photos,
  Rooms & rates incl. seasonal prices, Inventory calendar with live refresh); Admin portal shell + Hotels.
- Fixed on the way: a document written to a missing index made Elasticsearch guess the mapping (no geo_point) →
  index now always created with our versioned mapping first; filter checkboxes briefly flipped back during
  navigation → URL updates are applied synchronously; "Jaipur" also found Udaipur (fuzzy match, 2 edits) → a known
  city is matched exactly, free text with fuzziness AUTO:4,8.
- Deviations (documented in DATABASE_DESIGN.md §3): cancellation terms on the rate plan, no hotel chains yet.

## Phase 5 — Bookings, payments and the hotel booking saga ✅

booking-service (state machine, status history, coupons, My Trips), payment-service (DEMO + Razorpay, verify,
webhook, idempotency, invoices), hotel hold/confirm/expiry, booking notifications (email + in-app).
Frontend: Guest Details, Hotel Booking Review, Payment, Payment Result, My Trips, Hotel Booking Details,
Payment History. Docs: PAYMENT_INTEGRATION.md final, BOOKING_WORKFLOW.md updated.

**Exit checks:** saga tests for every hotel failure path in BOOKING_WORKFLOW.md §2 · webhook signature and
duplicate tests · E2E hotel booking with DEMO payment (and Razorpay test mode if keys are provided).

**Verified 2026-11-05**
- booking-service (started by an earlier session, audited and completed here): hotel booking saga with the state
  machine and status history, `Idempotency-Key`, coupons (reserved on hold, consumed on confirmation, released on
  expiry or failure), My Trips tabs, details and timeline, jobs (unanswered bookings fail after 10 min, past stays
  complete). hotel-service: hold / confirm / release with expiry job. Details: BOOKING_WORKFLOW.md §2.1.
- payment-service (new): `PaymentProvider` with **DEMO** (signed, stateless, off in production) and **Razorpay**
  (plain HTTPS adapter, paise only inside it); `create-order` for the server-known amount, one open order per booking,
  `verify` (signature + the provider's own record + amount/order checks), signed **webhook** (raw-body signature before
  parsing, duplicate event ids ignored, sanitized summary stored), refunds (once per request id, never above the
  captured amount), reconciliation job (5 min), gap-free invoice numbers `INV/2026-27/000123`, Payment History and
  invoice APIs. Details: PAYMENT_INTEGRATION.md §8.
- notification-service: in-app notifications (bell: list, unread count, read, read-all, live refresh) and e-mails for
  "booking confirmed" and "refund started". Full notification center, preferences and PDFs stay in Phase 8.
- Frontend: Guest Details, Hotel Booking Review, Payment (DEMO panel and Razorpay Checkout), Payment Result,
  My Trips, Hotel Booking Details with timeline/payments/invoice, Payment History, notification bell; the quote page
  now continues into booking; CSP allows Razorpay Checkout.
- **Exit checks green:**
  - *Saga tests for every hotel failure path*: booking-service `HotelBookingSagaIntegrationTest` (14) and hotel-service
    `HotelBookingSagaIntegrationTest` (10): quote expired, sold out, price changed, invalid guests, unpaid expiry,
    failed payment + retry, payment after expiry (refund), paid at the last moment, hotel cannot confirm (refund),
    second payment (refund), duplicate and late events, hotel silent. Table in BOOKING_WORKFLOW.md §2.1.
  - *Webhook signature and duplicate tests*: `RazorpayPaymentFlowTest` (15): wrong, missing and tampered signature → 401
    and nothing stored; the same event id twice → one payment event; `order.paid` after `payment.captured` → one event.
  - *E2E hotel booking with the DEMO payment*, live on the Docker stack (`e2e-hotel-booking.mjs`, **43/43**): register,
    e-mail verification, search, quote, book (idempotent), coupon, failed payment, forged callbacks refused, retry,
    paid → hotel confirms → **CONFIRMED** with the confirmation number only then, gap-free invoice, Payment History,
    notifications and e-mails, other customers get 404, wrong webhook signature 401. A second live check covers the
    hold-failure path (expired quote → `FAILED / QUOTE_EXPIRED`, nothing payable). Browser run-through (Chromium,
    Docker stack): guest details → review → payment (Fail, then Pay) → confirmation → booking details → Payment
    History → bell; phone width checked.
  - *Razorpay test mode*: **not run, no keys were provided.** The Razorpay adapter is tested over real HTTP against a
    local stand-in for Razorpay's API; the checklist for the real run is PAYMENT_INTEGRATION.md §9.
- `mvnw verify`: **188 backend tests green** (common-lib 28, api-gateway 9, identity 40, hotel 38, booking 19,
  payment 27, notification 21, reporting 6). `npm test`: **177 frontend tests green** (60 new); lint, type-check and build clean.
- Fixed on the way: review page jumped back to guest details after booking (the draft was deleted while the code-split
  payment page loaded; only visible in a real browser, now a regression test that fails without the fix);
  `UuidV7.generate()` is now monotonic inside one JVM, because status-history rows written in the same millisecond could
  appear in the wrong order in the timeline (a flaky saga test exposed it).
- Deviations: notifications and e-mails are limited to booking/payment/refund events (Phase 8 adds the rest);
  refund webhooks reuse `payment.status-changed` (the `refund.status-changed` message is for Phase 7); flight tables,
  cancellations and admin refunds are not built yet (Phases 6, 7, 9).

## Phase 6 — Flights ✅

Airports/airlines + autocomplete, DEMO provider (schedules, fares, seats, holds, orders, simulation switches),
search + filters + compare, offer details, revalidation, flight booking saga incl. uncertain outcomes and
reconciliation, passenger management integration.
Frontend: Flight Search, Results (compare), Details, Passenger Details, Flight Booking Review, Flight Booking
Details; Admin: Flight Provider Management.

**Exit checks:** flight saga tests incl. TIMEOUT/REJECT/PRICECHANGE simulations · E2E flight booking.

**Verified 2026-11-05**
- flight-service (new): 41 airports, 12 airlines, 8 fare families and ~1,350 generated schedules (labelled DEMO); the
  provider interfaces of SUPPLIER_INTEGRATION.md with the DEMO adapter; airport autocomplete; search for one-way and round
  trips with every requirement filter (airlines, stops, price, refundable, departure/arrival time windows, duration, cabin),
  4 sorts and facets; `revalidate` into a 20-minute trip offer (re-price, seat check, price-changed notice); the booking saga
  (hold all-or-nothing, re-price at hold, order with the booking id as idempotency key, rejection, lost answers reconciled
  by lookup, hold expiry, late payment); Flight Provider Management (enable, priority, health job). Details: BOOKING_WORKFLOW.md §3.1.
- booking-service: `POST /api/bookings/flight` (idempotent, passenger rules, passport numbers encrypted and never in
  events), flight saga handlers, trip details with PNR and tickets only once confirmed, round-trip dates.
  payment-service: flight invoices; **fixed on the way:** `PAYMENT_NOT_READY` (409) instead of a misleading 404 when the
  payment page asked before payment-service had received the booking (found by the live run; the page retries). notification-service:
  flight confirmation e-mail with PNR, flights and every ticket.
- Frontend (built in parallel by a second agent, verified by me): Flight Search form (autocomplete, trip type,
  passengers, cabin) on the home page and `/flights`, Results (filters in the URL, sort, compare up to 3), Details
  (itinerary, baggage, fare rules, countdown, price-changed acceptance), Passenger Details (saved passengers, child/infant
  ages, passport only for international trips), Review, flight views in Payment, Result, My Trips and Booking Details,
  Admin Flight Providers.
- **Exit checks green:**
  - *Flight saga tests incl. TIMEOUT / REJECT / price change*: flight-service `FlightBookingSagaIntegrationTest` (15) and
    booking-service `FlightBookingSagaIntegrationTest` (9): offer expired, travellers mismatch, sold out, fare changed,
    paid → issued once, REJECT → refund, TIMEOUT → found by reconciliation without a second order, TIMEOUTLOST → refunded after
    several looks, unknown for 2 h → needs attention, hold expiry, late payment (seats free / gone), release on failed
    bookings, duplicate and late events. `PRICECHANGE` is tested as a fare that rose (seat fill) at revalidate and at hold
    (deviation, see SUPPLIER_INTEGRATION.md §4.1).
  - *E2E flight booking*, live on the Docker stack (`e2e-flight-booking.mjs`, **39/40**; the one miss was my script
    expecting more than 2 flights on a sparse weekday, not a defect): autocomplete, round-trip search with a family,
    filters/sort/facets, international business search, revalidate, booking with coupon (idempotent), seats held at the
    revalidated total, no PNR before confirmation, payment, airline issues PNR + 4 tickets, invoice, e-mail, bell; **REJECT →
    REFUNDED**, **TIMEOUT → customer waits → CONFIRMED by reconciliation**. Browser run-through (Chromium): search results →
    choose outbound and return → trip details → passengers → review → payment → confirmation with PNR → booking details
    (tickets, payment, invoice, timeline).
- `mvnw verify` (run in a copy outside the IDE's reach, see below): **229 backend tests green** (common-lib 28, api-gateway 9,
  identity 40, hotel 38, flight 31 new, booking 28, payment 27, notification 22, reporting 6). `npm test`: **281 frontend tests
  green** (104 new in this phase); lint, type-check and build clean.
- **Environment finding:** while VS Code's Java extension has the project open it can overwrite
  `target/classes/**/SystemSettingMapperImpl.class` (and any MapStruct-generated class) with an Eclipse-compiled stub
  ("Unresolved compilation problems"), which makes reporting-service tests fail although the code is fine; Maven in a plain
  copy of the folder is green. If it happens: close the Java extension's build (setting `java.autobuild.enabled: false`) or
  build from a copy.
- Also found: after rebuilding a service the API gateway keeps the old container IP and answers 500 until it is restarted
  (`docker compose restart api-gateway`).
- Deviations: no Elasticsearch for flights (the timetable is queried directly), flights stored as a JSON snapshot instead of
  `flight_segments`, no airline logos, `cancelOrder` and flight cancellations wait for Phase 7, passport requirement for
  international trips is enforced by the page (the backend validates but does not require it), the admin Bookings/Payments pages
  still say Phase 9.

## Phase 7 — Cancellations, refunds and reconciliation ✅

Cancellation quotes and requests (hotel + flight), supplier/inventory cancellation, partial refunds, refund
webhooks, payment reconciliation job, audit trail. Frontend cancel flows; support agent booking actions.

**Exit checks:** cancellation/refund tests (fees, partial refunds, supplier rejection) · E2E cancel → refunded.

**Verified 2026-11-05**
- booking-service: `GET /api/bookings/{id}/cancellation-quote` and `POST /api/bookings/{id}/cancel` (`Idempotency-Key`,
  `expectedRefundAmount`), fees from the terms accepted at booking time (hotel: free period, then fee % of the stay price;
  flight: fee % of the fare, the airline's own fee is final), deadline `cancel_until` (check-in moment in the hotel's time
  zone / 4 h before the first departure), the cancellation saga with every refusal, partial refunds
  (`PARTIALLY_REFUNDED`), support lookup and actions (`/api/support/bookings`: search, escalate, resolve, retry refund),
  the "Needs attention" flag and internal support notes, reconciliation of unanswered cancellations and refunds, audit
  events. Details: BOOKING_WORKFLOW.md §4.1, API_DOCUMENTATION.md §8.4–8.5.
- hotel-service: cancels confirmed reservations before the check-in time and puts the **booked** rooms back on sale;
  `checkInAt` on the hold. flight-service: `cancelOrder` / `findCancellation` on the provider interface; the DEMO airline
  cancels at the fare family's fee, frees the sold seats, and simulates refusals and lost answers (`NOCANCEL`,
  `CANCELTIMEOUT`, `CANCELLOST`); unanswered cancellations are looked up, never sent twice; `departureAt` on the hold.
- payment-service: repeated refund requests get their final answer again, `refund.status-changed` live updates, audit
  events for every refund step. notification-service: "booking cancelled" and "cancellation not possible" e-mails and
  bell entries. reporting-service: **audit trail stored** (`audit_logs`) and `GET /api/admin/audit-logs` (the admin page
  stays in Phase 9).
- Frontend (built in parallel by a second agent from the API contract, verified by me): cancel page with the refund
  calculation, reasons and an explicit "I understand", the quote-changed flow (new figures, new key), a cancellation and
  refund section on booking details (live until refunded), "Cancel" in My Trips, new status labels; **Support portal**:
  Booking lookup, Needs attention queue, Booking assist (details, timeline, payments, attention, internal notes, cancel on
  behalf, escalate, resolve, retry refund, each shown only with the right permission).
- **Exit checks green:**
  - *Cancellation/refund tests*: booking-service `CancellationIntegrationTest` (12): free period → full refund (idempotent,
    repeated answers counted once, audit trail), fee after the free period with a **partial refund** and the coupon not
    refunded, non-refundable → cancelled without refund, quote changed → 409, not confirmed / too late / not the owner,
    **hotel refuses**, **airline fee final and a higher fee flagged**, **airline refuses or never answers**, support cancels on
    behalf, fee waiver (admin only), failed refund → admin retry, lookup/escalate/resolve, reconciliation. hotel-service +2
    (booked rooms back once; only confirmed and before check-in), flight-service `FlightCancellationIntegrationTest` (4: fee
    % of the fare and seats back, too late / not allowed, unanswered cancellation looked up, never-made cancellation
    reported), payment +repeated answers and audit, notification +1, reporting `AuditLogIntegrationTest`. Table in
    BOOKING_WORKFLOW.md §4.1.
  - *E2E cancel → refunded*, live on the Docker stack (`e2e-cancel-refund.mjs`, **48/48**): hotel in the free period →
    **REFUNDED** in full, room back on sale, e-mail and bell; hotel after the free period → cancelled, nothing refunded,
    stale quote refused; flight Flex fare → airline fee kept, **PARTIALLY_REFUNDED** (Payment History too); airline refuses →
    still confirmed, in the support queue, found by reference and PNR, resolved, e-mail; support agent needs a reason and
    cannot waive, admin waives → full refund; audit trail of booking, flight, payment and admin actions in
    `/api/admin/audit-logs`. Browser run-through (Chromium, Docker stack, 12/12): My Trips → Cancel → refund calculation →
    confirm only after "I understand" → details refresh live to Refunded with the hotel cancellation number; phone width
    without horizontal scrolling; support agent finds the booking and escalates it with an internal note the customer
    never sees. The only console messages were the expected 401 of the anonymous session check on a fresh login page.
- `mvnw verify` (run in a copy outside the IDE's reach, see Phase 6): **250 backend tests green** (common-lib 28, api-gateway
  9, identity 40, hotel 41, flight 35, booking 40, payment 27, notification 23, reporting 7). `npm test`: **321 frontend tests
  green** (40 new); lint, type-check and build clean. Migrations applied to the existing Docker data: older bookings got
  their cancellation deadline and the DEMO airline's older orders what was sold.
- Fixed on the way: room lists and quotes said "Free cancellation" for stays whose free period had already ended (check-in
  within the free-cancellation hours): the badge promised a refund the policy would not give. Per-stay terms now know the
  time (`PricingService` + clock) and say when the free period ended.
- Deviations: a refused cancellation flags the booking in the support "Needs attention" queue **instead of opening a
  support ticket** (tickets arrive in Phase 8); hotel-manager-initiated cancellations wait for the manager's reservations
  page (Phase 9; support/admin can cancel with the fee waived meanwhile); round trips with two fare families use the
  higher fee %; the hotel search card's "Free cancellation" flag is still per plan (the room list and quote are exact);
  the admin pages for refunds and audit logs are Phase 9 (the audit API exists).

## Phase 8 — Notifications and documents ✅

All notification types (§17), preferences, notification center (read/unread), PDFs (confirmation, e-ticket,
invoice, payment receipt, cancellation confirmation, refund receipt), local/S3 storage, secure downloads,
travel reminders, newsletter, support tickets (customer side).

**Exit checks:** PDF content tests · download access tests (owner OK, other customer 403) · email template tests.

**Verified 2026-11-05**
- notification-service: in-app notification and e-mail for every customer step (API_DOCUMENTATION.md §10 matrix:
  welcome, booking received, payment received/failed, confirmed, invoice ready, cancelled / not cancellable, refund
  started/completed/failed, travel reminder, ticket answered), preferences (category × channel, e-mails about bookings,
  payments and refunds locked on), Notification Center API (category filter, mark unread). **PDF documents** from the
  services' own events (hotel confirmation, flight itinerary, e-ticket with one page per traveller, tax invoice, payment
  receipt, cancellation confirmation, refund receipt) with one Thymeleaf layout and OpenHTMLtoPDF, embedded Noto Sans (₹),
  DEMO banner; made once per source (id derived from type + source), attached to the matching e-mails, downloaded only
  through `/api/documents` (owner or `BOOKING_READ_ANY`, `no-store`). A separate consumer group keeps the projections
  and documents and, started at the beginning of the topics, made the documents of last week's bookings too. Travel
  reminders 24 h before check-in / departure (`BookingConfirmed.startsAt`). Customer **support tickets** (open about
  an own booking, reply, close; one opened automatically for a refused cancellation). **Newsletter**: double opt-in,
  hashed confirmation tokens, HMAC-signed unsubscribe links, account toggle.
- common-lib: `FileStorage.put` (deterministic keys) and **`S3FileStorage`** (private bucket, SSE, `travel.storage.type=s3`,
  JDK HTTP client), tested against an S3-compatible server. booking-service: `starts_at` + `BookingConfirmed.startsAt`
  (`V5`); payment-service: `InvoiceIssued` carries the invoice lines.
- Frontend (built in parallel by a second agent from the API contract, verified by me): Notification Center
  (`/account/notifications`) and settings (switch grid, locked items, newsletter), Documents card on booking details,
  downloads from My Trips and Payment History (authenticated blob download, file name from `Content-Disposition`),
  support tickets (`/account/support`: list, new from a booking, conversation, close), Help & Support and Contact pages,
  newsletter in the footer with confirm/unsubscribe pages (unsubscribe needs a click).
- **Exit checks green:**
  - *PDF content tests*: `DocumentIntegrationTest` (4) parses every document type with PDFBox (references, hotel and flight
    details, ticket numbers per page, amounts with ₹, discount, policy, DEMO banner, invoice lines, receipts).
  - *Download access tests*: owner `200` (PDF, attachment, `no-store`, `nosniff`), another customer `404` and an empty list,
    staff `200`, no login `401`. **Deviation from the exit check text:** someone else's document answers `404`, not `403`,
    like every owned resource in this project (SECURITY_GUIDE §9b: never reveal that it exists).
  - *E-mail template tests*: Mailpit checks of the booking-received, payment-received (+ receipt), payment-failed,
    confirmation (+ PDFs), cancellation (+ PDF), refund, reminder, newsletter confirmation/welcome e-mails.
- Live on the Docker stack (`e2e-notifications-documents.mjs`, **33/33**): welcome, booking received, payment received with
  the receipt, confirmation with the PDF, receipt/confirmation/invoice downloads and the access rules, cancellation and
  refund PDFs and e-mails, flight itinerary + e-ticket attached, preferences (locked e-mail refused) and newsletter,
  category filter and mark unread, tickets (own booking only, closed ticket refuses replies, automatic ticket for a refused
  cancellation), public newsletter double opt-in and forged unsubscribe link refused. The new document consumer group
  backfilled all 11 bookings confirmed in the last week. Browser run-through (Chromium, 15/15): documents card and download
  with the right file name, Notification Center and mark-all-read, settings (reminder e-mails off, locked items),
  ticket from a booking, reply and close, Help page, footer newsletter and confirmation link, phone width on four pages.
- `mvnw verify` (in a copy, see Phase 6): **263 backend tests green** (common-lib 30, api-gateway 9, identity 40, hotel 41,
  flight 35, booking 40, payment 27, notification 34, reporting 7). `npm test`: **418 frontend tests green** (97 new); lint,
  type-check and build clean.
- Fixed on the way: a new consumer group replays the topic, so last week's verified users would have received a late
  "Welcome" → only verifications of the last 24 h are welcomed; PDFBox warned five times per PDF about standard fonts the
  documents never use (log level set to ERROR); `notifications.source_event_id` widened for derived notifications.
- Deviations: schedule-change messages are not built (the DEMO airline has none); no toast for new notifications and no
  "new updates" banner (lists refresh in place); the agent side of tickets and the admin pages for documents and
  newsletters are Phase 9; SMS is not a channel; the travel preferences' old `newsletterOptIn` flag is no longer shown (the
  subscription lives in notification-service). Observed during the browser run: the gateway rate-limits rapid repeated
  realtime connections of one user (two `429`s when the test reloaded pages several times a second); the client reconnects
  with backoff.

## Phase 9 — Admin, hotel manager and support portals; reporting ✅

Reporting read models, admin dashboard (all §20 metrics, all date filters), reports with pagination, sorting,
search, CSV/PDF export; user, booking, payment, refund, coupon/offer, review moderation, support management;
audit logs; system settings. Hotel manager dashboard, reservations, guests, check-in/out, reports.
Support agent portal. Home page dynamic sections (popular destinations, recommended hotels, routes, reviews).

**Exit checks:** report totals match booking/payment data (consistency test) · role-based navigation tests.

**Verified 2026-11-06** (API_DOCUMENTATION.md §14, with "As built" notes)

**reporting-service** (read models from events)
- **Facts.** `booking_facts`, `payment_facts`, `refund_facts`, `cancellation_facts` and `user_facts` are written by
  idempotent upserts. A replayed, redelivered or out-of-order event changes nothing it should not. Each topic has its
  own consumer group.
- **Snapshots.** booking-service publishes a `BookingSnapshot` with every change (one per transaction, just before
  commit) and once for every existing booking. identity-service publishes a `UserSnapshot` once per account. Both
  start-up backfills are guarded by a locked `data_backfills` row.
- **Dashboard.** Every §20 figure for the 7 date presets and custom ranges (India days, at most 366):
  - customers, bookings by status, pending and successful payments;
  - gross, refunds and net;
  - popular destinations and top hotels;
  - booking and revenue trends;
  - recent bookings and activity.
  `dashboard.updated` reaches admins at most once per 10 s.
- **Reports.** Bookings, revenue, payments, refunds, cancellations, destinations and customers. Each has search,
  filters, sorting, paging and totals over all rows. Exports: CSV (BOM, formula-safe, at most 10,000 rows) and PDF
  (A4 table with Noto Sans).
- **Public.** Popular destinations and routes (last 90 days).

**booking-service**
- Admin booking search with dates and sorting.
- **Goodwill refunds:** `REFUND_MANAGE` and an Idempotency-Key, never more than is still refundable. A later
  cancellation works on what is left.
- Coupon admin and offers: public `/api/offers`, three demo offers.
- **The hotel cancels:** no fee, full refund, idempotent. The customer gets "The hotel cancelled your stay" by bell,
  e-mail and PDF.
- Check-out completes the booking at once.

**payment-service:** admin payment and refund lists, and the payment details with its refunds.

**hotel-service** (built by a second agent)
- **Reviews:** eligibility only for completed own stays; moderation with reports; hotel rating = seeded figures +
  approved reviews, reindexed in Elasticsearch; public and featured lists.
- **Front desk:** check-in, check-out, no-show and the hotel's own cancellation, with hotel-time date rules. Each sends
  an event and a live update.
- **Manager reports:** dashboard, occupancy and revenue per night with CSV.
- Admin occupancy across hotels and public recommended hotels.

**notification-service:** the agents' ticket queue (filters, summary, assign, status, audit). An agent's reply
e-mails the customer a link to the ticket.

**Frontend** (two agents in parallel, verified by me)
- **Admin portal:** dashboard with SVG charts and the range picker; users; bookings with goodwill refund; payments;
  refunds; coupons; offers; review moderation; support queue; reports with CSV/PDF downloads; audit logs; settings.
  Navigation and actions follow permissions.
- **Hotel manager portal:** the dashboard is a hotel's first page; reservations; guest details with check-in, check-out,
  no-show and cancel; reviews; reports with a chart and CSV.
- **Support portal:** dashboard, ticket queue, agent conversation, escalations.
- **Customer pages:** write a review, My reviews, reviews on the hotel page.
- **Public pages:** home page sections (offers, popular destinations with a fallback to the hotel cities, recommended
  hotels, popular routes with labelled suggestions, guest reviews, recent searches on this device, FAQ); Offers page;
  About page.

**Exit checks green**
- **Consistency test:** `ReportConsistencyIntegrationTest` feeds a known month of bookings, payments, failed payments,
  duplicate payments, refunds (some answered before they were requested) and cancellations. Snapshots are replayed late,
  events redelivered, and there are bookings just outside the range. Every dashboard figure and every report total
  equals the figure calculated directly from that source data, and the reports agree with each other (revenue report =
  dashboard, destinations = paid bookings, pages add up to the totals).
  - Live on the Docker stack, for the last 30 days, the dashboard matches the services' own admin APIs:
    - gross = captured payments in payment-service;
    - refunds = processed refunds;
    - bookings count, amounts and refunded amounts = booking-service;
    - pending payments, customers = identity accounts with the CUSTOMER role.
- **Role-based navigation tests:** `roleNavigation.test.tsx` (27 tests). For CUSTOMER, ADMIN, HOTEL_MANAGER and
  SUPPORT_AGENT, it checks the portal links in the user menu and access to `/admin…`, `/hotel-manager…`, `/support…`
  and `/account…` (allowed or "no access"; logged out → login), using the real route table.
  - Live: customer, support agent and manager get `403` on the admin APIs and "You don't have access to this page" in
    the browser.

**Other checks**
- **Live E2E** (`e2e-portals-reporting.mjs`, **77/77**): goodwill refund and its limits; the report totals above;
  coupon and offer shown and hidden; manager search, `NOT_CHECK_IN_DAY`, `HOTEL_NOT_ASSIGNED`, hotel cancellation with
  full refund, e-mail and report; a stay today checked in and out → completed → reviewed → approved → rating and
  featured; agent queue, assignment, reply e-mail, escalation; public endpoints without login; ten permission checks.
- **Browser run-through** (Chromium, **41/41**):
  - admin dashboard (range kept in the URL), report with CSV and PDF downloads, ten admin pages with their data;
  - manager dashboard, reservations and reports; support dashboard and queue;
  - home page sections, Offers, About, hotel reviews, My reviews;
  - "no access" for three roles, phone width on seven pages.
- **Test counts:**
  - `mvnw verify` (in a copy): **305 backend tests green** (common-lib 30, api-gateway 9, identity 41, hotel 64,
    flight 35, booking 49, payment 28, notification 36, reporting 13).
  - `npm test`: **687 frontend tests green** (269 new). Lint, type-check and build are clean.

**Fixed on the way**
- **Phone widths:**
  - a screen-reader-only table header escaped its scroll box (table wrappers are now `relative`);
  - dashboard charts did not shrink in the grid;
  - the header's "Reconnecting…" label made phone pages 28 px too wide (on phones the dot shows, and the words stay
    for screen readers).
- **Labels:** booking pages showed "GOODWILL" and the hotel as initiator without labels.

**Deviations**
- No-shows send no event: the booking stays confirmed until the nightly job completes it.
- Reporting rebuilds only what Kafka still keeps (7 days locally) plus the booking and account snapshots. Older
  payment, refund and cancellation history is not rebuilt (production note in PROJECT_ARCHITECTURE.md §12).
- The nightly consistency job of DATABASE_DESIGN §8 is not built (the test and the E2E check instead).
- No review photos (`reviews.photos.enabled=false`).
- Hotel dashboards refresh on `hotel.reservation-changed`, not `dashboard.updated`.
- No "new updates available" banner (lists refresh in place).
- The support booking lookup moved to `/support/bookings` (`/support` is the agent dashboard).
- The existing Hotels and Flight providers admin pages hide their nav links by permission but are not gated
  themselves.

## Phase 10 — Testing and quality ✅

Close test gaps, Playwright E2E for both full journeys (§30), security checks (dependency scan, auth/permission
review, upload/download checks), basic load test of search and booking endpoints, accessibility check, bug fixing.
Docs: TESTING_GUIDE.md.

**Verified 2026-11-06** (how to run everything: TESTING_GUIDE.md)

**Test gaps closed**
- **Backend: 308 → 390 tests.** New fast unit tests:
  - the cancellation policy;
  - every one of the 144 transitions of the booking state diagram;
  - coupons, report ranges and CSV/PDF export;
  - payment signatures.
- **Supplier tests:**
  - the Razorpay adapter against a local HTTP server (amounts, auth, error mapping, timeouts as unknown outcomes);
  - the DEMO airline as the sandbox: all-or-nothing holds, one order per key, cancelling twice.
- **Repository tests:** refund sums, seasonal rate overlaps, coupon search.
- **Webhooks:** the same webhook delivered 6 times at once is applied once.
- **`EndpointSecurityTest` in all 7 services:**
  - every endpoint answers 401 without a token, except a written public list;
  - every staff endpoint answers 403 to each role without the permission.
  - It sends valid bodies, because the body is validated before `@PreAuthorize`. Helpers are in the new
    `platform/test-support`.
- **JaCoCo:** a report per module plus `platform/coverage-report`. All modules together: **92.9 % of lines,
  74.2 % of branches** (reported, not enforced).
- **Frontend: 687 → 938 tests.** New pages and components covered:
  - profile, security, admin hotels, the manager's hotel profile, photos, rooms and calendar;
  - hotel search, quote and filters;
  - layout, form fields, status pages, session store, API contracts (Idempotency-Key headers) and the router.
- **Frontend coverage:** lines 78.8 % → 92.0 %, branches 74.9 % → 87.2 %.

**Playwright E2E (exit of §30):** `frontend/e2e`, `npm run test:e2e`, against the Docker stack.
- The flight and the hotel journey each go through all 10 steps of §30, only through the UI:
  - register, verify by the Mailpit link and log in;
  - search, select, enter traveller details;
  - DEMO payment, confirmed by the provider;
  - My Trips, the confirmation PDF (checked to be a real PDF);
  - cancel, then the final refunded state.
- Green 4 times in a row during development, and again on the final images: **32 passed in 1.6 min**.

**Accessibility:** 31 axe scans (WCAG 2.1 A/AA) of public, customer, admin, manager and support pages, 5 of them at
phone width.
- Before: every signed-in page had a serious violation:
  - button names that did not match the visible text (account menu, notification bell, support tiles);
  - low contrast in the admin menu and the notification panel.
- After: **0 violations of any severity**.

**Security**
- **Endpoint matrix** (`tests/security/endpoints.mjs`) over all **159 operations**: every non-public one answers
  `401` without a token, and every role outside its staff area gets `403`.
- **New: `gateway.role-paths`.** Customers used to get `400` with field errors from staff endpoints (the body is
  validated before the permission check). Now the gateway answers `403` first.
- **Live checks:** `checks.mjs` **81/81**, `auth-extra.mjs` **19/19** (TESTING_GUIDE.md §7).
  - Customer data: another customer's bookings, documents, payments, tickets, passengers and notifications → `404`.
  - Tokens: forged and `alg: none` tokens → `401`; logout revokes the token; refresh-token reuse ends the session.
  - Login: lockout after 5 failures; no account enumeration.
  - Uploads: disguised files → `422`, too large → `413`, images re-encoded.
  - Downloads: `attachment`, `no-store`, `nosniff`.
  - Injection → `4xx`, never `5xx`.
  - HTML stays text in e-mails.
  - Headers set, actuator closed, passports encrypted.
- **Logs** (`logscan.mjs`, after all test traffic): no secret, token, password, passport, signature or e-mail-link
  token in any container log.
- **Dependencies:**
  - `npm audit`: 0. A `minimatch` override, for the lint toolchain only.
  - Trivy before: HIGH/CRITICAL in every image.
    - Backend: `apt`, `lz4-java`, `snappy-java`, `guava`.
    - Frontend: `brotli` (critical), `curl`, `libexpat`.
    - One MEDIUM: OpenTelemetry.
  - Trivy after: **0 findings with a fix available, at any severity**.
    - Fixed with version pins in the root `pom.xml` (`opentelemetry.version` 1.67.0) and OS security updates in both
      Dockerfiles.
  - gitleaks: no secrets in the source.

**Load test** (`tests/load/search-and-booking.js`, k6, inside the Compose network, 51 virtual users, 2 min 45 s)
- **Search:** 30 users, 2,340 requests, **0 errors**. p95: hotel search 26 ms, rooms 21 ms, flight search 18 ms.
- **Booking:** 6 users booked hotels and flights end to end.
  - **223 of 223 confirmed.**
  - Create booking p95 84 ms, create order p95 26 ms.
  - Booking to `CONFIRMED` (Kafka saga + payment + supplier): p95 2.7 s.
- **Last rooms:** 15 users at once for 3 rooms → **exactly 3 holds**, 12 clean refusals, 0 errors.
- **Whole run:** 0 of 5,488 requests failed.

**Bugs fixed**
1. **Amounts of ₹1 lakh and more** were grouped the Western way in e-mails, booking PDFs and report PDFs ("₹200,000").
   - The cause: `DecimalFormat` has one grouping size.
   - The fix: `IndianDigits` writes "₹2,00,000" like the web app.
2. **Flight result filters** briefly jumped back after a click (the URL update ran as a transition). Fixed with
   `flushSync`, as the hotel search already did.
3. **Accessibility:** the screen-reader name of the account menu, notification bell and support tiles; text contrast;
   the unread dot was not announced.
4. **Realtime:** one booking update refetched the open booking twice (each matching key was invalidated separately).
   Now one invalidation.
5. **nginx** wrote `/verify-email?token=…` and `/reset-password?token=…` (also in the `Referer` of the page's asset
   requests) to its access log. The log now drops query strings.
6. **Customers saw validation details of staff endpoints.** The gateway now answers `403` (see above).
7. **Vulnerable libraries and OS packages** (see above).
8. **Tests only:**
   - a date-dependent flight search test (the demo timetable has flights that do not run every day);
   - toasts leaking from one frontend test into the next.

**Deviations**
- **No real flight supplier adapter exists yet** (only DEMO), so it has no HTTP-mock test. The DEMO contract test is
  the sandbox test. The Razorpay adapter test shows the pattern for a real one.
- **No `@WebMvcTest` / `@DataJpaTest` slices:** the full-stack MockMvc tests and the shared-context repository tests
  cover the same ground without extra start-up cost.
- **Coverage** is reported, not enforced (no thresholds).
- **The load test is basic:** one developer machine, about 21 requests/s. It proves correctness and responsiveness
  under concurrent use, not production capacity (Phase 11 / AWS).
- **Trivy:** about 20 MEDIUM/LOW Ubuntu advisories per backend image have no fix yet. Re-scan before each release.
- **Not changed (security guide rule 9):** the seeded but unchecked permissions (`USER_READ_ANY`, `AUDIT_VIEW`,
  `SETTINGS_MANAGE`, `FLIGHT_PROVIDER_MANAGE`). Those endpoints require `ADMIN`, which is stricter.
- **Test data:** every E2E, security and load run adds `@example.com` customers and their bookings to the local
  database. The load test's "last rooms" night (250–330 days ahead) keeps 3 rooms on sale.

## Phase 11 — UI redesign, role sign-in, analytics and AI assistant ✅

Requested 2026-11-06, to be built without waiting for approval:
- a complete, modern, animated and responsive redesign;
- separate sign-in pages and dashboards per role;
- dashboards with real analytics;
- an AI chatbot with voice: frontend → MCP client service → MCP server service → API gateway → services, with a
  local LLM on Ollama.

Manual testing on the local stack follows this phase. Deployment (Phase 12) stays on hold.

### 11.1 Design system v2
- **No new UI framework.** Tailwind 4 tokens, plus:
  - **charts:** recharts, which is already a dependency;
  - **font:** one self-hosted variable font (`@fontsource-variable/plus-jakarta-sans`; CSP `font-src 'self'` is
    unchanged);
  - **illustrations:** inline SVG React components, so there are no external images;
  - **animations:** CSS only (keyframes, transitions, scroll reveal with IntersectionObserver), all switched off under
    `prefers-reduced-motion`.
- **Look:**
  - deep ocean-blue brand with a warm sunset accent, a soft sky gradient and illustrated hero scenes;
  - rounded-2xl cards with layered soft shadows, and a glassy sticky header;
  - staff portals: a sidebar layout with a role accent colour (admin indigo, hotel manager teal, support violet);
  - light theme only.
- **Rules that stay:**
  - WCAG 2.1 AA (axe: 0 serious or critical);
  - no horizontal scroll at 390 px;
  - labels, error messages and the e2e journeys keep working;
  - no hard-coded statistics anywhere.

### 11.2 Sign-in per role
| Role | Sign-in | After sign-in | Area |
|------|---------|---------------|------|
| Customer | `/customer/login` (`/login` redirects here, so e-mail links keep working) | `/customer/dashboard` (new) | existing customer pages (`/my-trips`, `/account`, …) |
| Admin | `/admin/login` | `/admin` | `/admin/**` |
| Hotel manager | `/hotel-manager/login` | `/hotel-manager` | `/hotel-manager/**` |
| Support agent | `/support/login` | `/support` | `/support/**` |

- **Not signed in on a protected page:** go to that area's sign-in with `?redirect=`.
- **Signed in with another role:** an access-denied page with a link to the right sign-in and to the user's own
  dashboard.
- **Backend:** `POST /api/auth/login` takes an optional `portal` (`CUSTOMER | ADMIN | HOTEL_MANAGER | SUPPORT`).
  - A user without a matching role gets `403 PORTAL_NOT_ALLOWED`: no tokens, no cookie, no failed-attempt count, but an
    audit entry.
  - Admins may also use the hotel manager and support sign-ins, because they hold those permissions (as in
    `gateway.role-paths`).
  - Register, forgot password, reset password and the staff invitation keep their pages. The invitation sends staff to
    their own area's sign-in.

### 11.3 Analytics (real data only)
- **Admin dashboard v2** (reporting-service):
  - hotel and flight bookings and revenue, separately and together;
  - DAY, WEEK, MONTH and YEAR intervals, with yearly ranges;
  - the change against the previous period (up or down, %);
  - successful and failed payments (count and amount);
  - cancellations by type and the cancellation rate;
  - registered and new customers.
- **Customer dashboard:** `GET /api/bookings/summary` (booking-service, own bookings only):
  - hotel and flight bookings;
  - upcoming, completed and cancelled trips;
  - spending (paid, refunded, net) and monthly activity;
  - the next trip.
- **Hotel manager:** occupancy, ADR / RevPAR, arrivals and departures, revenue trend, cancellations, rating, for the
  assigned hotels.
- **Support:** tickets by status, ticket age, opened vs resolved over time.
- Every new figure gets a consistency test against its source data, like `ReportConsistencyIntegrationTest`.

### 11.4 AI assistant (chat and voice)
```
Browser chat ──► gateway /api/assistant/** ──► mcp-client-service :8108 ──MCP (Streamable HTTP)──► mcp-server-service :8109
                                                     │  Spring AI ChatClient + Ollama              │  MCP tools (read-only,
                                                     │  conversation memory (Redis, 24 h)         │  per role) ──► gateway ──► services
                                                     └──► Ollama (ollama/ollama, default start)   └─ never routed by the gateway
```
- **Identity:** the user's own JWT travels the whole way. The MCP server calls the gateway with it, so every existing
  rule applies, including ownership (`404` for someone else's booking) and permissions.
  - The MCP client authenticates to the MCP server with an internal key (`MCP_SERVER_API_KEY`, `.env`).
  - The MCP server is reachable only inside the Docker network.
- **Tools** are read-only and offered by role:
  - customer: my bookings and trip details, cancellation quote, payments, tickets, notifications, hotel and flight
    search, offers;
  - admin: dashboard figures, booking, payment and refund search, reports;
  - hotel manager: own hotels' dashboard, arrivals and reservations, occupancy;
  - support: ticket queue, booking lookup.
  - Changes (cancel, pay, refund) stay in the UI with its confirmation steps.
- **No invented data:**
  - The system prompt says to answer application facts only from tool results, and to say so when there is no data.
  - A grounding check replaces any answer that names a booking reference, ticket number or amount not present in this
    conversation's tool results.
  - Answers list the sources (which tools were used).
- **Model:** Ollama in Docker Compose (default start, volume for models, an init step that pulls the model).
  - Settings come from environment variables: `OLLAMA_BASE_URL`, `ASSISTANT_CHAT_MODEL`, `ASSISTANT_NUM_CTX`,
    `ASSISTANT_TEMPERATURE`.
  - The machine has a 6-core CPU and no GPU, so the candidates are small tool-calling models. They are compared by a
    repeatable evaluation (tool-choice accuracy, argument accuracy, answer quality, latency, memory), and the results
    are recorded in AI_ASSISTANT.md.
- **Voice:**
  - Speech-to-text and text-to-speech come from a local OpenAI-compatible speech server (profile `voice`), proxied by
    mcp-client with size and type limits.
  - Without it, the browser's speech APIs are used where available.
  - Settings: `ASSISTANT_STT_URL`, `ASSISTANT_STT_MODEL`, `ASSISTANT_TTS_URL`, `ASSISTANT_TTS_MODEL`,
    `ASSISTANT_TTS_VOICE`.
- **Limits:** only for signed-in users. A stricter gateway rate limit applies. There are timeouts and retries on every
  hop, and no message text or tool results in the logs.
- **API** (mcp-client, through the gateway):
  - `GET /api/assistant/config` → `{ enabled, model, voice: { transcription, speech } }`
  - `POST /api/assistant/chat` `{ conversationId?, message }` → `text/event-stream`, with these events:
    - `conversation {id}`
    - `status {text, tool}`
    - `delta {text}`
    - `done {messageId, sources:[{tool,label}]}`
    - `error {code, message}`
  - `GET /api/assistant/conversations/{id}` → messages; `DELETE /api/assistant/conversations/{id}`
  - `POST /api/assistant/voice/transcriptions` (multipart `file`) → `{ text }`
  - `POST /api/assistant/voice/speech` `{ text }` → audio

### 11.5 Work plan
1. **Wave 1, in parallel:**
   - frontend foundation: the design system, components, illustrations, layouts, sign-in pages, routes and guards,
     and the chart kit;
   - backend analytics and the `portal` sign-in;
   - the AI backend: two services, Ollama, the voice server, model evaluation and the gateway route.
2. **Wave 2, in parallel:**
   - public and customer pages, including the customer dashboard;
   - the admin, hotel manager and support portals, including their dashboards;
   - the chat and voice UI.
3. **Integration:** rebuild everything, run every test suite, walk every journey and role, then update the docs
   (AI_ASSISTANT.md is new; TESTING_GUIDE, API and SECURITY guides are extended).

**Exit checks:**
- **Sign-in:** each role signs in at its own page, and a wrong role is refused (API and UI). Deep links lead to the
  right sign-in.
- **Dashboard figures** equal their source data (consistency tests).
- **Assistant:**
  - answers from real data;
  - doesn't invent;
  - customer A cannot reach customer B's data through it;
  - staff tools only for staff;
  - a downstream failure gives a clear message;
  - voice works with the voice profile and falls back without it.
- **Everything still passes:** backend tests, frontend tests, Playwright journeys (updated), axe 0 serious/critical,
  and phone width.

### 11.6 Verified 2026-11-06

How to run everything: TESTING_GUIDE.md (sections 3–8). The model evaluation and the assistant's design:
AI_ASSISTANT.md. The design system: `frontend/DESIGN_SYSTEM.md`.

**What was built**
- **Design system v2** (`frontend/DESIGN_SYSTEM.md`):
  - tokens with a role accent per portal;
  - one self-hosted font;
  - 16 inline SVG illustrations;
  - CSS-only motion, switched off under reduced motion;
  - new primitives: StatCard with change chips, DataTable, Tabs, Tooltip, Stepper, PageHeader;
  - a lazy chart kit on recharts, where every chart has a legend, tooltips, a screen-reader summary and a "show as
    table" view.
- **Every page redesigned:**
  - public and customer pages;
  - the booking flow;
  - account, tickets and notifications;
  - all admin, hotel manager and support pages;
  - staff portals in a collapsible sidebar shell with a phone drawer.
- **Sign-in per role:**
  - `/customer/login`, `/admin/login`, `/hotel-manager/login` and `/support/login`;
  - `/login` redirects to the customer sign-in;
  - an access-denied page for the wrong role;
  - `403 PORTAL_NOT_ALLOWED` from identity-service;
  - staff invitations link to their own sign-in.
- **Dashboards on real data:**
  - admin v2: DAY, WEEK, MONTH and YEAR, hotel vs flight, failed payments, cancellations, customers, and growth against
    the previous period;
  - the new customer dashboard (`GET /api/bookings/summary`);
  - hotel manager v2: today, occupancy, ADR, RevPAR, ratings and trends, plus a portfolio page;
  - new support metrics.
- **AI assistant:**
  - `mcp-client-service` (Spring AI 2.0.2, Ollama, Redis memory, grounding check, SSE, voice proxy);
  - `mcp-server-service` (25 read-only tools per role, called with the user's own JWT through the gateway);
  - Ollama with `granite4:tiny-h`, chosen by a 30-case evaluation of 7 models on this CPU;
  - an optional local speech server (profile `voice`);
  - the chat panel with voice in every portal.

**Tests**
- **Backend: 390 → 515 tests, 0 failures** (`mvnw clean verify` in a fresh copy, 11:44 min).
  - Consistency tests check every new dashboard figure against its source data.
  - `PortalSignInIntegrationTest` covers sign-in per portal.
  - The assistant has 87 tests: the grounding check, token propagation (24 parallel calls keep their own token), tool
    filtering per role, error mapping, SSE and voice.
  - `GatewayRateLimitIntegrationTest` runs against a real Redis.
  - Coverage, all modules: **90.5 % of lines, 73.3 % of branches** (was 92.9 % / 74.2 %; `mcp-server-service`'s
    tool classes are at 66.9 %).
- **Frontend: 938 → 1,233 tests** (117 files).
  - Coverage: 91.2 % of lines, 86.3 % of branches.
  - Type-check, lint (0 warnings) and build are clean.
- **Playwright on the final images** (`http://localhost:3000`): **72 passed, 1 skipped** in 4.6 min.
  - The specs: the two full journeys, the customer dashboard, staff portals (18), the assistant (8) and accessibility
    (44).
  - The skipped test is the voice round trip, which needs the `voice` profile. With the profile running,
    `assistant.spec.ts` passed **8/8**, including a spoken question transcribed and answered aloud.
  - The dashboard specs read the same API with the page's session and compare 3–8 figures per portal with the screen,
    so no figure can be hard-coded.
- **Accessibility:** 0 axe violations of any impact on every scanned page (sign-in pages, dashboards, list pages and
  the open assistant panel), at desktop and 390 px. No horizontal scroll at phone width.

**Security and quality**
- **Endpoint matrix:** 167 operations in 8 services. Every non-public one answers `401`, and every role outside its staff
  area gets `403`.
- **Live checks:** `checks.mjs` 81/81, `auth-extra.mjs` 19/19.
- **Assistant live checks** (`tests/assistant/live-checks.mjs`, real model): **20/20**.
  - Customer B asking for customer A's booking gets "not found" and none of A's data.
  - A made-up reference gets "not found", with nothing invented.
  - A prompt-injection attempt uses no tools and gets no data.
  - The admin, hotel manager and support figures equal the API.
  - Answers take 5–20 s on this CPU.
- **Logs:** no secrets, tokens, personal data or conversation content in any of the 13 containers, after all test
  traffic.
- **Dependencies and secrets:**
  - `npm audit`: 0.
  - Trivy: **0 findings with a fix available, including MEDIUM, in all 11 of our images**.
  - gitleaks: only the expected findings (`.env`, test fixtures, `target/`).
- **Load test:** 51 users, 2 min 45 s, 0 of 5,252 requests failed.
  - Search: 2,334 requests, p95 ≤ 42 ms.
  - Bookings: 199/199 confirmed, p95 3.0 s to `CONFIRMED`.
  - Last rooms: exactly 3 holds out of 15.

**Bugs fixed**
1. **Gateway rate limits were charged twice** on routes with a limit of their own (login, realtime, assistant). The
   default filter also ran there, with the route's settings and on the same Redis bucket. The result: a login burst of
   5 instead of 10, and one assistant question, then `429`.
   - The fix: those routes are marked `own-rate-limit: true`, and the default limit steps aside there.
   - `GatewayRateLimitIntegrationTest`: 4 of its 6 tests fail with the old configuration.
2. **The wrong-portal message** read a field identity-service does not send (`details.portals`), so it never linked
   the account's own sign-in page.
3. **Illustrations** ignored size classes and stretched to full width: every empty state, error page, 404 and access
   denied.
4. **Dialogs** ignored a wider `max-w-*` from the page (the admin offer editor). The cause is that `cn` does not merge
   Tailwind classes; that is now documented in DESIGN_SYSTEM.md.
5. **The staff top bar's live dot** was meant to be hidden on phones but showed.
6. **`AnimatedNumber`** could briefly show a negative amount.
7. **Screen-reader names:** the support tiles read "Open : 4", and the fare countdown was announced every second.
8. **The assistant, found in live tests:**
   - arrivals and departures were mixed up;
   - "free cancellation until …" was offered for non-refundable rates;
   - a made-up link appeared in an answer;
   - typographic hyphens could hide a booking reference from the grounding check.
9. **Development and test setup:**
   - Playwright output made Vite reload every open dev page;
   - the frontend Docker build context could include test output;
   - zod's eval probe caused a CSP report on every page with a form;
   - an e2e race read a heading before the lazy page rendered.

**Deviations**
- **Ollama runs in the default start**, not in a profile `ai`: the assistant is part of the app. Docker Desktop needs
  at least 16 GB (20 GB recommended, 22 GB with voice). Voice stays optional (profile `voice`).
- **Speed:** CPU only, one question at a time. Answers take about 5–20 s, and much longer while builds or tests use
  the CPU.
- **The grounding check** covers booking references, ticket numbers and amounts, not dates, statuses or names. Those
  rely on the read-only tool design and the prompt.
- **No server endpoints for two views:**
  - the customer summary has no comparison block, so the UI fetches the previous period itself;
  - the hotel manager portfolio calls each hotel's dashboard (at most two at a time).
- **Failed-payment amounts** use the booking's total; the payment-failed event carries no amount.
- **Third-party images** are not patched. Trivy finds fixable issues in `ollama/ollama:0.40.14` (2 HIGH, `apt`) and in
  `speaches:0.8.3-cpu` (9 HIGH OS packages; 74 in Python libraries, 8 of them CRITICAL). The speech server is optional
  and only reachable from mcp-client-service inside the Docker network. Update both before any deployment.
- **Unexplained test failures:**
  - One of four frontend coverage runs had 2 failures that did not repeat. They were likely timeouts under load, and
    the run's output was not kept, so the tests are not known.
  - A hotel manager unit test once timed out under heavy load.
- **Disk:** the evaluation left about 21 GB of candidate models in the `ollama-models` volume. AI_ASSISTANT.md says
  how to remove all but the default.
- **Test data:** the runs added more `@example.com` customers, bookings and tickets to the local database.

### 11.7 Follow-up: modern date, time and choice controls (2026-11-06)

Asked for after Phase 11: the date picker, time picker, dropdowns and other controls should look and feel modern.
Details are in `frontend/DESIGN_SYSTEM.md` §3, *Form controls*.

- **`DateField`** replaces every `<input type="date">` (35 fields in 18 files; none are left).
  - It shows "Sat, 12 Dec 2026", can be typed (day first, ISO or spelled out) and has a styled calendar (react-day-picker,
    already a dependency, now used).
  - The calendar has keyboard support, month/year menus for far-off dates, "Today"/"Clear" and struck-through days
    outside `min`/`max`.
  - Ranges are shaded: two months for hotel and flight dates; From/To pairs on every filter.
  - The calendar is a separate 16 KB (gzip) chunk loaded on first use, so the main bundle grew by only about 2 KB gzip.
- **`TimeField`** replaces the two `<input type="time">` (hotel check-in and check-out times): suggested half hours,
  each also in 12-hour form, or typed.
- **Selects stay native:** our closed look in every browser, plus our open list in Chrome and Edge (`appearance:
  base-select`). Forms, phones, keyboard and tests behave as before. Firefox and Safari keep their own open list.
- **Checkboxes and radios** are drawn in the portal colour.
- **Destination suggestions** on the hotel search are a styled list instead of the browser's `datalist`.
- **Hotel search:** check-out can no longer be on or before check-in, and moving check-in past check-out moves
  check-out to the next day.
- **Fixed on the way:**
  - The calendar's day names now start with the visible number (axe, label in name).
  - Days of the neighbouring month got 4.5:1 contrast.
  - Width and padding overrides on selects did not apply (`cn` does not merge Tailwind classes); `selectClass()` has
    size options instead.
  - Filter grids that left date fields under 190 px were widened.
- **Tested:**
  - Frontend: 1,295 tests (was 1,233; 122 files). Type check, lint and build are clean.
  - New `e2e/pickers.spec.ts` (3 tests): the calendar in the top layer, mouse, keyboard and typing, range shading,
    `base-select` on the selects, suggestions, phone width, and axe with the calendar open.
  - On the rebuilt Docker frontend: **68 passed** in 3.1 min (journeys, customer dashboard, staff portals 18,
    accessibility 44, pickers 3), with 0 axe violations. The assistant spec was not re-run; it was not changed.
  - Visually checked in Chromium on the gallery, the admin bookings, coupons and support pages, and the hotel manager
    profile, inventory and reservations pages, at desktop and 390 px.
- **Open:**
  - Coverage was not re-measured.
  - Once, on the Vite dev server, a coupon-dialog calendar closed straight after opening, with focus back on the first
    field. Five reruns on the dev server did not repeat it, and the cause is not known. The e2e suite does not open
    that dialog's calendar.

### 11.8 Follow-up: table pagination and the assistant's window (2026-11-06)

Asked for after 11.7:
- modern pagination on every table;
- the assistant's floating button must never cover pagination;
- a redesigned chat window with minimize and maximize, its normal width 25 % larger.

Details are in `frontend/DESIGN_SYSTEM.md` §3 (`Pagination`) and §11.

- **`Pagination`** (`src/components/ui/Pagination.tsx`) replaces the admin `Pager` and seven hand-written pagers in
  22 tables and lists.
  - It shows "Showing 26–50 of 927 bookings · Page 2 of 38", Previous/Next (disabled at the ends) and page numbers
    with "…" (fewer on phones).
  - "Rows per page" offers 10/25/50/100, or 10/25/50 where the API stops at 50: customer trips, payments,
    notifications, tickets, login history, support booking search.
  - Every cap was checked in the Java services. The size is kept in `?size=` or in state, and a new size starts at
    page 1.
  - Staff tables now show 25 rows by default (20 was not an option); customer lists keep 10. Hotel search results and
    public reviews keep their fixed sizes, without a menu.
- **Overlap:**
  - The assistant's floating button moves above anything marked `data-assistant-avoid` (every pagination) while it
    passes underneath, as it already did for sticky bars.
  - Staff pages got 7rem bottom padding, and the site footer's last line keeps clear of the button.
  - Checked in Chromium: with the pagination at the window's bottom edge, the button sits 12 px above it.
- **Assistant window:**
  - **Minimized:** only the button (a refreshed gradient button, with a chevron while the chat is open).
  - **Normal:** 500 px wide (was 400 px), up to 640 px tall.
  - **Maximized:** the full window with a 16–24 px margin, the page dimmed, modal, the conversation in a centred
    column; the size is remembered.
  - The header has New chat, Maximize/Restore and Minimize. Messages slide in, "typing" dots show until the first
    words, and the question box and buttons were restyled. Phones keep the full-screen sheet.
  - Unchanged: the chat logic, the streaming, the voice and the backend.
- **Tests:**
  - Frontend: 1,315 (was 1,295; 123 files). Type check, lint and build are clean; the main bundle is 159.6 KB gzip.
  - New `e2e/pagination-assistant.spec.ts` (2 tests): pagination clear of the button, page sizes, and the three
    window states with axe.
  - Full browser suite on the rebuilt Docker frontend: **77 passed, 1 skipped** (the voice round trip, which needs the
    `voice` profile) in 4.7 min, including the real-model assistant tests; 0 axe violations.
- **Changed for users:**
  - "Close the assistant" is now "Minimize the assistant".
  - The login history pages with "Previous"/"Next" (was "Newer"/"Older").
  - The notification centre shows 25 per page (was 20).

### 11.9 Follow-up: application layout and theme (2026-11-06)

Asked for after 11.8: a modern collapsible sidebar and header for every role, modern table headers, a calmer
enterprise theme, subtle motion, and no overlap between sidebar, header, tables and the assistant. Details are in
`frontend/DESIGN_SYSTEM.md` §2, §3 and §5.

- **One sidebar for every portal.** The shared parts are in `components/layout/nav`: `SidebarNav`, `NavTooltip`,
  `NavDrawer` and `navModel.ts`.
  - Grouped links with icons, the current page in the role colour with a bar, and submenus. The admin's Reports
    lists every report; the customer's Notifications and Support tickets have their own submenus.
  - It collapses to icons with tooltips; the width animates and the page follows. Phones and tablets get a drawer.
- **Staff portals (`StaffShell`).**
  - The sidebar is now white and fixed (it was dark and tinted).
  - Header:
    - the toggle (or the drawer button and logo);
    - the breadcrumbs;
    - a quick search ("/" or Ctrl/⌘+K) that uses the existing list searches: admin bookings, support booking lookup,
      a hotel's reservations;
    - the bell and the account menu with name and role.
- **Customer area (`CustomerAreaLayout`, new).** The dashboard, My Trips, a trip and every My account page now share
  one sticky sidebar card inside the public site; on phones a drawer. Booking and payment steps stay outside it.
  "My account" is a calm card instead of a dark banner.
- **Account menu.** It shows the role. Trips and payments are only for customers; everyone gets "My profile" and
  "Settings"; admins also get "System settings".
- **Table headers.** One style everywhere: quiet `slate-50` header, small caps and a modern sort indicator. Headers
  stick under the app header from `xl`; tables too wide for that scroll sideways instead.
- **Theme and motion.**
  - Theme: a `canvas` page colour and a `bg-app` background with a faint portal-colour wash.
  - Motion: pages cross-fade on sidebar and main navigation (View Transitions, off under reduced motion); menus,
    tooltips and drawers animate.
- **Overlap.** Sidebar, header and page never overlap (checked in the browser at 1366, 820 and 390 px); the
  assistant's button stays clear of them, of the pagination and of the footer.
- **Tests:**
  - Frontend: 1,323 tests (was 1,315; 124 files). Type check, lint and build are clean; the main bundle is
    155.0 KB gzip.
  - New `e2e/layout.spec.ts` (2 tests).
  - Full browser suite on the rebuilt Docker frontend: 75 passed, 4 failed, 1 skipped (voice). The failures were:
    - three axe contrast findings: the new canvas (`#f5f7fa`) left slate-500 text on it just under 4.5:1, so the canvas
      went back to `#f8fafc`;
    - a test lookup: Playwright's substring name matching now also found the customer sidebar's "My account" nav and
      its "Notifications" submenu, so the test now uses exact names and the header's bell.
    After the fixes the accessibility suite and the layout tests passed again (46/46, 0 axe violations).
- **Changed for users:**
  - The staff sidebar is light.
  - Collapsing moved to the header.
  - The header's live badge shows only on very wide screens (pages have their own).
  - The account menu says "My profile".
  - Customer pages have a sidebar.

### 11.10 Follow-up: hand cursor, admin list pages, highlighted table headers (2026-11-07)

Asked for: a pointer cursor on everything clickable; the admin pages (dashboard, users, audit logs, payments, refunds,
hotels, bookings, offers, coupons, support) modern and animated, with highlighted table headers.

- **Cursor.** One base rule in `index.css` gives every clickable control the hand cursor and disabled ones "not
  allowed". It covers buttons, selects, checkboxes, radios, labels, options, tabs and switches; Tailwind v4 leaves
  buttons on the arrow. A browser check found no clickable control without it on the ten admin pages, and
  `e2e/layout.spec.ts` now checks it.
- **Table headers.** One shared change for every table:
  - the header is highlighted in the portal colour: a `role-100` band with bold `role-800` small caps;
  - the sorted column is a white chip with its arrow;
  - rows come in one after another and get a tint and an accent bar on hover;
  - the table card fades up.
- **Admin list pages** (shared parts):
  - the page header's icon is on the role gradient, and the filter card and the result count come in after it;
  - the primary button now takes the portal colour everywhere, so "Invite staff", "New coupon" and "New offer" match
    the other indigo actions in the admin portal (outside the portals it is still brand blue);
  - the support page's ticket counts are stat tiles with icons.
- **Found by the tests and fixed:**
  - Grey text placed on the new header band, and a stronger row hover, fell below 4.5:1. That text now uses the
    portal colour, and the hover tint is lighter.
  - The two-month calendar now opens on the month where a stay starts when it ends the next month, and no longer
    shows the neighbouring month's days twice.
- **Tests:**
  - 1,323 unit tests pass; type check and lint are clean.
  - Full browser suite: 77 passed, 2 failed (the two items above), 1 skipped (voice). After the fixes, the affected
    specs passed again: layout, pagination and assistant, pickers, the hotel journey.

## Admin portal upgrade (requested 2026-11-07, built on Phase 11)

Asked for: a modern admin sidebar and header, a real global search, a richer dashboard, and redesigned payments and
support pages, without changing existing behaviour. **Analysis first:** Phase 11 had already built most of it (the staff
shell with a collapsible sidebar, tooltips, groups, submenus, a mobile drawer, breadcrumbs, a notification bell and
account menu; the dashboard v2 with KPIs, range and interval filters and bar, line, area and donut charts). So this
step only fills the gaps and keeps everything else as it was.

| Area | Was | Now |
|------|-----|-----|
| Header search | bookings only (jumped to the bookings list) | **Global search** (`features/admin/search`): customers, hotel bookings, flight bookings, hotels, payments and support tickets at once; 300 ms debounce, at least 2 characters, grouped results with status chips, "See all N", loading / empty / per-kind error states, arrow keys + Enter, `/` or Ctrl/⌘+K, recent searches, a search button on phones; only the kinds the admin may read are queried |
| Search backend | n/a | **No new endpoint.** Each kind is searched by the API that already owns it (`/admin/users`, `/admin/bookings`, `/admin/hotels`, `/admin/payments`, `/admin/support/tickets`), so the filtering is in the databases and each service's own permission check still applies. A federated endpoint would have needed synchronous service-to-service calls, which the design avoids |
| Payments page | 5 columns, filters status / provider / dates | Six figure cards (total, successful, failed, pending, collected revenue, refunded amount) that follow the filters; columns payment id, booking, customer, type, amount, method, transaction, status, date, view; filters add payment method and booking type; search also finds the customer's e-mail |
| Payments backend | list only | `GET /api/admin/payments/summary` (one grouped query, same filter code as the list); list and details get `bookingType`, details get `contactEmail`; filters `method`, `bookingType`; migration `V3__payable_booking_type.sql` (type from the event, old rows from the reference prefix) |
| Support page | six counts, 4 filters | Figure cards (total, open, in progress, resolved, high priority, average resolution time from the metrics endpoint), quick filters, filters add agent and day opened, columns subject / category / created / updated, agents named, coloured priority and status, sortable by created and updated |
| Support backend | summary of six counts | summary adds `resolved`, `highPriority`, `total`; queue adds `agent`, `from`, `to` |
| Dashboard | KPIs, charts, top lists, recent bookings and activity | adds **Recent payments** and **New registrations** (from the payments and users lists, only for admins who may read them) |

Left out on purpose, because the backend has no such thing: internal notes, attachments, a per-ticket activity feed,
refund buttons on payments. The ticket conversation, reply, status and assignment stay in the support portal
(`/support/tickets/:id`), which admins may use.

Tests: payment-service `AdminPaymentIntegrationTest` (filters, summary, details) and `EndpointSecurityTest`;
notification-service `AgentTicketIntegrationTest` (agent / day filters, new counts); frontend tests for the global search
(9), the payments page, the support page and the dashboard lists.

## Admin dashboard redesign (requested 2026-11-07, built on the admin portal upgrade)

Nine sections of `/admin` redesigned as one premium look: a shared section card (accent bar, gradient icon tile, "View
all"), colours that always mean the same (blue hotels, flights and information; green successful and collected;
orange pending; red cancelled and failed; indigo analytics), staggered entrance and hover animation (off under reduced
motion), and loading skeletons, empty states and retry on each. The filter bar (range and interval) drives all of
them; the page asks for the dashboard once.

| Section | What it shows |
|---------|---------------|
| Bookings and revenue by booking type | hotel and flight cards (bookings, net or gross revenue, change, share of bookings and of revenue) and grouped bar charts at the chosen interval; revenue is captured money only, never a pending or failed payment |
| Booking status | ring chart and list: Confirmed, Completed, Pending, Cancelled, Failed or expired, each with count and share (the shares add up to 100 %) |
| Customers | registered, new, **active** (booked in the range), growth chart (total or new), the newest registrations with initials |
| Payments | collected revenue, successful, failed, pending (money due, not collected), refunded, success rate; amount or attempts chart; the latest payments |
| Cancellations | count, rate with its denominator written out, hotel and flight counts and rates, fees, refunds; trend chart and two rings |
| Popular destinations | ranked cards with the booking bar, revenue and **trend against the previous period**; the country from the hotel catalogue when the city has hotels |
| Top hotels | photo and guest rating from the hotel catalogue (only when the hotel has them), bookings, revenue, **trend**, link to the hotel |
| Recent bookings | table (cards on phones): reference, customer, type, destination, date, amount, status; View all |
| Recent activity | timeline of new customers, bookings, cancellations, payments, refunds and tickets, coloured and labelled by outcome; Audit logs |

Backend (reporting-service, additive, `ReportConsistencyIntegrationTest`): `customers.active`, `previousBookings` for
destinations and hotels, `customerName` / `customerEmail` / `destination` on recent bookings, and the `timeline`
(five small indexed queries merged). Chart kit: a series can be marked `level`, so a "customers registered so far"
line is described by where it starts and ends, never summed.

Not shown, because the data does not exist: a destination photo or country for cities without hotels, a refund
status per cancellation, "popularity trend" for anything but bookings against the previous period.

## Customer portal upgrade (requested 2026-11-07, built on Phase 11)

Asked for: a modern top menu and a redesign of the twelve customer pages, with real backend data. **Analysis first:**
Phase 11 had already built the customer area (sidebar layout, dashboard v2 with KPIs, range filter and charts, every one
of the twelve URLs, the design system with reduced-motion support). This step fills the gaps, page by page.

| Page | Added |
|------|-------|
| Top menu | trip search in the header (customers; also in the mobile menu) that opens My Trips with the words; the account menu now lists Profile, Notifications, Preferences, Security next to My dashboard, My Trips, Payments and Support |
| Dashboard | **pending payments** card, **booking status** and **hotels vs flights** donuts, **recent payments**, **recent notifications**, **recommended hotels** (the home page's own recommendation, hidden when empty) |
| My Trips | overview cards and tab counts (the booking service's `trips` figures), **search** (reference, title, destination) and a **flights / hotels** switch, richer cards: hotel photo, city, nights, guests, room; flight route timeline with times, airports, airline, flight number, stops, travellers; edge colour by status; links to payments and to support for that booking |
| Payments | **figure cards** (total paid, successful, pending, failed, refunded), table with transaction, booking, type, amount, method, date, status; search, status, type and date filters, sorting and paging in the URL; a **details dialog** with refunds, receipt and invoice |
| Support | figure cards (total, open, in progress, resolved) and a "waiting for your reply" prompt; **search** and topic filter; opened date on each ticket |
| Reviews | figure cards (written, published, average rating) and search and status filter over my reviews |

Backend (all additive, tested):
- booking-service: `GET /api/bookings` takes `q` and `type`; each row carries `stay` or `flight` facts, read for the page in three queries.
- payment-service: `GET /api/payments` takes `q`, `status`, `method`, `bookingType`, `from`, `to`, `sort`; new `GET /api/payments/summary`; rows have `bookingType`. The admin and customer lists now share one filter class (`PaymentSearch`), and the customer side is always limited to the caller's own payments.
- notification-service: `GET /api/support/tickets` takes `q` and `category`; new `GET /api/support/tickets/summary`.

Left out on purpose, because the backend does not support it (and the task said "only if supported"): editing or deleting
a review, deleting a notification, SMS notifications, file attachments and a priority choice on a ticket, a wishlist,
two-factor authentication, a list of active sessions. Notifications, notification settings, profile, passengers,
preferences and security keep their Phase 11 design.

Tests: backend `HotelBookingSagaIntegrationTest`, `DemoPaymentFlowTest`, `AgentTicketIntegrationTest` (search, filters,
summaries, and that another customer's data never matches); frontend tests for each page above.

## Hotel manager portal upgrade (requested 2026-11-07, built on Phase 11)

Asked for: a redesign of the nine hotel manager pages (home, dashboard, reservations, reviews, reports, profile, photos,
rooms, inventory), with real backend data and the hotel-level rules kept. **Analysis first:** Phase 11 had already built
the portal (staff shell, every route, hotel-level authorisation with `HotelAccess.requireManage`, dashboard v2, front
desk, reports, photos, rooms and the inventory calendar). This step fills the gaps.

| Page | Added |
|------|-------|
| Sidebar and header | links in four groups (Overview, Operations, Guests and insight, Property); the hotel's photo, name, city and status at the top of the sidebar; a hero header with the cover photo and the room count; the hotel switcher keeps the section |
| Home (`/hotel-manager`) | **portfolio figures** added up from each hotel's own dashboard (hotels, rooms, reservations and revenue of 30 days, check-ins and check-outs today, occupancy tonight, reservations waiting for payment), portfolio trend charts, recent reviews; a hotel whose figures fail is left out of the sums and the page says so |
| Dashboard | rooms behind tonight's occupancy, a **rooms tonight** donut and a **reservations by status** donut |
| Reservations | status cards that filter the list, a room type filter, counts that follow the other filters |
| Reviews | average, total, five-star, positive, negative and waiting counts; rating distribution, rating by month and positive / negative by month charts; rating filter and sort |
| Reports | a **Room types** report (revenue, room nights, ADR and share per room type) with a CSV made in the browser |
| Rooms | room types and rooms on sale, active rate plans, lowest price, a rooms-by-type donut |
| Photos | counts and cover status, drag and drop, type and size checks, **upload progress**, a **confirmation before deleting** |
| Inventory | the month added up: occupancy of the rooms for sale, room nights booked, sold-out and stop-sell nights |

Backend (all additive, tested): hotel summaries carry `totalRooms`; the dashboard's `today` carries the rooms behind the
occupancy; `GET …/reservations/summary` and a `roomTypeId` filter on the list; `GET …/reports/room-types`;
`GET …/reviews/summary` and `rating` / `sort` on the review list. Every new endpoint is in the `EndpointSecurityTest`
matrix, and a manager of another hotel gets `403 HOTEL_NOT_ASSIGNED`.

Left out on purpose, because the backend does not support it (and the task said "only if supported"): numbered rooms and
room maintenance status (rooms are counted per room type), confirming or rejecting a reservation (a paid reservation is
confirmed by the payment), payment status on a reservation (held means waiting for payment), answering reviews, Excel and
PDF export, booking source and reordering photos in the page (the API can set a photo's sort order). The hotel switcher appears for a manager with more than one hotel.

Tests: backend `HotelFrontDeskIntegrationTest`, `HotelReportIntegrationTest`, `HotelReviewIntegrationTest`,
`EndpointSecurityTest`; frontend tests for each page above (1,367 in all).

## Global search with Elasticsearch (requested 2026-11-07)

Asked for: a Google-like global search in the existing header for every stakeholder. It should search while typing,
forgive typos, match prefixes, show grouped and highlighted suggestions, have a results page with categories and
paging, and only return what the signed-in user may see. Details: [docs/GLOBAL_SEARCH_IMPLEMENTATION.md](docs/GLOBAL_SEARCH_IMPLEMENTATION.md).

**Analysis first.**
- **What existed:**
  - The admin header already had a "global search", but it was five list APIs called from the browser: no typo
    tolerance, five rankings, admins only.
  - The other headers only had a box that jumped to one list.
  - hotel-service already had an Elasticsearch `hotels` index.
  - Bookings and users publish full-state snapshot events.
- **What did not exist:** state events for tickets, reviews and airports.
- **Decision:** a dedicated read model fed by the existing Kafka events. It is event-driven like reporting-service,
  makes no service-to-service calls per keystroke, and reuses the `hotels` index instead of copying it.

| Part | What |
|------|------|
| **search-service** (new, port 8110, no database) | `GET /api/search/suggest`, `GET /api/search` (public; more with a login), `GET /api/admin/search/status`, `POST /api/admin/search/replay` (admins). Own index `global-search-v2` behind the alias `global-search` (explicit mapping; edge n-gram prefixes, plural stemmer); reads hotel-service's `hotels` index. Six Kafka listeners keep it in sync; destinations come from hotel cities + airports; pages from `search/pages.json` |
| Relevance | exact identifier 50 > exact title 30 > phrase 15 > keywords 4 > prefix 3 > fuzzy 1 (one typo in 5–8 letters, two from 9) > description 0.5; a small vocabulary turns words into filters ("cancelled bookings", "my upcoming trips", "pending payments", "hotel managers", "Paymnt"); city aliases (Bangalore/Bengaluru, ...) |
| Access | filters inside every Elasticsearch query, from the token: customers their own records; hotel managers their hotels (asked from hotel-service with their own token, cached 60 s); support agents bookings, payments, refunds, tickets and customers; admins per permission; signed-out visitors public pages, hotels, destinations. Links are per role and are existing routes |
| Sync rules | idempotent scripted upserts, newest state wins, ranked statuses, payments before bookings, retry without end while Elasticsearch is down, DLT for bad documents, admin replay; mapping versions with an atomic alias switch (tested live: v1 → v2) |
| **New events** | notification-service `SupportTicketSnapshot` (new topic `support.events`), hotel-service `HotelReviewSnapshot` (`hotel.events`), each with a one-time backfill (`data_backfills`) |
| flight-service | `GET /api/airports` (all airports, public) |
| Gateway | route `/api/search/**` + `/api/admin/search/**`, public path `GET /api/search/**`, Swagger entry |
| **Frontend** (`features/search`) | `GlobalSearch` in every header (public site for everyone, admin, support, hotel manager): 250 ms debounce, 2+ characters, stale requests cancelled, grouped suggestions with icons, highlighted text (plain segments, never HTML), status chips, loading / empty / error, recent searches, "/" and Ctrl/⌘+K, arrow keys and Enter. `SearchResultsPage` at `/search`, `/admin/search`, `/support/search`, `/hotel-manager/search`: category tabs with counts, "All" groups, paging, interpretation chip, skeletons, empty and error states |

**Changed for users.**
- The admin header search, which called several list APIs, is replaced by the global search, and the old
  `AdminGlobalSearch` is removed.
- The customers' "Search my trips" box and the support / manager boxes that jumped to one list are replaced too. Trips
  are found as "My trips", bookings as "Bookings" or "Reservations".
- Signed-out visitors get a search box too.

**Found by testing on the real data and fixed:**
- Plain `AUTO` fuzziness was too loose ("Chenai" also found Singapore's Changi airport, "reports" found "resort").
- "Banglore" found nothing, because the hotels are in "Bengaluru".
- "my hotels" also listed reservations and reviews.
- Destinations were built before flight-service was up.
- Test-only: the Playwright option lookups also matched "View all results".

**Left out on purpose:**
- flight offers (supplier prices that live minutes; "Flights to Mumbai" leads to the flight search instead);
- inactive hotels (hotel-service's index only has active ones);
- payments still waiting (only stored once they succeed or fail; "pending payments" lists the bookings waiting);
- development seed payments, which send no events by design.

**Tests:**
- search-service: 43 (Testcontainers Elasticsearch: relevance, roles, sync rules, validation, security; units).
- notification-service: `SupportTicketSnapshotIntegrationTest` (3). hotel-service: review snapshot and backfill (2).
- flight-service: the airport list.
- Gateway: 20/20.
- Frontend: 1,455 (was 1,367), lint, type check and build clean.
- New Playwright `e2e/global-search.spec.ts` (5 journeys, passed twice in a row).
- **Backend** `mvnw verify` (2026-11-08, clean copy without `.env`): BUILD SUCCESS, 604 tests (was 555), 0 failures.
- **Full Playwright run:** 66 passed, 14 failed, 4 not run, 1 skipped (voice).
  - **One failure came from the search:** at 820 px the new header field could not shrink while the sidebar
    turned into a drawer (15 px of sideways scroll). It was fixed; `layout` + `global-search` now pass 7/7.
  - **The other failures come from today's earlier upgrades, not from search:**
    - the sign-in pages' role pill has too little contrast for customer, manager and support (7 axe scans);
    - `TripCard`'s "Payment details of …" link name does not contain its visible text (2 axe scans);
    - the support `PillTabs` contrast;
    - stale tests: a second "…your next trip" region on the customer dashboard, the admin dashboard redesign
      (KPI layout, destinations as cards), and the assistant panel now 624 px instead of 500 px.

    They are left for a separate fix.

## Inter font for the whole application (requested 2026-11-08)

One font everywhere: **Inter** (replaces Plus Jakarta Sans in the web app and Noto Sans in the PDFs). Details in
`frontend/DESIGN_SYSTEM.md` > Typography.

| Where | How |
|-------|-----|
| Web app (public site, customer area, all portals, charts, toasts) | `@fontsource-variable/inter/opsz.css`, self-hosted (CSP `font-src 'self'` unchanged); variable weight 100–900 and optical size (`font-optical-sizing: auto`: display design for headings, text design for body copy); `--font-sans` / `--font-display` = `'Inter Variable'`; the Plus Jakarta Sans package and its word-spacing tweak removed. Only the Latin file (73 KB) loads up front; `latin-ext` (with ₹) when a page shows it |
| PDFs (notification-service documents, reporting-service exports) | Inter 4.1 static TTFs, regular and bold, embedded (`resources/fonts`, SIL Open Font License); checked to contain ₹ and every symbol the documents print. A rendered report PDF embeds `Inter-Regular` and `Inter-Bold`. Documents made before the change keep Noto Sans |
| E-mails | `font-family: Inter, 'Segoe UI', Arial, …`: mail apps cannot download web fonts, so readers without Inter see the same fallback as before |

Tests:
- Frontend: 1,455 passed, plus lint, type check and build.
- notification-service (52) and reporting-service (27), which render real PDFs, passed.
- Playwright: layout, global search and pickers 10/10 (no sideways scroll or overlap at 390, 820 and 1366 px).
- A browser check: every element of the public, search and admin pages computes to `Inter Variable`, and the font
  files come from the app's own origin.

## Kubernetes on kind, GitOps and CI/CD (requested 2026-11-08) ✅

All 11 Spring Boot services and the web app are deployed on a highly available **kind** cluster in Docker, with
production-style manifests, Blue-Green and Canary releases, Argo CD and a GitHub Actions pipeline. The guide is
[KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md); the pipeline is described in [docs/CI_CD.md](docs/CI_CD.md);
decision D14 in PROJECT_ARCHITECTURE.md.

| Area | What was built |
|------|----------------|
| Cluster | `deploy/kind/cluster.yaml`: 3 control planes (behind kind's HAProxy), 3 workers labelled as 3 zones, Kubernetes 1.36; a local registry. Scripts in `deploy/scripts/`. |
| Platform | Gateway API 1.6 + Traefik 3.7 (the edge; ingress-nginx is retired), metrics-server, Argo Rollouts 1.10 with the Gateway API traffic plugin, Argo CD 3.6. All versions pinned. |
| Charts | `microservice`: one generic chart for all 12 services, covering Rollout, Services, HTTPRoute, HPA, PDB, ConfigMap, PVC and ServiceAccount; probes, graceful shutdown, `restricted` security context. `data-platform`: MySQL, Kafka, Connect, Schema Registry, Redis, Elasticsearch, Mailpit, with topic and connector Jobs. `shared`: common config, default-deny NetworkPolicies, quota. |
| Releases | Web app: blue-green with a preview host and manual promotion. api-gateway: canary with traffic weights (10 → 50 → 100 %). Services: canary by replicas. Every step has a smoke test that rolls back automatically. |
| GitOps | `deploy/argocd/`: projects (least privilege), an app-of-apps with sync waves, and an ApplicationSet that gives one Application per service file. `argocd-bootstrap.ps1` points it at the repository. |
| CI/CD | `ci.yml`: tests, Helm lint/render/kubeconform, Trivy, secret scan, workflow lint. `cd.yml`: build → scan → push to GHCR with SBOM and provenance → cosign, then commits the new tag for Argo CD. The EKS promotion is a pull request. |
| Image | The frontend runs as non-root nginx on port 8080, in Docker Compose too (`3000:8080`). |

Found and fixed while testing:
- `hosts.toml` written with a byte-order mark broke image pulls from the local registry.
- Empty optional Secret keys disappeared.
- Helm 4 server-side apply conflicts with Argo Rollouts over Service selectors, so releases use `--server-side=false`.
- The Argo CD controller needed 1.5Gi.
- Argo CD saw drift in HTTPRoute list defaults, so `group`/`kind` are now explicit.

All tests passed; the record is in KUBERNETES_DEPLOYMENT.md section 16.

## Hotel manager pages redesign (requested 2026-11-09) ✅

Asked for: a modern, easier-to-use design for the eight pages of a hotel in the hotel manager portal (dashboard,
reservations, rooms & rates, inventory calendar, reviews, reports, profile, photos). This is a visual and usability change
only: the same API calls, URL parameters, validation and messages. The "My hotels" page and the reservation details page
only get the new header.

| Where | New design |
|-------|------------|
| Every hotel page | One compact header instead of two stacked ones: the cover photo, name, status, and chips for city, stars and rooms. A **Guest view** link opens the public hotel page (published hotels only), and the hotel switcher sits next to it. Below `lg` the hotel's sections are tabs under the header. Figures are compact tiles instead of tall stat cards. |
| Dashboard | The front-desk band links to **today's arrivals** (the reservation list filtered to today's check-ins). Below it, the next 7 days' arrivals with date tiles, then tonight's rooms and reservations by status side by side. Then a "Performance" part with the period, figure tiles with trends, and the room nights as one strip. |
| Reservations | **Status pills with counts** replace the six cards. One search box sits beside a **Filters** button for status, room type and dates; it opens by itself when one of these is set. The sort is always visible. The filters in force show as removable chips. The table adds guest initials and puts the guests in the room column, so it fits on a laptop. |
| Rooms & rates | Room type cards show the facts, amenity chips and a "From ₹… per night" price. Rate plans are cards with a large price per night, breakfast and cancellation badges, and their seasonal prices inside. The forms are grouped. |
| Inventory calendar | A toolbar with month navigation, "This month" and a legend. Today's column is highlighted and scrolled into view. Each cell has a fill bar, and stop-sell cells are striped. Choosing a night shows a summary (booked, held, free) and brings the form into view. |
| Reviews | A rating overview: the average, the totals, and the reviews waiting for moderation with "Show them". The star distribution rows filter the list. Status pills, then review cards with initials, stars and the rejection reason in a red box. |
| Reports | One toolbar for the report, period and CSV export. Totals tiles for each report, including the busiest or best night and the top room type. A full-width nightly chart with weekend shading and an average line. The table in a card, with small bars. |
| Profile | The sections are cards. An "On this page" guide (sticky on wide screens) has a tick for each complete section and "Profile complete N of 5". Amenities are chips with a count, and house rules are numbered. A save bar shows "Unsaved changes" and has **Discard changes**. |
| Photos | A large drop zone; gallery filter pills (All / Hotel / Rooms) with counts; the cover photo outlined; room-type chips. Each caption gets a Save button once it changes. |

Shared parts are in `features/hotel-manager/ManagerParts.tsx`: `ManagerPageHeader`, `MetricTile` / `MetricGrid`,
`FilterPills`, `Toolbar`, `SearchBox`, `SectionCard` and `FactChip` (see `frontend/DESIGN_SYSTEM.md`).

Tests:
- Frontend: 1,502 passed. 146 of them are hotel manager tests, with new ones for the status pills, filter chips, guest
  view, section tabs, today's arrivals, star and gallery filters, the profile guide and "Discard changes", and the
  inventory's "This month" and form scrolling. Lint, the type check and the production build are clean.
- Checked in the browser at 1440 px and 390 px with the development data (dev.manager1, Arabian Sands Beach Resort).

## Data export: CSV, Excel and PDF (requested 2026-11-09) ✅

Asked for: export in CSV, Excel and PDF wherever tabular data is shown, for every role, respecting the filters,
search, pagination and permissions, the same on every screen, with well-formatted files.

**How it works.** One **Export** button on every table and record list, on the right of the result row.
- **Rows:** "This page" (the current page and page size) or "All matching rows". The second choice is for server-paged
  lists; it uses the same filters, search and sort, holds at most 10,000 rows, follows the server's page size, waits
  and retries on `429`, and can be cancelled.
- **Format:** Excel (.xlsx), CSV or PDF (a PDF holds at most 2,000 rows).
- **Permissions:** the rows come from the **same API calls** as the screen, so the server's role, permission and
  ownership checks decide what a file can contain. No new endpoint was added.
- **The files:**
  - Excel has typed cells (₹, dates, percentages), a frozen header with filters, a bold totals row, and an "About this
    export" sheet.
  - CSV is UTF-8 with a BOM and units in the header, and is protected against formula injection.
  - PDF is A4 with Inter embedded, repeated headers, a totals footer, and "who, when, page n of m".
- **Code:** the kit is `lib/export` (writers: fflate for the zip, jsPDF + autotable for the PDF; loaded only on export)
  and `components/export/ExportMenu.tsx`. Details: `frontend/DESIGN_SYSTEM.md` > Data export; security notes:
  SECURITY_GUIDE.md §10a.

| Role | Screens with Export |
|------|---------------------|
| Admin | Users, Bookings, Payments, Refunds, Audit logs, Hotels, Coupons, Offers, Reviews, Support tickets, Flight providers, the 7 reports and hotel occupancy |
| Hotel manager | Reservations, Reviews, Reports (occupancy, revenue, room types, with totals), Inventory calendar (the month, per night and room type) |
| Support agent | Ticket queue, Bookings (and "Needing attention") |
| Customer | My trips, Payment history, Support tickets, Sign-in activity |

Replaced: the reports' separate "Download CSV / PDF" and "Export CSV" buttons now use the same Export menu, so every
screen exports the same way. The server's export endpoints still exist, but the web app no longer calls them.

Not included: dashboards and charts (they offer "Show as table" instead), the AI assistant's answers and the flight
comparison.

Tests:
- Frontend: 1,554 passed (52 new). The new tests cover the writers (CSV rules, the xlsx package, the PDF, totals,
  per-row currency, the page collector) and the menu, and each screen checks its CSV columns and that "All matching
  rows" pages through its API with the screen's filters. Lint, the type check and the build are clean. jsPDF and the
  Excel writer are separate chunks; the fonts load only for a PDF.
- Checked in the browser with the development data:
  - hotel-manager reservations: all three formats;
  - admin bookings: all 993 rows;
  - the admin revenue report: Excel and PDF with totals;
  - customer pages and coupons.
  - The `.xlsx` files open in openpyxl with typed cells, a frozen header, filters and print titles.

Follow-up, not done: writing exports to the audit log (`EXPORT_CREATED`) needs a small backend endpoint.

## Background exports of very large audit logs (requested 2026-11-09) ✅

Asked: with 10 million rows in `audit_logs`, can an admin download everything as Excel, and does it come at once?
Before this change it did not download at all: the web export stops at 10,000 rows, and building 10 million rows in the
browser would take 100,000 API calls and gigabytes of memory. Excel also holds at most 1,048,576 rows per sheet.
Decided with you: a server-side export for the audit log only, and above 1,000,000 rows a `.zip` of Excel parts.

**How it works.**
- **Asking:** on Audit logs, above 10,000 matching entries, Export → "All matching rows" stays available ("prepared on
  the server"). Excel or CSV sends one request (`POST /api/admin/audit-logs/exports`, API_DOCUMENTATION.md §11.1); the
  admin keeps working. At most 2 unfinished exports per admin.
- **Writing (reporting-service):** a poller claims the job (a conditional UPDATE, so one instance runs it), counts the
  entries, then reads them in keyset batches of 5,000 (no `OFFSET`, no long transaction) straight into the file on
  local disk: `StreamingXlsxWriter`, a Java port of the web export's Excel writer (same styles and layout, no new
  production dependency), or CSV. Excel parts hold 1,000,000 rows each; more give a `.zip`. Entries recorded after the
  request are not included. The file is then stored with `FileStorage` (new streaming `putFile` / `open`; S3 in
  production) for 24 hours.
- **Telling:** `export.status-changed` to that admin only: progress at most every 5 s, then ready or failed. "Your
  exports" on the Audit logs page shows progress ("32,00,000 of 1,00,00,000 rows"), size, expiry, Download, Cancel and
  Remove; a toast with Download appears anywhere in the admin portal.
- **Downloading:** a one-time link (random token, only its hash stored, 60 s, single use) that the browser's download
  manager opens: `GET /api/public/export-files/{id}?token=…`. The file is streamed, never held in memory.
- **Audit and clean-up:** `AUDIT_LOG_EXPORT_REQUESTED` and `AUDIT_LOG_EXPORT_DOWNLOADED` in the audit log. Files are
  deleted after 24 h or when removed; a stopping instance hands its running jobs back to the queue; a job whose
  instance died fails after 2 minutes without a heartbeat.
- **Deployment:** docker-compose and kind give reporting-service a storage volume; the chart has a new `tmpSizeLimit`
  (3Gi for reporting-service, 256Mi for the others).
- **Query fix found by the scale test:** `ORDER BY occurred_at DESC, id DESC` meant the select list's alias `id`
  (`BIN_TO_UUID(id) AS id`, text no index holds), so MySQL read and sorted the whole table: 40 s for the first 5,000 of
  10 million rows, for every export batch and every Audit logs list page. The ORDER BY now names the table's columns
  (`audit_logs.occurred_at`, `audit_logs.id`), and MySQL walks the index backwards. No schema change was needed. The
  export's batch query also names its index, so the plan never depends on row estimates.

**Scale test (10,000,000 entries, measured 2026-11-09).** A throwaway MySQL 8.4 container (never the development
database) with 10 million generated entries (2.8 GB table), and reporting-service with `-Xmx448m` as on the dev
machine (i5-12500, Windows, the rest of the stack running):

| | Result |
|---|---|
| Excel, every entry | ready **187 s** after the request (counting 5 s, then about 56,000 rows a second) |
| The file | one `.zip` of **781 MB** with **10 Excel files of 1,000,000 rows** each (about 78 MB per file) |
| CSV, every entry | ready in **167 s**: one 2.67 GB CSV, zipped to **299 MB** |
| Checked independently | the 10 parts hold exactly 1,000,000 rows each, newest first across parts; openpyxl opened a full part (99 s) with real dates and the "About this export" sheet ("Part 10 of 10: entries 90,00,001 to 1,00,00,000") |
| Memory | the Java heap peaked at **139 MB** (limit 448 MB); the rows never sit in memory |
| Disk | only the file itself while it is written (then stored and the work file deleted) |

So the answer to the question: not immediately, but about three minutes for ten million rows, while the admin keeps
working, then a download of under 1 GB.

Tests: backend 13 new (`ExportFileWriterTest`: parts, layout opened with Apache POI (test scope only), CSV, formula
guard; `AuditExportIntegrationTest`: the whole flow, keyset order across batches with equal times, one-time links,
other admins, limits, cancel while running, expiry and interrupted jobs; storage `putFile` / `open` on disk and S3),
`EndpointSecurityTest` covers the new endpoints. Frontend 18 new (the menu's server mode, "Your exports", the toast,
the realtime rule, the page). The frontend test setup now stubs pointer capture, which jsdom lacks: clicking a toast in
`HomePage.test.tsx` threw an unhandled error that made `npm test` exit 1 although every test passed.

Checked live on the development stack (dev.admin, 737 entries): the request, the "ready" toast after 1.1 s, "Your
exports", the download through the browser's download manager (the `.xlsx` opens with a frozen header, filters and
real dates), the link working once, 401 without a login, the two audit entries, and Remove deleting the file.

Not in this change: the Audit logs **list** itself at millions of rows. Its pages no longer sort the whole table (the
fix above), but every page still runs `COUNT(*)` and deep pages use `OFFSET`, so it slows down; that needs keyset
paging or a cached count.
Other lists keep the 10,000-row web export.

## Then: manual testing on the local stack

Decided 2026-11-06: the app is first finished and tested by hand locally. Problems found are fixed in the code, with
tests. The kind cluster (above) is a second way to run it locally. AWS deployment (Phase 12) starts only after that.

## Phase 12 — AWS EKS with Argo CD ⏸ after manual testing

The same charts, rollout strategies and Argo CD layout on Amazon EKS:
- Terraform for the VPC, EKS, RDS MySQL, MSK, ElastiCache, OpenSearch, S3 and SES.
- AWS Load Balancer Controller in front of Traefik; External Secrets Operator with Secrets Manager.
- `deploy/environments/eks/` and `deploy/argocd/eks/`.
- CD's `promote-eks` pull request turned on.

Prepared: `deploy/environments/eks/README.md`.

---

## Information needed from you later

| When | What |
|------|------|
| Phase 5 (optional) | Razorpay **test** Key ID, Key Secret, webhook secret (in your local `.env`, never in chat or Git) and a tunnel for webhooks. Without them the DEMO payment provider is used. |
| Phase 6 (optional) | A Duffel test token if you obtain access. |
| GitOps / CI/CD (now) | The GitHub repository (owner/name) to push to: Argo CD (`argocd-bootstrap.ps1 -RepoUrl ...`) and the CD pipeline need it. |
| Phase 12 (EKS) | AWS account and region, a domain name (DNS + TLS), whether to use GHCR or ECR for images. Not needed until EKS starts. |
