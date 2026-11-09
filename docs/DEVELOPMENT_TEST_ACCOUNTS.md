# Development test accounts and seed data

A development-only seed that lets you sign in as every role that exists and see realistic data on every page:
hotels with rooms and prices, hotel and flight bookings in every state, payments, refunds, reviews, support tickets and
notifications. It is **off by default**, **never loads in production**, and runs only in the services' own databases.

> **Development only.** The password below is public (it is in this file and in the code). Never enable the seed on a
> machine that is reachable from the internet, and never in production.

## 1. How to enable

1. In your `.env` set:

   ```
   DEV_SEED_ENABLED=true
   ```

2. Start (or restart) the six services that seed their own data. The order does not matter:

   ```
   docker compose up -d identity-service hotel-service booking-service flight-service payment-service notification-service
   ```

   The seeders run once at start-up. Look for the log lines `Development accounts ready`, `Development hotel data ready`,
   `Development bookings ready`, `Development flights ready`, `Development payments ready` and
   `Development notifications ready`.
3. Open the sign-in page of the role (table below) and use the password `DevTest@2026!`.

`DEV_SEED_ENABLED` is bound in each service as `<service>.dev-seed.enabled` (`identity.dev-seed.enabled`,
`hotel.dev-seed.enabled`, `booking.dev-seed.enabled`, `flight.dev-seed.enabled`, `payment.dev-seed.enabled`,
`notification.dev-seed.enabled`). The existing `DEMO_USERS_ENABLED` / `DEMO_DATA_ENABLED` switches and their accounts
(`admin@`, `customer@`, `manager@`, `support@flighthotel.local`) are not touched and work as before. Existing accounts
are never modified.

## 2. Accounts

One shared development password for all of them: **`DevTest@2026!`** (a constant in `common-lib` `DevSeed.PASSWORD`;
it is not an environment secret and it is never logged). It satisfies the password policy (10-64 characters, a letter,
a digit).

There are four roles in the platform (`ADMIN`, `CUSTOMER`, `HOTEL_MANAGER`, `SUPPORT_AGENT`); every one of them has an
account.

| Role | Sign-in page | Email | Name |
|------|--------------|-------|------|
| Customer | `/customer/login` | `dev.customer1@flighthotel.local` | Aarav Mehta |
| Customer | `/customer/login` | `dev.customer2@flighthotel.local` | Priya Nair |
| Admin | `/admin/login` | `dev.admin@flighthotel.local` | Dev Admin |
| Hotel manager | `/hotel-manager/login` | `dev.manager1@flighthotel.local` | Rohan Iyer |
| Hotel manager | `/hotel-manager/login` | `dev.manager2@flighthotel.local` | Sneha Kulkarni |
| Support agent | `/support/login` | `dev.support1@flighthotel.local` | Vikram Singh |

The routes are the ones in `frontend/src/app/router.tsx`. An admin may also use the hotel manager and support pages.
Each account's id is deterministic: `UUID.nameUUIDFromBytes("dev-user:<email>")` (`DevIds.user(email)` in
`common-lib`), so every service can refer to the accounts without asking identity-service. The accounts are announced
like any new account (`UserRegistered` through the outbox).

## 3. What each account sees

### Customers (`dev.customer1`, `dev.customer2`)

Both have a profile with phone number and date of birth, travel preferences, sign-in history, and saved passengers
(customer1: Aarav, Ananya, Kabir; customer2: Priya, Suresh, Meera; the two main travellers have an encrypted passport).
Booking references start with `HT-DEV` (hotels) and `FL-DEV` (flights). Dates are relative to the day the seed first ran.

