# Security Guide

How authentication, authorization and sensitive data are handled, and the rules to follow when adding code.
API details: [API_DOCUMENTATION.md](API_DOCUMENTATION.md) §1–4.

## 1. Layers

```
Browser ──► nginx ──► API gateway ──► service (identity, hotel, ...)
             │           │                 │
             │           │                 └─ validates the JWT again, checks roles/permissions/ownership
             │           └─ rejects requests without a valid JWT on protected routes, keeps roles out of staff
             │              areas they have nothing to do with (403), CORS, rate limits
             └─ security headers, same-origin /api proxy, access log without query strings
```

The gateway is only the first filter. **Every service validates the token itself** (signature via identity-service's
JWKS, issuer, expiry, revocation) and does all exact role, permission and ownership checks. Never trust a header set by
the gateway for authorization.

**Staff areas at the gateway (Phase 10).** `gateway.role-paths` lets only these roles reach a staff area at all:

| Path | Roles |
|------|-------|
| `/api/admin/**` | `ADMIN`, `SUPPORT_AGENT` |
| `/api/hotel-manager/**` | `HOTEL_MANAGER`, `ADMIN` |
| `/api/support/bookings/**` | `SUPPORT_AGENT`, `ADMIN` |

Why: a service validates the request body before its `@PreAuthorize` method runs. Without this rule, a customer
sending a broken body to an admin endpoint got `400` with field errors instead of `403`. That was never a way in, but it
told an untrusted user more than needed. Now every other role gets `403` before any service reads the request. A new
staff area needs a new entry here.

## 2. Accounts and passwords

| Rule | Where |
|------|-------|
| 10–64 characters, at least one letter and one digit, not the email, not a common password, max 72 bytes UTF-8 | `PasswordPolicy` (frontend mirrors it) → `422 WEAK_PASSWORD` with `details.rules` |
| Hashing: BCrypt cost 12 behind `DelegatingPasswordEncoder` (`{bcrypt}` prefix); hashes are upgraded on login when the cost changes | `IdentitySecurityConfig` |
| 5 wrong passwords → account locked 15 minutes (`423 ACCOUNT_LOCKED`) | `LoginAttemptRecorder` (own transaction, so the counter survives the failed login) |
| Every login attempt on a known account is recorded (IP, user agent), kept 180 days, visible to the user | `login_history`, `IdentityHousekeepingJob` |
| Sign-in per portal (Phase 11): the login names its page; an account without a role for it gets `403 PORTAL_NOT_ALLOWED` only after the right password (no tokens, no cookie, no failed attempt; login history and audit `LOGIN_PORTAL_REFUSED`). Admins may use the hotel manager and support pages. The portal is a convenience for the web app, not an access rule: tokens are the same, and every endpoint still checks its own role or permission. | `Portal`, `AuthServiceImpl.login`, `LoginAttemptRecorder.recordPortalRefused` |

**Account enumeration** is prevented on every public endpoint:

- *Register* always answers `202` with the same message. If the email belongs to an active account, that owner gets an
  "you already have an account" email instead.
- *Login* says "Wrong email or password" for both cases, and compares against a dummy BCrypt hash when the email is
  unknown, so both take the same time. The account status (not verified, deactivated) is only revealed to someone who
  knows the password.
- *Forgot password* and *resend verification* always answer `202`.

## 3. Access tokens (JWT)

- **RS256**, 15 minutes, issued by identity-service. Claims: `sub`, `email`, `given_name`, `roles`, `permissions`,
  `sid` (session), `jti`, `iss`, `iat`, `exp`.
- **Signing keys** are in `identity_db.signing_keys`. The private key is encrypted with `DATA_ENCRYPTION_KEY`
  (AES-256-GCM). All instances sign with the same key and tokens survive restarts. On first start one key is generated
  (MySQL named lock against two instances doing it at once).
- **Public keys**: `GET /.well-known/jwks.json` (public, cached 5 minutes). Retired keys stay published for 1 day so
  tokens signed just before a rotation still verify. *Rotation tooling (new key + retire old) is not built yet; it belongs with the deployment work (Phase 12, on hold).*
- The browser keeps the access token **in memory only** (never `localStorage`).