| Booking | Customer | What | When | State | Total (INR) | Reference |
|---------|----------|------|------|-------|-------------|-----------|
| h01 | 1 | Arabian Sands Beach Resort, Sea View Suite, 3 nights | 40 days ago | Completed (review approved, 5 stars) | 45,666.00 | HT-DEVV9NHJ |
| h02 | 1 | Orchid Business Hotel, Executive King, 2 nights | 20 days ago | Completed (review pending, 4 stars) | 19,352.00 | HT-DEV8UKT7 |
| h03 | 1 | Arabian Sands, Garden View Room, 4 nights | in 12 days | Confirmed | 28,560.00 | HT-DEV2RR7K |
| h04 | 1 | Rajputana Heritage Haveli, Heritage Deluxe, 2 nights | in 30 days | Pending payment (nothing paid yet) | 20,296.00 | HT-DEVQQ68V |
| h09 | 1 | Orchid Business, Superior Queen, 2 nights | 10 days ago | No-show (stays paid) | 9,870.00 | HT-DEV38DWX |
| h12 | 1 | Rajputana, Heritage Deluxe, 2 nights | 90 days ago | Completed (review rejected) | 23,128.00 | HT-DEVYHEMS |
| h14 | 1 | Orchid Business, Superior Queen, 2 nights | 75 days ago | Completed (review approved, 5 stars) | 11,340.00 | HT-DEVKUC7U |
| h16 | 1 | Arabian Sands, Garden View, 2 nights | 30 days ago | Cancelled late: 50 % fee kept, 7,140.00 refunded | 14,280.00 | HT-DEVEM998 |
| h05 | 2 | Orchid Business, Superior Queen, 2 nights | in 5 days | Confirmed | 11,340.00 | HT-DEV8VQZ6 |
| h06 | 2 | Rajputana, Maharaja Suite, 3 nights | check-in yesterday | In the hotel now (checked in) | 69,030.00 | HT-DEVVSV7D |
| h07 | 2 | Arabian Sands, Garden View, 2 nights | 60 days ago | Cancelled in the free period, fully refunded | 14,280.00 | HT-DEV4QEQP |
| h08 | 2 | Rajputana, Heritage Deluxe, 2 nights | in 20 days | Cancelled by the hotel, fully refunded | 23,128.00 | HT-DEVGNK2G |
| h10 | 2 | Arabian Sands, Sea View Suite, 2 rooms, 3 nights | in 45 days | Pending payment, one failed payment attempt | 79,296.00 | HT-DEVX4KUM |
| h11 | 2 | Orchid Business, Executive King, 2 nights | 35 days ago | Completed (review approved, 4 stars) | 19,352.00 | HT-DEVA85X5 |
| h13 | 2 | Arabian Sands, Garden View, 2 nights | 120 days ago | Completed (review approved, 3 stars, reported by a manager) | 14,280.00 | HT-DEVFZBSM |
| h15 | 2 | Rajputana, Heritage Deluxe, 2 nights | 50 days ago | Completed (review approved, 5 stars) | 23,128.00 | HT-DEV3ZWNE |
| f01 | 1 | Delhi to Mumbai, 6E 7101, 1 adult, Saver fare | 25 days ago | Completed | 5,553.00 | FL-DEVTQQU9 |
| f02 | 1 | Bengaluru to Delhi (AI 9205) and back (AI 9206), 2 adults, Flex fare | in 15 and 20 days | Confirmed | 34,119.00 | FL-DEVATB2U |
| f05 | 1 | Chennai to Bengaluru, 6E 7310, 1 adult, Flex fare | 50 days ago | Cancelled: 25 % fare fee, 3,338.00 refunded | 4,240.50 | FL-DEVJNM66 |
| f07 | 1 | Mumbai to Delhi, 6E 7102, 1 adult, Saver fare | in 10 days | Pending payment, one failed payment attempt | 5,605.50 | FL-DEV4M46R |
| f03 | 2 | Mumbai to Goa, QP 1411, 1 adult + 1 child, Saver fare | in 3 days | Confirmed | 6,738.00 | FL-DEVSWRQ6 |
| f04 | 2 | Hyderabad to Chennai, 6E 7233, 1 adult, Flex fare | in 45 days | Pending payment (nothing paid yet) | 4,723.50 | FL-DEVJQKG4 |
| f06 | 2 | Delhi to Mumbai, 6E 7101, 1 adult, Saver fare | 30 days ago | Completed | 5,553.00 | FL-DEVRUW24 |