## 4. Sessions and refresh tokens

A session is a **refresh-token family** (`refresh_tokens.family_id`, the `sid` claim).

| Property | Value |
|----------|-------|
| Format | 256 random bits; only the SHA-256 hash is stored |
| Cookie | `fh_refresh`, `HttpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` in production (`AUTH_COOKIE_SECURE`) |
| Lifetime | 1 day (session cookie), or 30 days with "remember me" (persistent cookie) |
| Rotation | Every `/api/auth/refresh` issues a new token and marks the old one `ROTATED` |
| Several tabs | The old token may be used again for 30 s after rotation (the other tab gets an access token, no new cookie) |
| Reuse detection | Using a rotated token **after** the grace period revokes the whole family (`REUSE_DETECTED`, audit event): one of the two parties is an attacker, so both must log in again |

**CSRF.** Only `/api/auth/refresh` and `/api/auth/logout` use the cookie. They require
`X-Requested-With: XMLHttpRequest` (`403 CSRF_CHECK_FAILED` otherwise). A cross-site form cannot set that header, and a
cross-site script cannot send it without a CORS preflight, which the gateway only allows for our origins. Together with
`SameSite=Strict` this is defence in depth. All other endpoints use the bearer header, so CSRF does not apply.

## 5. Revocation

Access tokens are short-lived but can be revoked early through Redis (`TokenRevocationStore`), checked by every service:

| Event | What is revoked |
|-------|-----------------|
| Logout | The refresh-token family + this access token (`auth:revoked:jti:<jti>`) |
| Log out everywhere, password reset, account deactivated | All refresh tokens + every access token issued before *now + 1 s* (`auth:revoked-before:<userId>`); open tabs get the realtime message `session.revoked` |
| Password change | All *other* sessions; this session gets a fresh access token |
| Role change | Every access token issued before *now + 1 s*; sessions stay, so the browser refreshes and receives the new roles |

Notes:

- JWT `iat` has **second precision**, so "issued before now + 1 s" also revokes a token issued in the same second as the
  event. A person never logs in again that fast; automated tests must wait a second (see `AdminUserIntegrationTest`).
- If Redis is unreachable, the revocation check is skipped (logged as a warning) rather than failing every request.
  The exposure is bounded by the 15-minute token lifetime; refresh tokens are always checked in MySQL.

## 6. Authorization

- **Roles**: `CUSTOMER`, `ADMIN`, `HOTEL_MANAGER`, `SUPPORT_AGENT` (authorities `ROLE_*`).
- **Permissions** (fine-grained, in the token): seeded in `V3__roles_and_permissions.sql`.

| Role | Permissions |
|------|-------------|
| ADMIN | everything except `HOTEL_MANAGE_ASSIGNED` |
| HOTEL_MANAGER | `HOTEL_MANAGE_ASSIGNED` + the per-hotel assignment in `hotel_staff` (`HotelAccess`, `403 HOTEL_NOT_ASSIGNED`) |
| SUPPORT_AGENT | `BOOKING_READ_ANY`, `BOOKING_MANAGE_ANY`, `PAYMENT_READ_ANY`, `SUPPORT_TICKET_MANAGE`, `USER_READ_ANY` |
| CUSTOMER | none (own data only) |

Rules:

1. Endpoints are **protected by default**. Public ones are listed explicitly in `travel.security.public-paths` (service)
   **and** `gateway.public-paths`.
2. Role/permission checks go on the **service layer** with `@PreAuthorize` (e.g. `AdminUserServiceImpl` is
   `hasRole('ADMIN')` for every method), so they also apply when a method is called from somewhere other than a controller.
3. **Ownership**: customer data is always loaded by `id AND owner` (`findByIdAndUserId`). Someone else's resource
   answers **404**, not 403, so its existence is not revealed.
4. Admins cannot deactivate themselves or remove their own `ADMIN` role (`422 CANNOT_CHANGE_OWN_ACCOUNT`).
5. Admin list endpoints only sort by whitelisted fields; page size is capped.
6. Hotel managers reach only hotels assigned to them by an admin (`HotelAccess.requireManage` at the start of every
   hotel-manager service method); admins have `HOTEL_MANAGE_ANY`. Assignments are made by email and only for accounts
   with the `HOTEL_MANAGER` role.