Customers also have in-app notifications (read and unread, in every category), and support tickets (section below).
The pending-payment bookings can really be paid with the demo checkout: their holds stay open for 30 days.

Amounts follow the real rules: hotel GST per room and night (5 % up to INR 7,500 a night, otherwise 18 %), flight fare
lines with "Fuel and airport charges" (INR 450 per seat and leg) and GST 5 %. Hotel cancellation terms: the flexible
rate is free until 48 hours before check-in, then 50 % of the stay price; the saver rate is non-refundable.

### Hotel managers

| Manager | Hotels (assigned) | What they see |
|---------|-------------------|---------------|
| `dev.manager1` | Arabian Sands Beach Resort (Goa), Orchid Business Hotel (Bengaluru) | rooms, rate plans, a year of inventory, reservations of those two hotels in every state (held, confirmed, checked in, checked out, no-show, cancelled by the customer, cancelled by the hotel), guests, reviews of both hotels, reports |
| `dev.manager2` | Rajputana Heritage Haveli (Jaipur) | the same for the third hotel, including the guests currently in the house (h06) |

Hotels are `data_source = INTERNAL` (no "Demo" badge), ACTIVE, with generated placeholder photos (labelled "DEV DATA"),
amenities, policies and a search document. Guest ratings come from the approved reviews: Arabian Sands 4.0 (2 reviews),
Orchid Business 4.5 (2), Rajputana 5.0 (1). One approved review has an open report, and one is pending, so the
moderation queue is not empty. The hotel-service demo catalogue (`DEMO_DATA_ENABLED`) stays as it is.

### Admin (`dev.admin`)

Sees everything above: all users, the three hotels, all 23 bookings, the payments, refunds and invoices, reviews to
moderate (one pending, one open report), the flight provider and the dev timetable, the support queue. Dashboards in
reporting-service receive the bookings (one booking snapshot each), see the limits in section 7.

### Support agent (`dev.support1`)

Ticket queue with six tickets in different states: two open and unassigned (one high priority), one in progress, one
waiting for the customer, one escalated, one resolved; the last four are assigned to `dev.support1`, each with a
conversation. Booking lookup by reference (`HT-DEV...`, `FL-DEV...`), booking assist, internal notes on two bookings,
payment status of every booking.

## 4. What is seeded where

Every service writes only its own database, directly (no booking saga, no payment provider, no e-mail). Rows are
linked by deterministic ids, so the services can start in any order.

| Service | Rows |
|---------|------|
| identity-service | 6 users with roles, BCrypt hashes, `UserRegistered` events, saved passengers (encrypted passports), travel preferences, sign-in history |
| hotel-service | 3 hotels, 6 room types, 12 rate plans, a year of inventory, 12 placeholder photos, amenities and policies, manager assignments, a copy of the 6 users (`known_users`), 16 reservations with guests, 7 reviews, 1 review report, ratings, search document |
| booking-service | 16 hotel bookings and 7 flight bookings with price lines, guests, passengers, status history, 3 cancellations and 4 refund requests, 2 internal support notes, booking snapshots |
| flight-service | 7 non-stop schedules (6E 7101, 6E 7102, AI 9205, AI 9206, QP 1411, 6E 7233, 6E 7310), 7 supplier bookings with the trip as priced, hold items, tickets, the DEMO airline's orders and the seats sold or held |
| payment-service | 23 payable bookings, payment attempts (success, failed, refunded, partly refunded) with the DEMO provider, refunds, invoices `INV/DEV/...` |
| notification-service | bell notifications (read and unread), booking contacts, 6 support tickets with 13 messages, one notification preference, one newsletter subscription |

Idempotent: a row is skipped when its deterministic id already exists, so restarting or running again adds nothing.
Dates are fixed on the day of the first run (an upcoming stay stays "in 12 days" relative to that day only).

## 5. Production protection

1. `DEV_SEED_ENABLED` defaults to `false` in `application.yml`, `docker-compose.yml` and `.env.example`.
2. Each service's `prod` profile forces `<service>.dev-seed.enabled: false`.
3. Every seeder checks the active profiles again and does nothing (it logs an error) when `prod` is active, even if the
   switch is `true`.

Each seeder has an integration test that checks: rows and relationships, a second run adds nothing, nothing happens
when the switch is off, nothing happens with the `prod` profile.

## 6. Reset

* **Everything** (all data of the stack, including the demo data): `docker compose down -v`, then start again.
* **Only the dev data**: set `DEV_SEED_ENABLED=false`, then delete the rows with SQL in each database (the statements
  are the ones the tests use to clean up). Open a client with the service's database user. Order matters.

  ```sql
  -- booking_db
  DELETE FROM booking_support_notes WHERE booking_id IN (SELECT id FROM bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV');
  DELETE FROM booking_refund_requests WHERE booking_id IN (SELECT id FROM bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV');
  DELETE FROM cancellations WHERE booking_id IN (SELECT id FROM bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV');
  DELETE FROM bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV';

  -- payment_db
  DELETE FROM invoices WHERE booking_reference REGEXP '^(HT|FL)-DEV';
  DELETE FROM refunds WHERE booking_id IN (SELECT booking_id FROM payable_bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV');
  DELETE FROM payment_transactions WHERE booking_id IN (SELECT booking_id FROM payable_bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV');
  DELETE FROM payable_bookings WHERE booking_reference REGEXP '^(HT|FL)-DEV';

  -- flight_db
  DELETE d FROM demo_orders d JOIN flight_supplier_bookings b ON b.idempotency_key = d.idempotency_key WHERE b.booking_reference LIKE 'FL-DEV%';
  DELETE FROM flight_supplier_bookings WHERE booking_reference LIKE 'FL-DEV%';
  DELETE FROM demo_seat_inventory WHERE schedule_id IN (SELECT id FROM demo_flight_schedules WHERE flight_number IN ('6E 7101','6E 7102','AI 9205','AI 9206','QP 1411','6E 7233','6E 7310'));
  DELETE FROM demo_flight_schedules WHERE flight_number IN ('6E 7101','6E 7102','AI 9205','AI 9206','QP 1411','6E 7233','6E 7310');

  -- notification_db
  DELETE FROM support_ticket_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE customer_email LIKE 'dev.%@flighthotel.local');
  DELETE FROM support_tickets WHERE customer_email LIKE 'dev.%@flighthotel.local';
  DELETE FROM notifications WHERE source_event_id LIKE 'dev-seed:%';
  DELETE FROM booking_contacts WHERE booking_reference REGEXP '^(HT|FL)-DEV';
  DELETE FROM newsletter_subscriptions WHERE email LIKE 'dev.%@flighthotel.local';

  -- hotel_db: delete reviews, reservations and their guests, inventory, rate plans, images, room types, staff and the
  -- three hotels whose slug ends in -goa, -bengaluru, -jaipur and whose names are Arabian Sands Beach Resort,
  -- Orchid Business Hotel, Rajputana Heritage Haveli (data_source = 'INTERNAL'); then DELETE FROM known_users
  -- WHERE email LIKE 'dev.%@flighthotel.local'; then rebuild the search index from the admin hotel page.

  -- identity_db
  DELETE FROM login_history WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local');
  DELETE FROM customer_passengers WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local');
  DELETE FROM travel_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local');
  DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local');
  DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'dev.%@flighthotel.local');
  DELETE FROM users WHERE email LIKE 'dev.%@flighthotel.local';
  ```

  Setting `DEV_SEED_ENABLED=true` again and restarting the six services creates everything fresh, with dates relative
  to that day. Reporting-service keeps what it learned from the events (see below).

## 7. Limits and notes

* **No e-mail, no PDF.** Nothing is sent from seed data and no reminder is scheduled; the bookings have no generated
  documents (confirmation, e-ticket, invoice PDFs), so the Documents list of a seeded booking is empty.