7. Manager edits carry the entity `version`: a stale edit is refused (`409 CONCURRENT_MODIFICATION`), never merged.
8. **Phase 9 portals.** Every admin, manager and agent endpoint checks its permission in the service:
   - Dashboard and reports need `REPORT_VIEW`; audit logs and settings need `ADMIN`; coupons and offers need
     `COUPON_MANAGE`; review moderation needs `REVIEW_MODERATE`; the ticket queue needs `SUPPORT_TICKET_MANAGE`.
   - Booking search needs `BOOKING_READ_ANY`; goodwill refunds need `REFUND_MANAGE`; payment and refund lists need
     `PAYMENT_READ_ANY`.
   - Front desk, hotel reports and manager reviews need the hotel assignment (`403 HOTEL_NOT_ASSIGNED`). Admin occupancy
     needs `ADMIN`.
   - Phase 11 dashboards: admin dashboard v2 needs `REPORT_VIEW`; support metrics need `SUPPORT_TICKET_MANAGE`; the hotel
     manager dashboard needs the hotel assignment (checked before the range and interval are read);
     `GET /api/bookings/summary` is open to any signed-in user and always returns the caller's own bookings (the user
     id comes from the token, never from the request).

   Sort fields are whitelisted, page sizes are capped at 100, and report columns and filters come from code, never
   from the request. The frontend hides links and actions a role lacks, but the server decides.
9. **Seeded but not checked (Phase 10 review).** `USER_READ_ANY`, `AUDIT_VIEW`, `SETTINGS_MANAGE` and
   `FLIGHT_PROVIDER_MANAGE` exist in `V3__roles_and_permissions.sql`, but no code checks them: those endpoints require
   `hasRole('ADMIN')`. So a support agent's `USER_READ_ANY` gives no access to `/api/admin/users`. This is safe (the
   stricter rule wins). If an agent ever needs the user list, switch that endpoint to the permission instead of adding
   the role.

## 7. Sensitive data

| Data | Protection |
|------|-----------|
| Passport numbers | AES-256-GCM via `EncryptedStringConverter` (`passport_number_enc`, prefix `v1:`); API returns `••••` + last 4 only |
| Token-signing private key | Encrypted with the same key |
| Refresh tokens, email-link tokens | Only SHA-256 hashes in the database; single-use |
| Email-link tokens in transit | `identity-email.events` topic (and its DLT) keeps messages **24 hours**; notification-service never stores email bodies |
| Passwords | Never logged, never returned; BCrypt only |
| Audit events | `AuditPublisher` — never put personal data or secrets into `details` |

`DATA_ENCRYPTION_KEY` (32 random bytes, base64) comes from `.env` locally and a secrets manager in production.
Losing it makes passports and the signing key unreadable; changing it requires a re-encryption migration.

## 8. Email links

| Link | Valid | Notes |
|------|-------|-------|
| Verify email | 24 h | Earlier links stay valid until used; clicking twice is harmless |
| Reset password | 1 h | Only for active accounts; all other reset links are invalidated when one is used; ends every session |
| Staff invitation | 72 h | Uses the reset-password page; accepting it also verifies the email. Since Phase 11 the link also names the staff sign-in page (`portal=`), which grants nothing by itself |

At most one verification/reset email per account per 60 s. notification-service does not send a link email whose
token has already expired (e.g. after an outage) and records it as `SKIPPED_EXPIRED`.

## 9. File uploads (profile photos)

`ProfilePhotoProcessor`: max 2 MB (`413 FILE_TOO_LARGE`), format detected from the **bytes** (JPEG/PNG only, never by
file name or Content-Type), image dimensions read from the header before decoding (rejects "decompression bombs"
above 40 megapixels), resized to ≤ 512 px and **re-encoded** as JPEG, which removes EXIF/GPS metadata and anything
appended to the file. Files are stored under random keys and only served through `GET /api/customers/profile/photo`
with the owner's token.

## 9a. Hotel photos

Same pipeline as profile photos (`common-lib` `ImageProcessor`), 5 MB limit, two sizes (1600 px, 480 px). Hotel photos
are public catalogue content: `GET /api/hotels/images/{id}` needs no login and is cacheable. Image ids are random
(UUIDv7), so photos of draft hotels are not discoverable.