* **No open payment attempt** (`INITIATED` / `PENDING`) is seeded: the reconciliation job would close it after an hour.
  Pending bookings simply have no attempt yet (or a failed one).
* **Reporting-service** is not seeded directly. It learns the 23 bookings and 6 users from the snapshot events, but
  payment, refund and cancellation figures in the admin reports come from saga events that the seed does not send.
* **Flight search** shows the seven dev flights next to the generated DEMO timetable.
* **Photos** are generated placeholders, not photographs.
* After the seed, hotel search shows the three hotels once the catalogue event has been processed (a few seconds).

## Verifying the chatbot, logout and login auto-fill

### Login auto-fill (development panel)

The "Development Test Accounts" panel is part of the front end, not of any API. It shows only when the front end was built
with `VITE_DEV_ACCOUNTS=true`:

* `npm run dev` (Vite): on by itself (`frontend/.env.development`).
* Docker: set `VITE_DEV_ACCOUNTS=true` in `.env`, then `docker compose up -d --build frontend` (default `false`: a normal
  image has no test email or password in its bundle or its source map).

1. Open a sign-in page, for example `http://localhost:3000/hotel-manager/login`. Below the form there is the panel with
   only that role's accounts (customer page: customers; admin page: the admin; hotel manager page: both managers;
   support page: the agent).
2. Press **Use Credentials** on an account: the email and password fields are filled, nothing is submitted.
3. Press **Log in** (the normal button). You land on the role's start page: customers `/customer/dashboard`, admin `/admin`,
   hotel managers `/hotel-manager`, support `/support`.

### Logout

Use the account menu (top right) and choose log out:

| Signed in as | Lands on |
|--------------|----------|
| customer | `/customer/login` |
| admin | `/admin/login` |
| hotel manager | `/hotel-manager/login` |
| support agent | `/support/login` |

Then: the browser's **Back** button does not show the page you left (the history entry was replaced), opening a protected
URL such as `/account/payments` sends you to the sign-in page, and the stored token is gone (a request with it gets `401`).

### AI chatbot

Needs the assistant to be enabled (`GET /api/assistant/config` says `enabled: true`: Ollama running with the model
pulled, see AI_ASSISTANT.md §3). The first answer after a restart can take about a minute on a CPU.

| Sign in as | Ask | Expected |
|------------|-----|----------|
| customer1 | "Show my upcoming trips" | a **Your trips** card (reference, hotel or airline, destination, dates, status badge) and the button **View My Trips** |
| customer1 | "Show my recent payments" | a payments card with amounts and statuses as the app shows them, and **View All Payments** |
| customer1 | "Show my notifications" | a notifications card with an unread count, and **View Notifications** |
| customer1 | "I want to update my profile" | numbered steps and **Open My Profile** |
| customer1 | "Show only the cancelled ones" (after the trips question) | only cancelled trips (a follow-up query, authorised again) |
| customer1 | "Show payments of last week for booking XX-00000000" | a "no matching" or "nothing found" card, never an invented record |
| customer1 | "Show the admin dashboard" | no admin button; no admin data |
| manager1 | "Show today's arrivals" / "Show reservations" | reservation cards for the manager's hotels, and **View Reservations** that opens the dashboard of that hotel (the id comes from the manager's own hotels) |
| manager2 | "Show reservations" | only the one hotel of manager2 |
| admin | "How many bookings and how much revenue in the last 30 days?" | a figures card and **Admin Dashboard** |
| any | "Who won the cricket match?" | a polite "I can only help with this app" |

Buttons navigate inside the app (no reload). Every figure on a card is the backend's own value; the text above it is a short
summary. To see the logs: `docker compose logs mcp-client-service` (`Assistant intent`, `Assistant tool call`,
`Assistant answered without a lookup`, `Assistant card dropped`), which never contain tokens, questions or answers.

If the model is not pulled or Ollama is down the chat button is hidden; nothing else in the app is affected.