## 9b. Bookings and payments (Phase 5)

| Rule | How |
|------|-----|
| The browser never decides a price | Booking takes only quote id, guests and contact; every amount comes from hotel-service's `HotelInventoryHeld` and booking-service's coupon calculation. `create-order` takes only `{bookingId}`: the amount is `payable_bookings.amount`. |
| Own data only | `bookings`, `payments`, `invoices` and `notifications` are looked up by id **and** owner (`404` for someone else's, never `403`); `BOOKING_READ_ANY` / `PAYMENT_READ_ANY` (support, admin) may read any. |
| A payment counts only when the server confirmed it | Checkout signature `HMAC_SHA256(orderId\|paymentId, secret)` (constant-time compare) **and** the provider's own record (status, order, amount, currency). A forged or tampered callback, a payment of another order, or a different amount never confirms a booking. |
| Webhook (public endpoint) | Signature over the **raw body** is checked first (401 on failure, nothing parsed or stored), then the event id (unique, duplicates acknowledged and ignored), only then the JSON is parsed. Rate limited at the gateway like every route. Stored events are a sanitized summary without e-mail/phone. |
| Idempotency everywhere money or rooms move | `Idempotency-Key` (booking, order), unique event id per consumer (`processed_events`), refund request id as key at our database **and** at Razorpay (`X-Refund-Idempotency`). |
| Payment secrets | `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` only in the local `.env` / secrets manager; never logged, never returned. Only the public Key ID goes to the browser. Card, UPI and bank details are typed into Razorpay's window and never reach our pages, servers, logs or database. |
| DEMO provider | Exists only with `payment.demo.enabled=true` (local, Docker); the `prod` profile forces it off, and then the `/api/payments/demo/*` endpoints do not exist. Its callbacks are signed, so even locally a browser cannot invent a paid order without the demo secret. |
| Content Security Policy | `script-src`, `frame-src`, `connect-src`, `img-src` and `form-action` allow only the Razorpay hosts needed for Checkout (`frontend/nginx/security-headers.conf`); `Permissions-Policy` allows `payment=(self)` and, since Phase 11, `microphone=(self)` (voice questions to the assistant: our own origin only, embedded frames get no microphone, and the browser still asks the user). The CSP has `media-src 'self' blob:` (Phase 11: the assistant plays the MP3 of `/api/assistant/voice/speech` from a `blob:` URL, which the default `'self'` would block). Before these two changes the Docker build blocked the microphone (`getUserMedia` → `NotAllowedError`) and `blob:` audio. |
| Passport numbers (flights) | Entered only on international trips; encrypted at rest in booking-service (`passport_number_enc`, AES-256-GCM, key `DATA_ENCRYPTION_KEY`), shown as the last four characters, **never in events or logs** (events carry names, types, dates of birth). In the browser they live in memory only: they are not written to `sessionStorage`, so a reload asks for them again. Saved passengers never send their stored passport number back to the page. |
| Passenger rules | Child 2–11 / infant under 2 (checked against today), at most one infant per adult, 9 seats per booking, passport expiry in the future; refused with `422 INVALID_PASSENGERS`. |
| Cancellations and refunds (Phase 7) | The owner cancels their own booking; others need `BOOKING_MANAGE_ANY` **and** a reason. A full refund (`waiveFee`) and sending a failed refund again need `REFUND_MANAGE` (admin only). The fee and refund are calculated on the server from the booked terms; the browser only sends the refund it saw (`expectedRefundAmount`), and a different figure is refused, never used. `Idempotency-Key` per booking; the cancellation id is the key at the hotel and the airline. Support notes are internal (never on the customer's timeline) and are kept out of audit events, which carry ids and amounts only. |
| Documents (Phase 8) | PDFs are generated on the server from the services' own events, never from browser data. Files live in `FileStorage` (local folder; a **private** S3 bucket with server-side encryption in production) under keys `documents/<uuid>.pdf` that are validated on every access, so a key can never point elsewhere. No public or pre-signed URLs: `GET /api/documents/{id}/download` checks owner or `BOOKING_READ_ANY` (others `404`), answers `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` and an attachment `Content-Disposition`. A booking's document list for someone else is simply empty. |
| Newsletter (Phase 8) | Public, rate limited, the same answer for every address (no way to learn who is subscribed). Double opt-in: the confirmation token is random (256 bit), stored as SHA-256, valid 48 h, used once; at most one confirmation e-mail per address every 10 minutes. Unsubscribe links are `id.HMAC-SHA256(NEWSLETTER_SECRET)`: they need no stored token and cannot be forged; the page asks for a click, so mail scanners cannot unsubscribe anyone. `NEWSLETTER_SECRET` is required in the `prod` profile. |
| Support tickets (Phase 8) | A customer only sees and answers their own tickets (`404` otherwise) and may only attach their own bookings (`422 INVALID_BOOKING`, checked against booking-service's events); staff need `SUPPORT_TICKET_MANAGE`. |
| Admin money actions (Phase 9) | A goodwill refund needs `REFUND_MANAGE` and an `Idempotency-Key`. It is never more than what is still refundable (paid minus refunds that are done or on their way), and payment-service checks the same limit again. The admin's reason stays an internal note: audit events carry ids and amounts only. A hotel can cancel a stay only for its own hotel; the guest is then refunded in full by booking-service, never by the hotel. |
| Reviews (Phase 9) | Only the customer who stayed can review (`422 NOT_ELIGIBLE` for any other booking id, so ids cannot be probed), once per booking. Text is shown only after a moderator approves it; the page renders it as text, never HTML. One report per user per review, never on your own review. Moderation audit events carry ids, rating and counts, not the text. |
| Exports (Phase 9) | Reports and occupancy exports are attachments with `no-store` and `nosniff`. A CSV cell starting with `= + - @` gets a leading `'`, so a spreadsheet never runs it as a formula. Exports are capped at 10,000 rows. Public home page figures (`/api/public/*`) are counts by city or route only, never people or amounts. |
| Global search | `GET /api/search/**` is public: without a token only public pages, active hotels and destinations come back. With a token, search-service takes the user, roles and permissions from the verified JWT (never from parameters) and puts the access rules inside every Elasticsearch query: own records for customers, their hotels for hotel managers (asked from hotel-service with the manager's own token; no answer = no hotel results), the owning services' permissions for staff (`BOOKING_READ_ANY`, `PAYMENT_READ_ANY`, `USER_READ_ANY` limited to customers for support agents, `SUPPORT_TICKET_MANAGE`, `REVIEW_MODERATE`). A category the user may not search is `403`. Results never carry raw documents, owner ids or identifier lists; highlights are text segments rendered by React, never HTML; links open pages that check access again; Elasticsearch errors are logged, the user gets `503 SEARCH_UNAVAILABLE`. The text is only used in match queries (no `query_string`), 2–100 characters, pages at most 99 × 50. Index maintenance (`/api/admin/search/**`) is for admins. See docs/GLOBAL_SEARCH_IMPLEMENTATION.md §10. |
| Draft data in the browser | The guest details draft lives in `sessionStorage` (this tab only), holds names, contact and a coupon code, and is deleted once the booking is made. No payment data is ever stored in the browser. |

## 9c. AI assistant (Phase 11)

Design and tests: [AI_ASSISTANT.md](AI_ASSISTANT.md) §8.

| Rule | How |
|------|-----|
| The assistant reads as the user | The user's JWT travels to mcp-server-service with every tool call (`Authorization` header from the MCP transport context of that call) and on to the gateway. Ownership (`404` for someone else's booking), `gateway.role-paths` and every permission apply unchanged. The token is never sent to the model and never logged. |
| Tools are read-only and per role | mcp-server-service lists only the tools of the caller's roles and checks the role again on every call (`NOT_ALLOWED`). Cancel, pay and refund are not tools: they stay in the UI with its confirmation steps. |
| The MCP server is internal | No published port, no gateway route. Every request needs `X-MCP-Api-Key` (`MCP_SERVER_API_KEY`, ≥ 32 random characters, constant-time compare) and, for data, a valid JWT (JWKS, issuer, expiry, revocation). Ollama is published on 127.0.0.1 only; the speech server not at all. Neither has authentication: keep them in the private network in production. |
| No invented data | The grounding check replaces an answer that names a booking reference, ticket number, PNR / code, e-ticket number or amount not returned by this conversation's tools (references the user typed may be repeated). It runs before any text reaches the browser. |
| Downstream errors leak nothing | 401, 403 and 404 all become "Nothing was found, or you are not allowed to see it." Argument errors use our own text, never the input. |
| Prompt injection | Read-only tools, the user's own token and no staff tools for customers; the system prompt tells the model to ignore instructions in questions and data. |
| Limits | Message ≤ 2000 characters; one answer at a time per user (`409`); gateway rate limits (chat: burst 3, then 1 per 10 s); at most 4 tool calls per question; timeouts on every hop (MCP 25 s; gateway calls 2 s connect / 8 s read with one retry and a circuit breaker; model 150 s to the first token, 240 s in total). |
| Logs | No question, answer, tool argument or tool result in the logs (conversation id, role, tool, outcome and durations only). |
| Memory | Conversations in Redis, 24 h after the last message, last 20 messages, owner checked (`404` for anyone else). Audio is never stored. |
| Voice uploads | ≤ 5 MB and ≤ 60 s, format detected from the bytes (anything else `415`), passed on to the internal speech server. |
| Answers are text, never markup | The web app renders answers as plain text (line breaks, simple lists, bold): no HTML, no Markdown links and no auto-linked addresses, so an invented or injected URL is never clickable. `dangerouslySetInnerHTML` is not used. |
| Conversation id in the browser | Only the id, in `sessionStorage` per tab and user; message text is never stored in the browser. Cleared on sign-out and account switch; the server checks the owner anyway (`404`). |
| Microphone | Used only after a tap on the microphone button, with a visible recording indicator and timer. Recording stops at the server's limits, after a pause, on Cancel and when the panel closes, and the tracks are released at once. "Voice conversation" never listens by itself: one tap per question. Audio goes to our own speech server through the gateway (with the user's token); with the browser fallback, the panel says that the browser's speech service may send the audio to its provider (Chrome: Google). |

## 10. Rate limits (gateway, Redis)

| Route | Limit per user (or IP) and route |
|-------|---------------------|
| `/api/auth/**` (login, register, password reset, ...) | 2 requests/s, burst 10 |
| `/api/auth/refresh`, `/api/auth/logout` | default: they need the HttpOnly cookie, and every page load and tab calls refresh |
| `/api/realtime/**` | 1 connection/s, burst 5 |
| `/api/assistant/chat` (Phase 11) | 10 tokens per question, 1 token/s, burst 30: 3 questions, then one every 10 s |
| `/api/assistant/**` (Phase 11) | 2 requests/s, burst 10 |
| everything else (the default) | 20 requests/s, burst 40 |

**Buckets.** The Redis key of Spring Cloud Gateway's `RedisRateLimiter` includes the route id, so every route has its
own bucket per user (or IP). The default 20/s, burst 40 therefore counts per user **and** route. A route with its own
limit (`/api/auth/**`, `/api/realtime/**`, `/api/assistant/chat`, `/api/assistant/**`) carries the metadata
`own-rate-limit: true`: there the default
filter's key resolver (`defaultLimitKeyResolver`, `RateLimitConfig`) returns no key and, with `deny-empty-key: false`,
the default limit steps aside. Before this fix (Phase 11) both limiters ran on such a route, with the route's
settings and on the same bucket, so every request was charged twice: login bursts of 5 instead of 10, one assistant
question instead of 3. `GatewayRateLimitIntegrationTest` proves the limits with a real Redis.

**Client IP** (rate limits, login history, audit logs). nginx is the edge: it **overwrites** `X-Forwarded-For` with
the real peer, so a browser cannot forge it. The gateway only believes `X-Forwarded-*` from
`spring.cloud.gateway.server.webflux.trusted-proxies` (`GATEWAY_TRUSTED_PROXIES`, default loopback + private
networks; in production set it to the load balancer's subnet) and passes it on to the services, which read it with
`server.forward-headers-strategy=framework`. Services must never be reachable except through the gateway.

## 10a. Frontend

- The access token is kept **in memory only** (never `localStorage`); a reload restores the session through the
  refresh cookie. Tabs share login/logout signals over a `BroadcastChannel`, never tokens.
- Only a 401/403 from `/api/auth/refresh` ends the session in the browser; offline, 429 and 5xx are retried briefly.
- Route guards (`RequireAuth`, `RequireRole`) only shape the UI. The APIs enforce every rule again.
- `?redirect=` after login only accepts same-site paths (`safeRedirect`), never another site or the auth pages.
- On logout the app leaves protected pages first, then clears the session and every cached user query.

**Data export (CSV, Excel, PDF, requested 2026-11-09).** The files are made in the browser from rows the API has already
returned, so no new endpoint and no new access rule exist:
- **Access.** "All matching rows" pages through the **same list API** the screen uses, with the same filters. The
  server's role, permission and ownership checks therefore decide what an export contains: a manager gets only
  assigned hotels, a customer only their own bookings, and an admin page needs its usual permission. The UI only adds
  the button where the list already is.
- **Size.** At most 10,000 rows, refused before anything is loaded, and 2,000 rows for a PDF. Requests follow the
  server's page size and the gateway's rate limit: they wait and retry on `429` and can be cancelled.
- **Injection.**
  - CSV: text starting with `= + - @` (after trimming) gets a leading `'`, so a spreadsheet never runs it as a
    formula.
  - Excel: strings are inline strings, never formulas.
  - PDF: text is drawn as text.
  - Control characters are removed from the XML.
- **Columns.** Only what the screen shows, with no internal ids, notes, tokens or gateway ids.
- **Personal data.** Lists of people show a reminder in the menu to keep the file safe. The file says who exported it,
  when, and with which filters.
- **Not yet.** Web exports are not written to the audit log, because the browser has no audit endpoint. An
  `EXPORT_CREATED` audit event (screen, format, rows, filters; no personal data) is a follow-up that needs a small
  backend endpoint. Background exports of the audit log (below) are audited.

**Background exports of the audit log (requested 2026-11-09).** Above 10,000 entries the Audit logs page asks
reporting-service to write the file ([API_DOCUMENTATION.md](API_DOCUMENTATION.md) §11.1):
- **Access.** Asking, listing, cancelling and getting a link need role `ADMIN` (the same check as the list), and an
  admin only ever sees their own exports: another admin's export answers `404`. Asking and downloading are recorded in
  the audit log (`AUDIT_LOG_EXPORT_REQUESTED`, `AUDIT_LOG_EXPORT_DOWNLOADED`: format, rows, filters; no personal data).
- **Download link.** A file can be a gigabyte, so the browser's download manager fetches it, and it cannot send the
  access token. The admin gets a link with a random 256-bit token: only its SHA-256 is stored, it works **once** and
  for **60 seconds**, and it is cleared when used. `GET /api/public/export-files/{id}?token=…` needs no login (the token
  is the permission); anything wrong is `404`, the answer is `Cache-Control: no-store`. A token in a URL can end up in
  a proxy log, which is why it is single-use and short-lived.
- **Files.** Stored like documents (`FileStorage`: a private, encrypted S3 bucket in production, never public), deleted
  after 24 hours, or at once when the admin removes the export. Work files on local disk are always deleted.
- **Load.** At most 2 unfinished exports per admin and 2 running per instance. Entries are read in short keyset
  batches (no long transaction, no deep `OFFSET`), so an export of millions of entries never blocks the audit trail.
- **Injection.** As above: inline strings in Excel, the formula guard in CSV, control characters removed.

## 11. Configuration rules

- Secrets only in `.env` (git-ignored) or environment variables / secrets manager; never in `application.yml`.
- `prod` profile forces `identity.cookie.secure=true`, disables demo users and Swagger UI.
- **Demo users** (`DEMO_USERS_ENABLED=true`, local only) create `admin@`, `customer@`, `manager@` and
  `support@flighthotel.local` with `DEMO_USER_PASSWORD`. Existing accounts are never modified.

## 11a. Security checks (Phase 10)

The checks below are repeatable. How to run them is in TESTING_GUIDE.md §7.

- **Endpoint access matrix** (`tests/security/endpoints.mjs`) reads every operation from the services' OpenAPI documents
  (159) and calls each one through the gateway:
  - without a token: every non-public operation must answer `401`;
  - as customer, hotel manager and support agent: each staff area must answer `403` to roles that don't belong there.
- **Live checks** (`tests/security/checks.mjs`, `auth-extra.mjs`):
  - another customer's bookings, documents, payments, tickets, passengers and notifications → `404`;
  - forged, `alg: none` and HS256-confused tokens → `401`;
  - logout revokes the access token;
  - refresh cookie flags, CSRF header and Origin checks; refresh-token reuse ends the session after the 30 s grace;
  - lockout after 5 failures; no account enumeration on login, register and forgot-password;
  - uploads: text, HTML, SVG or an executable disguised as an image → `422`; > 2 MB → `413`; a real image is
    re-encoded and its metadata removed;
  - downloads: `attachment`, `no-store`, `nosniff`;
  - SQL/sort injection → `400` or empty results, never `5xx`;
  - HTML in tickets and names stays text in e-mails;
  - security headers; actuator endpoints closed;
  - passport numbers encrypted at rest.
- **Logs** (`tests/security/logscan.mjs`): no `.env` secret, JWT, refresh cookie, password, passport number, payment
  signature or e-mail-link token in any container log.
  - Phase 10 found that nginx logged `/verify-email?token=…` and `/reset-password?token=…`, also in the `Referer` of
    the page's asset requests. The access log now drops every query string (`log_format fh_no_query`).
- **Dependencies**:
  - `npm audit --omit=dev` must report 0;
  - Trivy scans every image (OS packages and Java libraries);
  - gitleaks scans the working tree for secrets.
  - Fixed in Phase 10: newer `lz4-java`, `snappy-java` and `guava` (root `pom.xml`); OS security updates in both
    Dockerfiles; a newer `minimatch` (lint toolchain only, `overrides` in `frontend/package.json`).

## 11b. Kubernetes and the delivery pipeline

Details in [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md) §8 and [docs/CI_CD.md](docs/CI_CD.md).

- **Pods**:
  - Pod Security `restricted` in the application namespace;
  - non-root (uid 999; nginx uid 101), read-only root filesystem, all Linux capabilities dropped, no privilege
    escalation, `seccompProfile: RuntimeDefault`;
  - no service-account token mounted.
- **Network**:
  - default deny in both namespaces, then only the needed paths (gateway → edge pods, service → service,
    services → data);
  - internet egress only on 443/587, and never to private address ranges;
  - the data services accept connections only from the application namespace.
- **Secrets**:
  - one Kubernetes Secret, created from `.env` by a script that prints nothing; never in Git or in a values file;
  - each pod reads only the keys it lists;
  - on EKS: AWS Secrets Manager through External Secrets.
- **Supply chain**:
  - CD scans each image (Trivy) before it is pushed;
  - attaches an SBOM and SLSA provenance;
  - signs the image keyless with cosign;
  - CI blocks HIGH/CRITICAL misconfigurations in the rendered manifests.
- **No cluster credentials in GitHub**: GitOps means Argo CD pulls from Git. The Argo CD projects limit which
  namespaces and cluster-wide kinds the applications may touch.

## 12. Checklist for a new endpoint

- [ ] Protected by default? If public: added to the service's **and** the gateway's public paths, and it reveals
      nothing about other users.
- [ ] `@PreAuthorize` on the service method for role/permission rules.
- [ ] Resources looked up by `id AND owner` (or an explicit "any" permission); 404 for someone else's.
- [ ] Request DTO validated (`@Valid`, sizes, patterns); no entity returned directly.
- [ ] Nothing sensitive in logs, audit `details`, events or error messages.
- [ ] Integration test for 401 (no token), 403 (wrong role) and the owner/other-user case.
- [ ] A new staff area (`/api/<area>/**` for staff only) is added to `gateway.role-paths`.
- [ ] Run `node tests/security/endpoints.mjs` against the Docker stack after adding endpoints.
- [ ] A new assistant tool is read-only, validates its arguments, returns only the fields needed (no secrets, passport
      numbers masked), lists its roles, and is added to mcp-server-service's `EndpointSecurityTest`.
