# API Documentation

> Covers the APIs built so far (Phases 2–11). Every service also publishes live OpenAPI docs:
> **http://localhost:8080/swagger-ui.html** (all services, through the gateway).

## 1. Conventions

| Topic | Rule |
|-------|------|
| Base URL | Browser → `/api/...` on the same origin (nginx or Vite forwards to the gateway on :8080) |
| Auth | `Authorization: Bearer <accessToken>` (JWT, 15 min). Refresh with the HttpOnly cookie `fh_refresh` (see §2.5). |
| JSON | `camelCase`. Dates `YYYY-MM-DD`, timestamps ISO-8601 UTC (`2026-11-03T10:15:30Z`). |
| Lists | `?page=0&size=20&sort=createdAt,desc` → `{ content: [], page, size, totalElements, totalPages }` |
| Errors | RFC 9457 Problem Details (below). Branch on `code`, show `detail`. |
| Correlation | Every response has `X-Correlation-Id`. Show it as "support reference" on error screens. |
| CSRF | Cookie-based calls (`/api/auth/refresh`, `/api/auth/logout`) need header `X-Requested-With: XMLHttpRequest`. |
| Staff areas | `/api/admin/**` (admins, support agents), `/api/hotel-manager/**` (hotel managers, admins), `/api/support/bookings/**` (support agents, admins). Any other signed-in role gets `403` from the gateway itself, with an empty body (Phase 10). Inside its area, each endpoint still checks its exact permission (`403 FORBIDDEN` Problem Details). The assistant (`/api/assistant/**`, §15, Phase 11) is open to every signed-in role; what it can read is decided by the tools of the role and the user's own token. |

### Error format

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Some fields are invalid",
  "code": "VALIDATION_FAILED",
  "correlationId": "5f0c2a8e-...",
  "timestamp": "2026-11-03T10:15:30Z",
  "errors": [ { "field": "email", "message": "must be a well-formed email address" } ],
  "details": { }
}
```

| Status | Typical codes |
|--------|---------------|
| 400 | `VALIDATION_FAILED`, `INVALID_OR_EXPIRED_TOKEN`, `INVALID_STAY` (`details.field`), `BAD_REQUEST`, `INVALID_RANGE`, `INVALID_INTERVAL` |
| 401 | `UNAUTHORIZED` (missing/expired/revoked access token), `INVALID_CREDENTIALS`, `SESSION_EXPIRED` |
| 403 | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`, `CSRF_CHECK_FAILED`, `HOTEL_NOT_ASSIGNED`, `PORTAL_NOT_ALLOWED` (`details.portals`) |
| 404 | `<RESOURCE>_NOT_FOUND`, e.g. `PASSENGER_NOT_FOUND` |
| 409 | `EMAIL_ALREADY_REGISTERED`, `CONCURRENT_MODIFICATION`, `DATA_CONFLICT`, `ROOMS_NOT_AVAILABLE`, `INVENTORY_BELOW_RESERVED`, `BOOKING_NOT_CANCELLABLE`, `CANCELLATION_QUOTE_CHANGED` |
| 413 | `FILE_TOO_LARGE` |
| 422 | `WEAK_PASSWORD`, `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_UNCHANGED`, `INVALID_IMAGE`, `PASSENGER_LIMIT_REACHED`, `PASSPORT_DETAILS_INCOMPLETE`, `CANNOT_CHANGE_OWN_ACCOUNT`, `UNKNOWN_ROLE`, `INVALID_STATUS`, `ROOM_TOO_SMALL`, `HOTEL_NOT_READY`, `UNKNOWN_AMENITY`, `NOT_A_HOTEL_MANAGER`, `MANAGER_NOT_FOUND`, `INVALID_DATE_RANGE` |
| 423 | `ACCOUNT_LOCKED` (`details.lockedUntil`) |
| 429 | Rate limit exceeded (gateway) |

### Password rules (backend `PasswordPolicy`, mirrored in the frontend)

10–64 characters · at least one letter · at least one digit · not the same as the email · not a commonly used
password · at most 72 bytes in UTF-8 (BCrypt limit). Violations → `422 WEAK_PASSWORD` with `details.rules`.

---

## 2. Authentication: `/api/auth` (identity-service, public)

### 2.1 Register: `POST /api/auth/register` → `202`

```json
{ "email": "asha@example.com", "password": "Travel2026!", "firstName": "Asha", "lastName": "Rao",
  "phone": "+919876543210", "acceptTerms": true }
```
`phone` is optional (`^\+?[0-9]{7,15}$`). Names: letters, spaces, `.`, `'`, `-`, max 80.
Response (always the same, so nobody can find out which emails are registered):
```json
{ "message": "If this email can be used, we have sent a verification link to it." }
```
A verification email (valid 24 h) is sent. If the email already belongs to a verified account, that owner gets an
"you already have an account" email instead.

### 2.2 Verify email: `POST /api/auth/verify-email` → `200`
`{ "token": "<token from the email link /verify-email?token=...>" }` → `{ "message": "Email verified. You can log in now." }`
Errors: `400 INVALID_OR_EXPIRED_TOKEN`.

### 2.3 Resend verification: `POST /api/auth/resend-verification` → `202`
`{ "email": "asha@example.com" }` → generic `{ "message": ... }`.

### 2.4 Login: `POST /api/auth/login` → `200`

```json
{ "email": "asha@example.com", "password": "Travel2026!", "rememberMe": true }
```
`rememberMe` is optional (default `false`). Response body = **AuthResponse**, plus `Set-Cookie: fh_refresh=...; HttpOnly; SameSite=Strict; Path=/api/auth`
(persistent 30 days with `rememberMe`, otherwise a session cookie valid up to 1 day).

```json
{
  "accessToken": "eyJraWQiOi...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "0192f0c4-8a7e-7c3a-9f1e-3b7f1c2d4e5a",
    "email": "asha@example.com",
    "firstName": "Asha",
    "lastName": "Rao",
    "roles": ["CUSTOMER"],
    "permissions": [],
    "emailVerified": true,
    "hasPhoto": false
  }
}
```
Errors: `401 INVALID_CREDENTIALS` (wrong email or password, same message for both), `403 EMAIL_NOT_VERIFIED`,
`403 ACCOUNT_DISABLED`, `423 ACCOUNT_LOCKED` (5 failed attempts → locked 15 minutes, `details.lockedUntil`).

**Sign-in per portal (Phase 11).** The body may also carry `"portal": "CUSTOMER" | "ADMIN" | "HOTEL_MANAGER" | "SUPPORT"`
(the sign-in page used). Without it, any role may log in, as before. Another value → `400 VALIDATION_FAILED` (field
`portal`).

| `portal` | Page | Roles admitted |
|----------|------|----------------|
| `CUSTOMER` | `/customer/login` | `CUSTOMER` |
| `ADMIN` | `/admin/login` | `ADMIN` |
| `HOTEL_MANAGER` | `/hotel-manager/login` | `HOTEL_MANAGER`, `ADMIN` |
| `SUPPORT` | `/support/login` | `SUPPORT_AGENT`, `ADMIN` |

A wrong password, the lockout, `EMAIL_NOT_VERIFIED` and `ACCOUNT_DISABLED` come first and are unchanged. Only after the
right password, an account without an admitted role gets `403 PORTAL_NOT_ALLOWED` with `details.portals` (the portals
the account may use, in the order of the table, e.g. `["CUSTOMER"]`): no tokens, no cookie, no failed attempt, but a
login history entry (`failureReason: PORTAL_NOT_ALLOWED`, §3.4) and an audit entry (`LOGIN_PORTAL_REFUSED`, details
`portal`, `roles`). `/api/auth/refresh` takes no portal.

### 2.5 Refresh: `POST /api/auth/refresh` → `200`
No body. Sends the `fh_refresh` cookie + header `X-Requested-With: XMLHttpRequest`. Returns **AuthResponse** and a new
rotated cookie. Call it on app start (to restore the session after a reload) and when an API call returns 401.
Errors: `401 SESSION_EXPIRED` → show login. `403 CSRF_CHECK_FAILED` if the header is missing.
Concurrent refreshes from several tabs within 30 s are allowed (the late tab gets an access token without a new cookie).
Re-using an old refresh token after that ends the whole session (token theft protection).

### 2.6 Logout: `POST /api/auth/logout` → `204`
Cookie + `X-Requested-With` header (+ bearer token if available, which is revoked immediately). Clears the cookie.

### 2.7 Forgot password: `POST /api/auth/forgot-password` → `202`
`{ "email": "asha@example.com" }` → generic message. A reset link (`/reset-password?token=...`, valid 1 h) is emailed if
the account exists and is active.

### 2.8 Reset password: `POST /api/auth/reset-password` → `200`
`{ "token": "...", "newPassword": "NewTravel2026!" }` → `{ "message": "Password changed. Please log in." }`.
Also used by new staff accounts ("set your password" invitation link `/reset-password?token=...&invite=1`, valid 72 h).
Since Phase 11 the invitation link also names the account's sign-in page: `&portal=admin|hotel-manager|support` (an
account with several staff roles gets the first of admin, hotel manager, support). Password reset links (§2.7) are
unchanged.
Logs the user out everywhere. Errors: `400 INVALID_OR_EXPIRED_TOKEN`, `422 WEAK_PASSWORD`.

### 2.9 Public keys: `GET /.well-known/jwks.json`
JSON Web Key Set used by the gateway and services to verify tokens.

### Access token claims

| Claim | Example | Meaning |
|-------|---------|---------|
| `sub` | user id | |
| `email`, `given_name` | | |
| `roles` | `["CUSTOMER"]` | `CUSTOMER`, `ADMIN`, `HOTEL_MANAGER`, `SUPPORT_AGENT` |
| `permissions` | `["BOOKING_READ_ANY"]` | fine-grained rights of the roles |
| `sid` | session id | refresh-token family |
| `iss`, `iat`, `exp`, `jti` | | standard |

---

## 3. My account: `/api/customers` (identity-service, any logged-in user)

### 3.1 Profile
| Method & path | Body | Response |
|---------------|------|----------|
| `GET /api/customers/profile` | | **Profile** |
| `PUT /api/customers/profile` | `{ firstName, lastName, phone?, dateOfBirth?, nationality? }` | **Profile** |
| `PUT /api/customers/profile/photo` | `multipart/form-data`, part `file`: JPEG or PNG, max 2 MB | **Profile** |
| `GET /api/customers/profile/photo` | | `image/jpeg` (404 `PROFILE_PHOTO_NOT_FOUND` if none). Load with the bearer token as a blob. |
| `DELETE /api/customers/profile/photo` | | `204` |

**Profile**
```json
{ "id": "...", "email": "asha@example.com", "firstName": "Asha", "lastName": "Rao", "phone": "+919876543210",
  "dateOfBirth": "1994-05-17", "nationality": "IN", "roles": ["CUSTOMER"], "emailVerified": true,
  "hasPhoto": true, "memberSince": "2026-11-03T10:15:30Z" }
```
`nationality` = ISO 3166-1 alpha-2. Uploaded photos are checked by content (not by file name), resized to max
512 px and re-encoded (removes hidden metadata such as GPS location).

### 3.2 Saved passengers (max 20)
| Method & path | Response |
|---------------|----------|
| `GET /api/customers/passengers` | `Passenger[]` |
| `POST /api/customers/passengers` | `201 Passenger` |
| `PUT /api/customers/passengers/{id}` | `Passenger` |
| `DELETE /api/customers/passengers/{id}` | `204` |

Request:
```json
{ "passengerType": "ADULT", "firstName": "Asha", "lastName": "Rao", "dateOfBirth": "1994-05-17",
  "gender": "FEMALE", "nationality": "IN",
  "passportNumber": "Z1234567", "passportExpiry": "2031-01-31", "passportCountry": "IN",
  "removePassport": false }
```
- `passengerType`: `ADULT | CHILD | INFANT`; `gender`: `MALE | FEMALE | OTHER` (optional)
- Passport fields are optional. If `passportNumber` is sent, `passportExpiry` (future date) and `passportCountry` are
  required (`422 PASSPORT_DETAILS_INCOMPLETE`). `passportNumber`: `^[A-Z0-9]{5,20}$`.
- On **PUT**, leaving `passportNumber` empty keeps the stored passport; `removePassport: true` deletes it.

Response, where the passport number is **never returned in full**:
```json
{ "id": "...", "passengerType": "ADULT", "firstName": "Asha", "lastName": "Rao", "dateOfBirth": "1994-05-17",
  "gender": "FEMALE", "nationality": "IN", "hasPassport": true, "passportNumberMasked": "••••4567",
  "passportExpiry": "2031-01-31", "passportCountry": "IN" }
```

### 3.3 Travel preferences
`GET /api/customers/preferences`, `PUT /api/customers/preferences`:
```json
{ "preferredCabin": "ECONOMY", "homeAirport": "BLR", "seatPreference": "WINDOW", "mealPreference": "VEGETARIAN",
  "preferredCurrency": "INR", "newsletterOptIn": false }
```
`preferredCabin`: `ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST` (optional) · `seatPreference`: `WINDOW | AISLE | NO_PREFERENCE`
· `mealPreference`: `NO_PREFERENCE | STANDARD | VEGETARIAN | VEGAN | JAIN | HALAL | KOSHER | DIABETIC`
· `homeAirport`: IATA code `^[A-Z]{3}$` (optional) · `preferredCurrency`: `INR` (v1).

### 3.4 Security
| Method & path | Body | Response |
|---------------|------|----------|
| `POST /api/customers/security/change-password` | `{ currentPassword, newPassword }` | **AuthResponse** (new access token; all *other* sessions are logged out) |
| `POST /api/customers/security/logout-all` | | `204`, clears the cookie, ends every session incl. this one |
| `GET /api/customers/security/login-history?page=0&size=10` | | `Page<{ occurredAt, success, failureReason, ipAddress, userAgent }>` newest first |

---

## 4. Admin: users `/api/admin/users` (identity-service, role `ADMIN`)

| Method & path | Body | Response |
|---------------|------|----------|
| `GET /api/admin/users?search=&role=&status=&page=&size=&sort=` | | `Page<AdminUser>` (`search` matches email/name) |
| `GET /api/admin/users/{id}` | | `AdminUser` |
| `POST /api/admin/users` | `{ email, firstName, lastName, roles: ["HOTEL_MANAGER"] }` | `201 AdminUser`; the person gets a "set your password" email |
| `PATCH /api/admin/users/{id}/status` | `{ status: "ACTIVE" \| "DEACTIVATED", reason }` | `AdminUser`; deactivation ends all sessions immediately |
| `PUT /api/admin/users/{id}/roles` | `{ roles: ["ADMIN"] }` | `AdminUser` |

**AdminUser**: `{ id, email, firstName, lastName, status, roles, emailVerified, lastLoginAt, createdAt }`.
`status`: `PENDING_VERIFICATION | ACTIVE | DEACTIVATED`. Admins cannot deactivate themselves or remove their own
`ADMIN` role (`422 CANNOT_CHANGE_OWN_ACCOUNT`).

## 5. Hotels: `/api/hotels` (hotel-service, public)

All prices are in INR. **Price per night** = per room, before taxes. **Total** = all nights × rooms + GST.
GST per room per night: 5 % up to ₹7,500, 18 % above (System Settings `hotel.gst.*`). Listings with `demo: true` are
labelled sample data.

### 5.1 Search: `GET /api/hotels/search`

| Parameter | Notes |
|-----------|-------|
| `destination` | City or hotel name (2–100 characters, typos tolerated) |
| `checkIn`, `checkOut` | `YYYY-MM-DD`; check-in today or later, 1–30 nights, at most 365 days ahead |
| `rooms` (1–8), `adults` (≥ rooms), `children`, `childAges` | `childAges=4,9` is required when `children > 0` |
| `minPrice`, `maxPrice` | per night |
| `stars=4,5`, `minGuestRating=4.5`, `amenities=POOL,SPA` (all must match), `propertyTypes=RESORT,VILLA` | |
| `freeCancellation=true`, `breakfastIncluded=true` | an available offer must have it |
| `maxDistanceKm` | from the destination's city centre (only when the destination is a known city) |
| `availableOnly` | default `true`; `false` also lists hotels without a free room (`available: false`) |
| `sort` | `RECOMMENDED`, `PRICE_ASC`, `PRICE_DESC`, `RATING_DESC`, `STARS_DESC`, `DISTANCE_ASC` |
| `page`, `size` (≤ 50) | |

Response: `{ content: [HotelCard], page, size, totalElements, totalPages, nights,
destination: { query, city, distanceFrom, latitude, longitude }, facets: { minPrice, maxPrice, stars, propertyTypes } }`

**HotelCard**: `id, slug, name, propertyType, starRating, guestRating, reviewCount, addressLine, city, countryCode,
latitude, longitude, imageUrl, amenities[], available, availableRoomTypes, cheapestRoomType, pricePerNight, totalPrice,
currency, freeCancellation, breakfastIncluded, distanceKm, demo`. Errors: `400 INVALID_STAY` (`details.field`).

Elasticsearch filters the catalogue; availability and prices always come from MySQL for the exact stay.

### 5.2 Details, rooms, helpers

| Method & path | Response |
|---------------|----------|
| `GET /api/hotels/{idOrSlug}` | Hotel details: description, amenities, `policies`, `images`, `roomTypes`, check-in/out times, location, `nearby` landmarks with distances, `demo`. `404 HOTEL_NOT_FOUND` for unknown or unpublished hotels. |
| `GET /api/hotels/{hotelId}/rooms?checkIn&checkOut&rooms&adults&children&childAges` | Every room type on sale: `fitsParty`, `freeRooms`, `available`, and per rate plan `pricePerNight, subtotal, taxes, total, nights[{date, price, season}], breakfastIncluded, freeCancellation, freeCancellationUntil, cancellationPolicy` (plain text) |
| `GET /api/hotels/destinations?q=go` | `[{ city, countryCode, hotels }]` (cities with published hotels) |
| `GET /api/hotels/amenities` | `[{ code, name, category: HOTEL \| ROOM }]` |
| `GET /api/hotels/images/{imageId}[?size=thumb]` | JPEG (1600 px or 480 px), cacheable for 30 days |

### 5.3 Quote: `POST /api/hotels/availability` → `201`

Re-checks availability and price for one room type + rate plan ("revalidate" step). Nothing is reserved yet.

```json
{ "hotelId": "...", "roomTypeId": "...", "ratePlanId": "...",
  "stay": { "checkIn": "2027-01-10", "checkOut": "2027-01-12", "rooms": 1, "adults": 2, "children": 0, "childAges": [] } }
```

Response **Quote** (kept 15 minutes, `GET /api/hotels/quotes/{quoteId}`, then `404`): `quoteId, expiresAt, hotel…,
roomTypeName, ratePlanName, breakfastIncluded, checkIn, checkOut, nights, rooms, adults, children, nightlyPrices[],
subtotal, taxes, taxLines[{label: "GST 5%", ratePercent, amount}], total, currency, refundable, freeCancellation,
freeCancellationUntil, cancellationFeePercent, cancellationPolicy, demo`. Booking (§8) holds the rooms against it.
Errors: `409 ROOMS_NOT_AVAILABLE`, `422 ROOM_TOO_SMALL`, `404 ROOM_TYPE_NOT_FOUND` / `RATE_PLAN_NOT_FOUND`.

## 5a. Flights: `/api/flights`, `/api/airports` (flight-service, public)

All inventory comes from the **DEMO provider** (labelled `demo: true`, shown as "Demo inventory"). Times are local to
the airport (`2027-01-10T06:45`), durations in minutes, amounts in rupees (`currency`). Offers live in Redis for 20 minutes.

| Method & path | Response |
|---------------|----------|
| `GET /api/airports/search?q=del&limit=8` | `[{ iataCode, name, city, countryCode, label }]` (code, city or name; best matches first) |
| `GET /api/airports` | every airport, sorted by city then code (same fields); used by global search for destinations |
| `GET /api/flights/airlines` | `[{ code, name }]` |
| `GET /api/flights/popular-routes` | `[{ origin: Airport, destination: Airport, fromPrice, currency }]` (home page widget) |

### 5a.1 Search: `GET /api/flights/search`

| Parameter | Notes |
|-----------|-------|
| `origin`, `destination` | IATA codes (`DEL`, `BOM`), different |
| `departureDate`, `returnDate` | `YYYY-MM-DD`; today or later, at most 330 days ahead; `returnDate` (optional) makes it a round trip and must not be before `departureDate` |
| `adults` (1–9), `children` (0–8), `infants` (0…adults), `cabin` | `ECONOMY` (default), `PREMIUM_ECONOMY`, `BUSINESS`, `FIRST`; at most 9 travellers with a seat |
| filters | `airlines=AI,6E`, `maxStops=0`, `maxPrice` (whole trip for all passengers, one direction), `refundable=true\|false`, `departAfter`/`departBefore`/`arriveAfter`/`arriveBefore` (`HH:mm`, local), `maxDurationMinutes` |
| `sort` | `PRICE_ASC` (default), `DURATION_ASC`, `DEPARTURE_ASC`, `ARRIVAL_ASC` |

```json
{ "tripType": "ONE_WAY | ROUND_TRIP", "cabin": "ECONOMY", "demo": true,
  "passengers": { "adults": 1, "children": 0, "infants": 0 },
  "outbound": { "origin": Airport, "destination": Airport, "date": "2027-01-10", "totalOptions": 14, "options": [FlightOption] },
  "inbound": null,
  "facets": { "minPrice": 0, "maxPrice": 0, "airlines": [{ "code": "AI", "name": "Air India", "count": 3, "minPrice": 0 }],
              "stops": [{ "stops": 0, "count": 9 }], "refundable": { "yes": 7, "no": 7 } } }
```
`Airport` = `{ iataCode, name, city, countryCode }`. **FlightOption** = `{ offerId, provider, demo, airline: { code, name },
flightNumber, origin: Airport, destination: Airport, departureLocal, arrivalLocal, durationMinutes, stops, viaAirport,
segments: [{ flightNumber, origin, destination, departureLocal, arrivalLocal, durationMinutes }], cabin, fare: { name,
type: REFUNDABLE | NON_REFUNDABLE, refundable, checkedBaggageKg, cabinBaggageKg, cancellationFeePercent,
cancellationPolicy }, seatsLeft (capped at 9), pricePerAdult, totalPrice (all passengers incl. taxes), currency, expiresAt }`.
`facets` describe the unfiltered outbound options; a round trip also has `inboundFacets` (same shape, `null` for one-way).
Facets are counted over the unfiltered options. Errors: `400` (invalid codes, dates, passengers),
`503 FLIGHT_SEARCH_UNAVAILABLE` (no flight provider enabled or healthy: "temporarily unavailable", never stale data).

### 5a.2 Revalidate: `POST /api/flights/revalidate`

`{ "offerIds": ["<outbound offerId>", "<inbound offerId, round trip only>"] }`: re-prices every flight at today's fare and
checks the seats. Nothing is reserved. Answers **TripOffer** (also `GET /api/flights/trips/{tripOfferId}`, kept 20 minutes, then `404 OFFER_EXPIRED`):

```json
{ "tripOfferId": "...", "expiresAt": "...", "tripType": "ROUND_TRIP", "cabin": "ECONOMY", "provider": "DEMO", "demo": true,
  "title": "Delhi to Mumbai", "international": false,
  "passengers": { "adults": 2, "children": 1, "infants": 0 },
  "slices": [ { "origin": Airport, "destination": Airport, "airline": { "code": "AI", "name": "Air India" }, "flightNumber": "AI 504",
                "departureLocal": "...", "arrivalLocal": "...", "durationMinutes": 130, "stops": 0, "viaAirport": null,
                "segments": [ ... ], "fare": { ...as in FlightOption } } ],
  "refundable": true, "checkedBaggageKg": 15, "cabinBaggageKg": 7, "cancellationPolicy": "...",
  "priceLines": [ { "label": "Fare · 2 adults", "amount": 0 } ], "subtotal": 0, "taxes": 0, "total": 0, "currency": "INR",
  "priceChanged": false, "previousTotal": null }
```
`priceChanged: true` with `previousTotal` when today's price differs from the search result: the customer must accept the new price.
Errors: `404 OFFER_EXPIRED`, `409 SOLD_OUT` (not enough seats), `422 INVALID_OFFERS` (wrong order, different passengers or cabin, wrong dates).

## 6. Hotel manager: `/api/hotel-manager/hotels` (hotel-service)

`HOTEL_MANAGER`: only hotels assigned to them (`403 HOTEL_NOT_ASSIGNED` otherwise). `ADMIN`: every hotel. Every
update sends the `version` it edited (`409 CONCURRENT_MODIFICATION` if someone saved meanwhile).

| Method & path | Body / notes |
|---------------|--------------|
| `GET /` | My hotels: `[{ id, name, slug, city, status, dataSource, starRating, imageUrl, roomTypes, totalRooms (rooms of the active room types), managers, updatedAt }]` |
| `GET /{hotelId}`, `PUT /{hotelId}` | Profile: name, description, propertyType, starRating, address, city, state, countryCode, postalCode, latitude + longitude (both or neither), checkInTime, checkOutTime, contactEmail, contactPhone, `amenities` (codes), `policies[{type, description}]`, `version`. `422 UNKNOWN_AMENITY` |
| `POST /{hotelId}/images` | multipart `file` (JPEG/PNG, ≤ 5 MB), optional `caption`, `roomTypeId`. Re-encoded; the first hotel photo becomes the cover. Max 40. |
| `PATCH /{hotelId}/images/{imageId}` | `{ caption?, cover?, sortOrder?, roomTypeId?, clearRoomType? }` (one cover per hotel) |
| `DELETE /{hotelId}/images/{imageId}` | `204` |
| `GET /{hotelId}/room-types` | Room types with their rate plans and seasonal prices |
| `POST /{hotelId}/room-types`, `PUT /{hotelId}/room-types/{id}` | `{ name, description?, maxAdults, maxChildren, bedConfiguration, sizeSqm?, totalRooms, status: ACTIVE\|INACTIVE, sortOrder, amenities, version? }`. A new room type gets 365 nights of inventory; a new `totalRooms` applies to all future nights (`409 INVENTORY_BELOW_RESERVED` if more are booked/held). Not deletable: set `INACTIVE`. |
| `POST …/room-types/{id}/rate-plans`, `PUT …/rate-plans/{planId}` | `{ name, basePricePerNight, breakfastIncluded, refundable, freeCancellationHours?, cancellationFeePercent?, status, version? }`. Refundable: free until N hours before check-in, then the fee %. Non-refundable: 100 %. |
| `POST …/rate-plans/{planId}/seasonal-rates`, `DELETE …/seasonal-rates/{id}` | `{ label, startDate, endDate (inclusive), pricePerNight, priority }`: replaces the base price on those nights; higher priority wins on overlap |
| `GET /{hotelId}/inventory?from&to` | ≤ 93 days: per room type and night `totalRooms, bookedRooms, heldRooms, freeRooms, stopSell, price` (lowest plan price that night) |
| `PUT /{hotelId}/inventory` | `{ roomTypeId, from, to, totalRooms?, stopSell? }` for nights today … 365 days ahead. `409 INVENTORY_BELOW_RESERVED` lists the nights (`details.nights`). Open calendars refresh live (`hotel.inventory-changed`). |

## 7. Admin: hotels `/api/admin/hotels` (hotel-service, role `ADMIN`)

| Method & path | Body / notes |
|---------------|--------------|
| `GET /?search=&status=&page=&size=` | Page of hotel summaries (search by name or city) |
| `POST /` | `{ name, propertyType, addressLine, city, countryCode, starRating? }` → `201`, status `DRAFT` |
| `PATCH /{hotelId}/status` | `{ status: ACTIVE \| INACTIVE }`. Publishing needs a room type with a plan on sale, the map location, a description and a cover photo (`422 HOTEL_NOT_READY`, `details.missing`). |
| `GET /{hotelId}/managers` | `[{ userId, email, firstName, lastName, assignedAt }]` |
| `POST /{hotelId}/managers` | `{ email }`: the account must have the `HOTEL_MANAGER` role (`422 NOT_A_HOTEL_MANAGER`, `MANAGER_NOT_FOUND`) |
| `DELETE /{hotelId}/managers/{userId}` | Removes the assignment (access ends immediately) |
| `POST /reindex` | Rebuilds the search index from the database (also automatic on startup when it is incomplete) |

## 8. Bookings and coupons: `/api/bookings`, `/api/coupons` (booking-service, any logged-in user)

A customer only sees their own bookings (`404 BOOKING_NOT_FOUND` for anyone else's); `BOOKING_READ_ANY` (support,
admin) may read any. State machine and saga: [BOOKING_WORKFLOW.md](BOOKING_WORKFLOW.md).

### 8.1 Book a hotel stay: `POST /api/bookings/hotel` → `202`

Header **`Idempotency-Key`** (required, 8–100 letters/digits/`-`/`_`): the same key for the same customer returns
the same booking (double click, retry after a timeout); the same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`.

```json
{ "quoteId": "...", "contact": { "email": "asha@example.com", "phone": "+91 98000 00000" },
  "guests": [ { "roomNo": 1, "firstName": "Asha", "lastName": "Rao" } ],
  "specialRequests": "Late arrival", "couponCode": "WELCOME10" }
```

Only the quote id, the guests (one per room, rooms numbered 1…n) and the contact come from the browser. The hotel, the
dates and **every price** come from hotel-service when it holds the rooms. The answer is `202` with the booking in
status `INITIATED` and a `Location` header; the rooms are held in the background, so poll `GET /{id}` (or listen to
`booking.status-changed`) until the status is `PENDING_PAYMENT` (pay) or `FAILED` (`failureReason`: `QUOTE_EXPIRED`,
`SOLD_OUT`, `PRICE_CHANGED`, `INVALID_GUESTS`, `NO_RESPONSE` when hotel-service did not answer within 10 minutes).
Errors: `400 IDEMPOTENCY_KEY_REQUIRED | INVALID_IDEMPOTENCY_KEY`, `422 INVALID_GUESTS`, `422 COUPON_*`
(`COUPON_NOT_FOUND`, `COUPON_EXPIRED`, `COUPON_NOT_APPLICABLE`, `COUPON_USAGE_LIMIT_REACHED`, `COUPON_ALREADY_USED`).

### 8.1a Book a flight: `POST /api/bookings/flight` → `202`

Same rules as 8.1 (`Idempotency-Key`, `202` + `Location`, follow the booking). Seats are held in the background;
`failureReason` for flights: `OFFER_EXPIRED`, `SOLD_OUT`, `PRICE_CHANGED`, `INVALID_PASSENGERS`, `NO_RESPONSE`.

```json
{ "tripOfferId": "...", "contact": { "email": "asha@example.com", "phone": "+91 98000 00000" },
  "passengers": [ { "passengerType": "ADULT", "firstName": "Asha", "lastName": "Rao", "dateOfBirth": "1990-04-02",
                    "gender": "FEMALE", "nationality": "IN", "passportNumber": "N1234567", "passportExpiry": "2032-01-01", "passportCountry": "IN" } ],
  "couponCode": "WELCOME10" }
```
One entry per traveller of the trip offer (adults, then children, then infants). `dateOfBirth` is required for children and
infants (age checked against the first departure: child 2–11, infant under 2); `gender`, `nationality` and the passport
fields are optional (the page asks for them on international trips). The passport number is encrypted at rest and
never sent in events or returned (`passportLast4` only). Errors: `422 INVALID_PASSENGERS`, plus those of 8.1.

BookingDetails gets `flight` (instead of `hotel`): `{ offerId, tripType, cabin, fareName, refundable, checkedBaggageKg,
cabinBaggageKg, cancellationFeePercent, cancellationPolicy, adults, children, infants, demo,
pnr (null until the airline issued the booking), slices: [{ origin, destination, originCity, destinationCity,
departureLocal, arrivalLocal, durationMinutes, stops, segments: [{ flightNumber, airlineCode, airlineName, origin,
destination, departureLocal, arrivalLocal, durationMinutes }] }],
passengers: [{ passengerNo, passengerType, firstName, lastName, dateOfBirth, gender, nationality, passportLast4,
ticketNumber (null until issued) }] }`. List fields for flights: `title` "Delhi to Mumbai", `destination` = arrival city,
`startDate` = departure date, `endDate` = return date (or the departure date for one-way).

### 8.2 Read

| Method & path | Response |
|---------------|----------|
| `GET /api/bookings?tab=ALL\|PENDING\|UPCOMING\|COMPLETED\|CANCELLED&q=&type=HOTEL\|FLIGHT&page=&size=` | My Trips: page of `{ id, reference, type, status, paymentStatus, title, destination, startDate, endDate, totalAmount, currency, createdAt, demo, canCancel, stay, flight }`, newest first. `q` finds words of the reference, title or destination (a `%` or `_` is plain text); `type` keeps hotels or flights; only the caller's own bookings can match (Phase 12). `stay` (hotels) = `{ hotelSlug, hotelName, city, roomTypeName, rooms, adults, children, nights }`, `flight` (flights) = `{ tripType, cabin, adults, children, infants, passengerNames[], slices[] }` with the slices of §8.1a (airline, flight number, airports, local times, stops); both are read for the whole page in three queries |
| `GET /api/bookings/summary?range=&from=&to=` | Customer dashboard (Phase 11): my bookings, trips, spending, monthly activity and next trip (§14.8) |
| `GET /api/bookings/{id}` | **BookingDetails**: summary fields plus `baseAmount, taxAmount, feeAmount, discountAmount, totalAmount, priceItems[{type: ROOM\|TAX\|FEE\|DISCOUNT, label, amount}], couponCode, couponNote, contactEmail, contactPhone, holdExpiresAt, paymentDeadline, confirmedAt, failureReason, failureMessage, canPay, hotel{...}`. `hotel.confirmationNumber` is `null` until the hotel confirmed (payment success is not confirmation). |
| `GET /api/bookings/{id}/timeline` | `[{ fromStatus, status, reason, at }]`, oldest first (`fromStatus == status`: something happened that kept the status, e.g. a failed payment) |

Tabs: `PENDING` = `INITIATED … SUPPLIER_PENDING`, `UPCOMING` = `CONFIRMED`, `COMPLETED`, `CANCELLED` = cancelled,
refunded, failed and expired bookings.

### 8.3 Coupon preview: `POST /api/coupons/check`

`{ code, bookingType: "HOTEL", amount, destinationCity? }` → `{ code, title, description, discount, totalAfterDiscount,
currency }`. A preview only: the real discount is calculated from the price the hotel holds and shown in `priceItems`
(a coupon that does not fit the held price is skipped with `couponNote`). Labelled demo coupons for local use:
`WELCOME10`, `STAY500`, `GOA15` (off in production).

### 8.4 Cancel a booking (Phase 7)

The flow and every failure path: [BOOKING_WORKFLOW.md §4](BOOKING_WORKFLOW.md). A cancellation is only successful once
the hotel or airline confirmed it; the money goes back through payment-service afterwards.

**Quote: `GET /api/bookings/{id}/cancellation-quote`** (owner, or `BOOKING_READ_ANY`; `?waiveFee=true` needs `REFUND_MANAGE`)

```json
{ "bookingId": "...", "cancellable": true, "reasonCode": null, "message": null,
  "currency": "INR", "paidAmount": 6300.00, "cancellationFee": 3150.00, "refundAmount": 3150.00,
  "feeWaived": false, "freeCancellation": false, "freeCancellationUntil": "2026-12-03T08:30:00Z",
  "cancelUntil": "2026-12-05T08:30:00Z", "feeDescription": "50% of the stay price (₹6,300)",
  "policy": "Free cancellation until 3 Dec 2026, 14:00 (hotel local time); after that 50% of the total is charged.",
  "quotedAt": "2026-12-04T10:00:00Z" }
```

| Field | Meaning |
|-------|---------|
| `cancellable` / `reasonCode` | `false` with `NOT_CONFIRMED` (not confirmed yet, or failed/expired), `CANCELLATION_IN_PROGRESS`, `ALREADY_CANCELLED`, `COMPLETED`, `TOO_LATE` (after `cancelUntil`); `message` explains it in words |
| `paidAmount` | what the customer paid (`totalAmount`) |
| `cancellationFee`, `refundAmount` | `refundAmount = max(0, paidAmount − cancellationFee)`. Hotels: fee = fee % of the stay price (room charges + GST, before the coupon), 0 before `freeCancellationUntil`. Flights: fee = fee % of the **fare** (taxes and airline charges are refunded); non-refundable fares are 100 %. A coupon discount is not given back. |
| `cancelUntil` | hotels: the check-in moment (hotel local time); flights: 4 hours before the first departure |
| `freeCancellation` | the fee is 0 right now |

**Request: `POST /api/bookings/{id}/cancel` → `202 Cancellation`** with header **`Idempotency-Key`** (same rules as 8.1)

```json
{ "reason": "Change of plans", "expectedRefundAmount": 3150.00, "waiveFee": false }
```

- `expectedRefundAmount` (optional, the UI always sends it): the refund the customer saw. If today's calculation differs
  (for example the free-cancellation deadline passed while the page was open) → `409 CANCELLATION_QUOTE_CHANGED` with
  `details.refundAmount` / `details.cancellationFee`; show the new figures and ask again.
- `reason`: up to 500 characters; optional for the owner, **required** when a support agent or admin cancels someone
  else's booking (`422 REASON_REQUIRED`).
- `waiveFee` (full refund, e.g. the airline cancelled the flight or goodwill): needs `REFUND_MANAGE` (admin), otherwise
  `403 FORBIDDEN`. Audited.
- Same key again → the same cancellation (`202`); same key with another body → `422 IDEMPOTENCY_KEY_REUSED`.
- Errors: `404 BOOKING_NOT_FOUND` (not yours), `409 BOOKING_NOT_CANCELLABLE` (`details.reasonCode` as in the quote),
  `400 IDEMPOTENCY_KEY_REQUIRED | INVALID_IDEMPOTENCY_KEY`.

```json
Cancellation = { "id": "...", "status": "PENDING | CONFIRMED | REJECTED",
  "initiatedBy": "CUSTOMER | SUPPORT_AGENT | ADMIN", "reason": "Change of plans", "feeWaived": false,
  "currency": "INR", "cancellationFee": 3150.00, "refundAmount": 3150.00,
  "requestedAt": "...", "completedAt": null, "supplierReference": null,
  "failureReason": null, "failureMessage": null }
```

The booking moves `CONFIRMED → CANCELLATION_PENDING`; then, in the background:

| Outcome | Booking | `paymentStatus` |
|---------|---------|-----------------|
| Supplier confirmed, refund > 0 | `CANCELLED → REFUND_PENDING → REFUNDED` | `REFUND_PENDING` → `REFUNDED` (all back) or `PARTIALLY_REFUNDED` (fee kept) |
| Supplier confirmed, nothing to refund (non-refundable) | `CANCELLED` | `PAID` |
| Supplier refused (too late, not allowed, no answer) | back to `CONFIRMED`; `cancellation.status = REJECTED` with `failureMessage` | `PAID` |

For flights the airline's own fee is final: if it differs from the quote, the booking is flagged for support
(`attention.reason = REFUND_DIFFERS`) and the timeline says so.

**BookingDetails / BookingSummary additions:** `canCancel` (the Cancel button), and on BookingDetails
`cancellation` (the latest `Cancellation` or `null`), `refundedAmount`, `refunds: [{ id, amount, currency,
reason: CANCELLATION | BOOKING_FAILED | LATE_PAYMENT | DUPLICATE_PAYMENT, status: REQUESTED | COMPLETED | FAILED,
requestedAt, completedAt }]`, `attention` (`{ reason, note, since }`, only for `BOOKING_READ_ANY` users, otherwise
`null`) and `supportNotes` (`[{ action: ESCALATED | RESOLVED | REFUND_RETRIED | CANCELLED_ON_BEHALF, note, authorRole,
createdAt }]`, oldest first; internal, only for `BOOKING_READ_ANY` users, otherwise empty). `paymentStatus` can now
also be `PARTIALLY_REFUNDED`.

Live updates: `booking.status-changed` on every step, `refund.status-changed` (`resourceId` = booking id) when a refund
starts, completes or fails.

### 8.5 Support: booking lookup and actions `/api/support/bookings` (booking-service)

| Method & path | Permission | Notes |
|---------------|-----------|-------|
| `GET /?q=&status=&type=&attention=&page=&size=` | `BOOKING_READ_ANY` | `q` = booking reference, contact e-mail, PNR or hotel confirmation number (exact, case-insensitive); empty = all. `attention=true` = only flagged bookings, oldest flag first; otherwise newest first. → page of `{ id, reference, type, status, paymentStatus, title, destination, startDate, endDate, totalAmount, currency, createdAt, contactEmail, leadName, attentionReason, attentionSince, demo }` |
| `GET /api/bookings/{id}` and `/timeline`, `/cancellation-quote` | `BOOKING_READ_ANY` | as for the owner (with `attention`) |
| `POST /api/bookings/{id}/cancel` | `BOOKING_MANAGE_ANY` | on behalf of the customer, `reason` required; `initiatedBy` = the agent's role |
| `POST /{id}/escalate` | `BOOKING_MANAGE_ANY` | `{ note }` (1–500) → `200 { reason: "ESCALATED", note, since }`: puts the booking in the "Needs attention" queue |
| `POST /{id}/resolve` | `BOOKING_MANAGE_ANY` | `{ note? }` (max 500) → `204`; clears the flag (`409 NOTHING_TO_RESOLVE` when not flagged) |
| `POST /{id}/retry-refund` | `REFUND_MANAGE` | the booking's latest refund request failed → a new request for the same amount → `202` refund item; `409 NO_FAILED_REFUND` otherwise |
| `GET /api/payments/booking/{id}` | `PAYMENT_READ_ANY` | every payment attempt with `refundedAmount` (payment-service, §9) |

Attention reasons (set automatically, cleared by `resolve` or when the problem goes away): `REFUND_FAILED`,
`CANCELLATION_REJECTED`, `CANCELLATION_NO_ANSWER`, `REFUND_NO_ANSWER`, `REFUND_DIFFERS`, `ESCALATED`. Notes are internal:
they are kept in `supportNotes` and never appear on the customer's timeline. Every action is an audit event
(`audit.events`, §11; the audit entry never contains the note text). The cancellation `reason` of a cancel on behalf
is part of the cancellation and visible to the customer.

## 9. Payments and invoices: `/api/payments`, `/api/invoices` (payment-service)

Flow, signatures and rules: [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md). The amount is always the one the server
knows for the booking; the browser never sends or decides it.

| Method & path | Notes |
|---------------|-------|
| `POST /api/payments/create-order` | `{ bookingId }` + header `Idempotency-Key` → `OrderResponse { paymentId, bookingId, bookingReference, provider: DEMO\|RAZORPAY, orderId, keyId (Razorpay's public Key ID, null for DEMO), amount, currency, description, contactEmail, paymentDeadline, status }`. The same key, or any request while an order is still open, returns the same order. `404` (not your booking), `409 BOOKING_ALREADY_PAID`, `409 PAYMENT_WINDOW_CLOSED`, `409 PAYMENT_NOT_READY` (payment-service has not received the booking yet: ask again after a second, the payment page does it automatically), `502 PAYMENT_PROVIDER_UNAVAILABLE` |
| `POST /api/payments/verify` | The checkout callback `{ orderId, paymentId, signature }` → `PaymentResult { paymentId, bookingId, status, method, amount, currency, failureCode, failureMessage }`. Signature **and** the provider's own record decide. `400 INVALID_PAYMENT_SIGNATURE`, `400 PAYMENT_ORDER_MISMATCH`, `400 INVALID_PAYMENT`. If the provider cannot be asked right now the status is `PENDING` and the reconciliation job settles it. |
| `POST /api/payments/report-failure` | `{ orderId, paymentId }`: Razorpay Checkout reported a failure; the attempt is only closed if the provider confirms it |
| `GET /api/payments?q=&status=&method=&bookingType=&from=&to=&sort=&page=&size=` | Payment History: `{ id, bookingId, bookingReference, description, provider, amount, refundedAmount, currency, status, method, failureMessage, createdAt, verifiedAt, invoiceNumber, bookingType }`, newest first. `q` = booking reference, payment id or the provider's payment / order id (exact); `from` / `to` = India days; `sort=createdAt\|amount[,asc\|desc]` (`400 INVALID_SORT`, `400 INVALID_RANGE`, `400 INVALID_FILTER`). Only the caller's own payments can match, whatever `q` is (Phase 12) |
| `GET /api/payments/summary?q=&status=&method=&bookingType=&from=&to=` | `{ total, successful, failed, pending, paidAmount, refundedAmount, currency }` of the caller's own payments for the same filters; `paidAmount` is what was captured, before refunds |
| `GET /api/payments/booking/{bookingId}` | Every payment attempt of one booking (owner, or `PAYMENT_READ_ANY`) |
| `GET /api/invoices?page=&size=`, `GET /api/invoices/booking/{bookingId}` | Invoice `{ invoiceNumber (INV/2026-27/000123), billingName, taxableAmount, taxAmount, discountAmount, totalAmount, issuedAt, … }`; `404` until the booking is confirmed. The PDF arrives in Phase 8. |
| `POST /api/payments/demo/pay`, `POST /api/payments/demo/fail` | `{ orderId }` → the signed callback `{ orderId, paymentId, signature }` of the **DEMO** provider. Only exists when `payment.demo.enabled=true` (local and Docker), never in production. |
| `POST /api/payments/webhook` | **Public**, called by Razorpay. Raw body, headers `X-Razorpay-Signature` and `X-Razorpay-Event-Id`. `401 INVALID_WEBHOOK_SIGNATURE`; every authentic event answers `200 { status: PROCESSED\|IGNORED\|DUPLICATE }`. |

Payment status: `INITIATED → PENDING → SUCCESS | FAILED`; `SUCCESS → REFUND_PENDING → PARTIALLY_REFUNDED | REFUNDED`.

## 10. Notifications: `/api/notifications` (notification-service, any logged-in user)

The bell and the **Notification Center** (Phase 8). Every customer-facing event creates an in-app notification and,
where it matters, an e-mail (matrix below). Categories: `ACCOUNT`, `BOOKING`, `PAYMENT`, `REFUND`, `REMINDER`, `SUPPORT`.

| Method & path | Response |
|---------------|----------|
| `GET /api/notifications?unreadOnly=false&category=&page=&size=` | page of `{ id, category, title, message, link (path inside the app), read, createdAt }`, newest first; `category` filters (optional) |
| `GET /api/notifications/unread-count` | `{ count }` |
| `POST /api/notifications/{id}/read` | `204` (`404` for someone else's) |
| `POST /api/notifications/{id}/unread` | `204`: back to unread (Phase 8) |
| `POST /api/notifications/read-all` | `{ updated }` |
| `GET /api/notifications/preferences` | `{ items: [{ category, channel: EMAIL\|IN_APP, enabled, locked }], newsletter: { subscribed, status: NONE\|PENDING\|SUBSCRIBED\|UNSUBSCRIBED } }` |
| `PUT /api/notifications/preferences` | `{ items: [{ category, channel, enabled }], newsletter?: boolean }` → the same shape as GET. Only the items sent change; turning off a `locked` item → `422 PREFERENCE_LOCKED`. `newsletter: true` subscribes the account's (verified) e-mail at once, `false` unsubscribes it. |

Preference rules: categories `BOOKING`, `PAYMENT`, `REFUND`, `REMINDER`, `SUPPORT` × channels `EMAIL`, `IN_APP`, all on by
default. **Locked** (always sent, `locked: true`): `EMAIL` for `BOOKING`, `PAYMENT` and `REFUND` (confirmations, receipts,
cancellations, refunds). `ACCOUNT` messages (welcome, password, security) are not configurable.

| Event | In-app | E-mail (attachment) | Category |
|-------|--------|---------------------|----------|
| E-mail verified | "Welcome to FlightHotel" | (the verification e-mail itself, identity) | ACCOUNT |
| Booking received (rooms/seats held, payment due) | "Complete your payment" | "Booking received – complete your payment" | BOOKING |
| Payment received | yes | "Payment received" (payment receipt PDF) | PAYMENT |
| Payment failed | yes | "Your payment did not go through" | PAYMENT |
| Booking confirmed (hotel / flight) | yes | confirmation (hotel confirmation PDF / flight itinerary + e-ticket PDFs) | BOOKING |
| Invoice issued | "Your invoice is ready" | – | PAYMENT |
| Booking cancelled / cancellation not possible | yes | yes (cancellation confirmation PDF) | BOOKING |
| Refund started | yes | yes (not for cancellations: the cancellation e-mail covers it) | REFUND |
| Refund completed | yes | "Refund completed" (refund receipt PDF) | REFUND |
| Refund failed | yes | – | REFUND |
| Travel reminder (24 h before check-in / departure) | yes | "Your trip starts tomorrow" | REMINDER |
| Support ticket opened or answered | yes | – | SUPPORT |

Schedule changes: the DEMO airline has none, so there is no such message yet (a real supplier adapter would publish one).
Open pages refresh live (`notification.created`, `notification.read`).

## 10b. Documents: `/api/documents` (notification-service, Phase 8)

PDFs generated on the server from the booking, payment and refund events (never from browser data) and kept in the
configured storage (local folder in development, S3 in production). There are no public file URLs: every download goes
through this API with the user's token.

| Method & path | Notes |
|---------------|-------|
| `GET /api/documents?bookingId=` | the booking's documents, oldest first: `[{ id, bookingId, type, referenceId, title, fileName, sizeBytes, createdAt }]` (`referenceId`: the payment id of a receipt, the invoice id, the cancellation or refund id, otherwise the booking id). Owner, or `BOOKING_READ_ANY`; for anyone else (or an unknown booking) the list is empty, so it never reveals whether a booking exists. |
| `GET /api/documents/{id}/download` | `application/pdf`, `Content-Disposition: attachment; filename="HT-7K3M9Q2X-confirmation.pdf"`, `Cache-Control: private, no-store`. Owner or `BOOKING_READ_ANY`; anyone else `404 DOCUMENT_NOT_FOUND`. |

`type`: `BOOKING_CONFIRMATION` (hotel voucher / flight itinerary, once confirmed), `E_TICKET` (flights, one page per
traveller with the ticket number), `INVOICE` (tax invoice `INV/2026-27/000123`), `PAYMENT_RECEIPT` (every captured
payment), `CANCELLATION_CONFIRMATION`, `REFUND_RECEIPT` (every completed refund). Documents appear a few seconds after
the event (live: `document.created`, `resourceId` = booking id). The browser downloads with the Authorization header
(fetch as a blob), because the token is not a cookie.

## 10c. Support tickets (customer side): `/api/support/tickets` (notification-service, Phase 8)

| Method & path | Notes |
|---------------|-------|
| `POST /` | `{ subject (5–120), category: BOOKING\|PAYMENT\|REFUND\|CANCELLATION\|ACCOUNT\|OTHER, bookingId?, message (1–2000) }` → `201 Ticket`. `bookingId` must be one of the customer's bookings (`422 INVALID_BOOKING`). |
| `GET /?status=&category=&q=&page=&size=` | my tickets, latest activity first (`q` = a ticket number, exact, or words of the subject; only my own tickets can match): `{ id, ticketNumber (TK-7K3M9Q2X), subject, category, status, bookingId, bookingReference, createdAt, lastMessageAt, lastMessageBy: CUSTOMER\|SUPPORT\|SYSTEM }` |
| `GET /summary` | `{ total, open, inProgress, waitingForYou, resolved, closed }`: my tickets per status (`inProgress` includes `ESCALATED`, `waitingForYou` = `WAITING_CUSTOMER`) (Phase 12) |
| `GET /{id}` | `Ticket` = the summary + `messages: [{ id, authorRole: CUSTOMER\|SUPPORT_AGENT\|ADMIN\|SYSTEM, message, createdAt }]` (oldest first); `404 TICKET_NOT_FOUND` for someone else's |
| `POST /{id}/messages` | `{ message (1–2000) }` → `201` message; a reply to a `WAITING_CUSTOMER` or `RESOLVED` ticket reopens it (`OPEN`); `409 TICKET_CLOSED` |
| `POST /{id}/close` | → `Ticket` with status `CLOSED` (final) |

Statuses: `OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `ESCALATED`, `RESOLVED`, `CLOSED` (the agent side of the queue and
replies arrive with the support portal in Phase 9). A ticket is also **opened automatically** when the hotel or airline
refuses a cancellation (category `CANCELLATION`, first message by `SYSTEM`). Live: `support.ticket-changed`
(`resourceId` = ticket id).

## 10d. Newsletter: `/api/newsletter` (notification-service, public, rate limited, Phase 8)

| Method & path | Notes |
|---------------|-------|
| `POST /subscribe` | `{ email }` → always `202 { message }` (nobody can find out which addresses are subscribed). Sends a confirmation e-mail (double opt-in, link `/newsletter/confirm?token=…`, valid 48 h) unless the address is already subscribed. |
| `POST /confirm` | `{ token }` → `{ status: SUBSCRIBED, email: "a***@example.com" }`; `400 INVALID_OR_EXPIRED_TOKEN` |
| `POST /unsubscribe` | `{ token }` (from the link `/newsletter/unsubscribe?token=…` in every newsletter e-mail; it does not expire) → `{ status: UNSUBSCRIBED }`; `400 INVALID_TOKEN` |

Logged-in customers manage the subscription of their account e-mail in the notification preferences (§10). The
`newsletterOptIn` flag of the travel preferences (§3.3) is no longer shown; the subscription lives here.

## 10a. Admin: flight providers `/api/admin/flight-providers` (flight-service, role `ADMIN`)

| Method & path | Notes |
|---------------|-------|
| `GET /` | `[{ code, name, enabled, demo, priority, timeoutMs, healthStatus: UP\|DEGRADED\|DOWN\|UNKNOWN, healthCheckedAt, lastError }]` |
| `PATCH /{code}` | `{ enabled?, priority? }`. Disabling the last enabled provider is allowed: search then answers `503 FLIGHT_SEARCH_UNAVAILABLE`. Bookings already paid keep being handled by their provider. |
| `POST /{code}/health-check` | runs the health check now and returns the provider |

Open pages refresh live (`flight.provider-health-changed`).

## 11. Admin: audit logs `/api/admin/audit-logs` (reporting-service, role `ADMIN`)

> **Built in Phase 7** (the admin page follows in Phase 9). Every service records audit events on `audit.events`
> (accounts, roles, sessions, cancellations, refunds, support actions, ...); reporting-service stores each event once.

`GET /api/admin/audit-logs?action=&entityType=&entityId=&actorId=&from=2026-11-01T00:00:00Z&to=...&page=&size=`
(exact matches; `from` inclusive, `to` exclusive; size up to 100)
→ `Page<{ id, occurredAt, service, actorId, actorRoles[], action, entityType, entityId, details{}, ipAddress,
correlationId }>`, newest first. `details` holds ids and amounts only, never personal data or notes.

### 11.1 Background exports (requested 2026-11-09)

Every matching entry, any number of them, as a file written on the server. The web export (built in the browser) stops
at 10,000 rows; the Audit logs page uses these endpoints above that. Only the admin who asked sees an export.

| Method & path | Notes |
|---------------|-------|
| `POST /api/admin/audit-logs/exports` | `{ format: XLSX \| CSV, action?, entityType?, entityId?, actorId?, from?, to?, exportedBy? }`: the list's filters (same meaning); `exportedBy` is only printed in the file. → `202` + the export (`QUEUED`). `422 EXPORT_EMPTY` when nothing matches; `409 EXPORT_LIMIT_REACHED` when the admin already has 2 unfinished exports. Recorded in the audit log (`AUDIT_LOG_EXPORT_REQUESTED`) |
| `GET /api/admin/audit-logs/exports` | the admin's exports of the last 7 days, newest first |
| `GET /api/admin/audit-logs/exports/{id}` | one export; another admin's is `404` |
| `DELETE /api/admin/audit-logs/exports/{id}` | `204`: cancels a waiting or running export (it stops at its next batch) or removes a finished one and its file |
| `POST /api/admin/audit-logs/exports/{id}/link` | `{ url, expiresAt }`: a one-time download link, valid 60 s (`409 EXPORT_NOT_READY` unless `READY`). Recorded as `AUDIT_LOG_EXPORT_DOWNLOADED` |
| `GET /api/public/export-files/{id}?token=…` | **public**, the link itself: streams the file (`Content-Disposition: attachment`, `Cache-Control: no-store`). Works once; a wrong, used or expired token, or an expired file, is `404` |

An export: `{ id, format, status, filters{action, entityType, entityId, actorId, from, to}, totalRows, rowsWritten,
parts, fileName, sizeBytes, error, createdAt, startedAt, finishedAt, expiresAt }`. `status`: `QUEUED` → `RUNNING` →
`READY` (downloadable until `expiresAt`, 24 h) → `EXPIRED` (file deleted), or `FAILED` (`error` is safe to show).
`totalRows` is null until the export has counted its entries. Entries recorded after the request are not included.

The file: Excel up to 1,000,000 rows is one `.xlsx`; more rows give a `.zip` of `.xlsx` parts of 1,000,000 rows each
(`audit-logs-2026-11-09-part-01-of-10.xlsx`, ...; Excel holds 1,048,576 rows a sheet). Each part has the web export's
layout (bold frozen header with filters, real dates, "About this export" sheet saying which entries it holds). CSV is
one file (UTF-8 with BOM, formula guard), zipped above 1,000,000 rows. Progress and the end are pushed to the admin as
`export.status-changed` ([REALTIME_UPDATES.md](REALTIME_UPDATES.md) §6).

## 12. System settings (reporting-service)

| Method & path | Who | Notes |
|---------------|-----|-------|
| `GET /api/public/settings` | everyone | `[{ key, value }]` for public settings (site name, support contacts) |
| `GET /api/admin/settings` | ADMIN | all settings with `version` |
| `PUT /api/admin/settings/{key}` | ADMIN | `{ value, expectedVersion }`; `409 SETTING_CHANGED_BY_SOMEONE_ELSE` on stale version |

## 13. Realtime: `GET /api/realtime/stream` (notification-service)

Server-Sent Events, bearer token required. Protocol and message types: [REALTIME_UPDATES.md](REALTIME_UPDATES.md).
Identity adds `session.revoked` (`data.reason`: `DEACTIVATED | PASSWORD_RESET | LOGOUT_ALL`): the client must
log out every tab.

## 14. Phase 9: portals, reviews and reporting

Everything here needs a login unless marked **public**. Lists are pages (`{ content, page, size, totalElements,
totalPages }`) with `page` (0-based), `size` (≤ 100 unless noted) and `sort=field,asc|desc`. Money is INR.
Phase 11 adds longer ranges, intervals and comparisons (§14.0) to the admin and hotel manager dashboards (§14.1,
§14.5), the support metrics (§14.6) and the customer dashboard (§14.8); how the staff portals use them: §14.9.

### 14.0 Date ranges (dashboards and reports)

`range=TODAY | LAST_7_DAYS | LAST_14_DAYS | LAST_30_DAYS | LAST_90_DAYS | THIS_MONTH | PREVIOUS_MONTH | THIS_YEAR |
PREVIOUS_YEAR | LAST_12_MONTHS | LAST_3_YEARS | LAST_5_YEARS | CUSTOM` (default `LAST_30_DAYS`; `LAST_90_DAYS` and the
presets after `PREVIOUS_MONTH` since Phase 11). `CUSTOM` needs `from` and `to` (`YYYY-MM-DD`, both inclusive). Days are
India days (Asia/Kolkata). `LAST_7_DAYS` = today and the 6 days before. `THIS_YEAR` = 1 January until today;
`PREVIOUS_YEAR` = the whole calendar year; `LAST_12_MONTHS` = the 1st of the month eleven months ago until today (twelve
calendar months); `LAST_3_YEARS` / `LAST_5_YEARS` = 1 January two / four years ago until today. Every answer echoes
`range: { preset, from, to }`.

| Endpoints | Longest range |
|-----------|---------------|
| Reports (§14.1), hotel reports (§14.5), admin occupancy | 366 days, so `LAST_3_YEARS`, `LAST_5_YEARS` and longer `CUSTOM` ranges answer `400 INVALID_RANGE` there |
| Admin dashboard (§14.1), hotel manager dashboard (§14.5), support metrics (§14.6), customer dashboard (§14.8) | five years (1,827 days) |

An unknown preset, `CUSTOM` without `from` / `to`, `to` before `from` or a range that is too long → `400 INVALID_RANGE`.

**Intervals (dashboards, Phase 11).** `interval=DAY | WEEK | MONTH | YEAR` for the trend series: ISO weeks from Monday
(key `2026-W45`), calendar months (`2026-11`) and years (`2026`). Every point has `key`, `start` and `end` (both
inclusive); the first and last point are cut to the range, and the points cover every day of the range once (zeros
included). Default by the length of the range: up to 31 days `DAY`, up to 92 `WEEK`, up to 731 `MONTH`, longer `YEAR`.
At most 366 / 262 / 120 / 20 points; more points, or an unknown value → `400 INVALID_INTERVAL`. The answer echoes the
interval used.

**Comparison (dashboards, Phase 11).** Every dashboard compares with `previousRange` = the same number of days right
before the range (preset `PREVIOUS_PERIOD`). A comparison is `{ current, previous, change, changePercent, trend: UP |
DOWN | FLAT }`: `change` = current − previous (for rates in percentage points); `changePercent` = change / |previous| ×
100 (one decimal), `null` when only the previous value is 0, `0.0` when both are 0; `trend` follows the sign of
`change`. Whether `UP` is good depends on the figure; the page decides the colour.

### 14.1 Admin dashboard and reports (reporting-service, permission `REPORT_VIEW`)

reporting-service keeps read models built from events (`booking_facts`, `payment_facts`, `refund_facts`,
`cancellation_facts`, `user_facts`); every figure is calculated on the server for the range.

**`GET /api/admin/dashboard?range=&from=&to=&interval=`** (`interval`: Phase 11)

```json
{ "range": { "preset": "LAST_30_DAYS", "from": "2026-10-07", "to": "2026-11-05" },
  "customers": { "total": 120, "newInRange": 14, "active": 48 },
  "bookings": { "flight": 40, "hotel": 55, "upcoming": 30, "completed": 12, "cancelled": 9, "pending": 3, "failed": 6 },
  "payments": { "pendingCount": 3, "pendingAmount": 18900.00, "successfulCount": 80, "successfulAmount": 512340.00 },
  "revenue": { "gross": 512340.00, "refunds": 40200.00, "net": 472140.00, "currency": "INR" },
  "popularDestinations": [{ "city": "Goa", "bookings": 21, "revenue": 140000.00, "previousBookings": 10 }],
  "topHotels": [{ "hotelId": "…", "hotelName": "Sea Breeze Resort", "city": "Goa", "bookings": 9, "revenue": 70000.00, "previousBookings": 12 }],
  "bookingTrend": [{ "date": "2026-10-07", "flight": 1, "hotel": 3, "cancelled": 0 }],
  "revenueTrend": [{ "date": "2026-10-07", "gross": 12000.00, "refunds": 0, "net": 12000.00 }],
  "recentBookings": [{ "id": "…", "reference": "HT-…", "type": "HOTEL", "status": "CONFIRMED", "title": "…", "totalAmount": 6300.00, "createdAt": "…" }],
  "recentActivity": [{ "occurredAt": "…", "action": "BOOKING_CANCELLED", "entityType": "BOOKING", "entityId": "…", "service": "booking-service", "actorRole": "CUSTOMER" }],
  "generatedAt": "…" }
```

| Figure | Definition (all for the range) |
|--------|--------------------------------|
| `customers.total` / `newInRange` | accounts with the CUSTOMER role registered up to the end of the range / within it |
| `bookings.flight`, `bookings.hotel` | bookings **created** in the range that were paid (reached `CONFIRMED` at some point) |
| `bookings.upcoming` / `completed` / `cancelled` | of those: still `CONFIRMED` / `CANCELLATION_PENDING` · `COMPLETED` · cancelled (whether refunded or not) |
| `bookings.pending` / `failed` | created in the range and still waiting (`INITIATED` … `SUPPLIER_PENDING`) / `FAILED` or `EXPIRED` |
| `payments.pending*` | bookings created in the range that are `PENDING_PAYMENT` now (count and amount due) |
| `payments.successful*` | captured payments made in the range (count, amount) |
| `revenue.gross` / `refunds` / `net` | captured payments in the range / refunds completed in the range / gross − refunds |
| `popularDestinations`, `topHotels` | paid bookings created in the range, top 5 by bookings (destinations) and by revenue (hotels) |
| trends | one entry per day of the range (bookings by creation day, money by payment / refund day) |
| `recentBookings` / `recentActivity` | the 10 newest bookings created / audit events in the range |

**Dashboard v2 (Phase 11), additive.** New parameter `interval` (§14.0); ranges up to five years. Every field above
stays; `payments` gains three fields, the rest is new:

| Figure | Definition (all for the range) |
|--------|--------------------------------|
| `payments.failedCount` / `failedAmount` | payment attempts that failed in the range; a failed attempt counts its booking's total |
| `payments.successRate` | successful / (successful + failed) × 100 (%); `0.0` without attempts |
| `interval`, `previousRange` | the interval of `series`; the previous period (§14.0) |
| `products.hotel` / `flight` / `all` | `{ bookings, cancelled, cancellationRate, gross, refunds, net }`: paid bookings created in the range and, of those, the ones cancelled since; money captured / refunded in the range, by the booking's type. The money of `all` equals `revenue`; it also holds money of a booking whose snapshot has not arrived yet (seconds) |
| `cancellations` | `{ count, hotel, flight, byInitiator: { CUSTOMER, SUPPORT_AGENT, ADMIN, HOTEL }, cancellationFees, refundAmount, rate, hotelRate, flightRate }`: cancellations confirmed in the range; `rate` = the share of the range's paid bookings cancelled since (as `products.*.cancellationRate`) |
| `comparison` | 13 comparisons with `previousRange`: `bookings`, `hotelBookings`, `flightBookings`, `grossRevenue`, `refunds`, `netRevenue`, `hotelRevenue`, `flightRevenue` (net), `successfulPayments`, `failedPayments`, `cancellations`, `cancellationRate` (points), `newCustomers` |
| `series[]` | one point per interval (`key`, `start`, `end`): `bookings`, `hotelBookings`, `flightBookings`, `cancellations`, `gross`, `refunds`, `net`, `hotelGross`, `flightGross`, `hotelNet`, `flightNet`, `successfulPayments`, `failedPayments`, `failedAmount`, `newCustomers`; the points add up to the range's figures |

`bookingTrend` and `revenueTrend` stay daily (one entry per day of the range, up to 1,827); new pages use `series`.

**Dashboard v3 (Phase 12), additive.** For the redesigned admin dashboard; every earlier field stays:

| Field | Definition |
|-------|------------|
| `customers.active` | customers with at least one paid booking created in the range (each counted once) |
| `popularDestinations[].previousBookings`, `topHotels[].previousBookings` | the same city's / hotel's paid bookings in `previousRange`, for the trend (`0` = new in this range) |
| `recentBookings[]` also `customerName`, `customerEmail`, `destination` | `customerName` is `null` when the account is not known to reporting yet; `customerEmail` is the booking's contact e-mail |
| `timeline[]` | the activity feed, the 12 newest of the range: `{ at, type, outcome, title, detail, amount, entityType, entityId }`. `type`: `CUSTOMER_REGISTERED`, `BOOKING_CREATED`, `BOOKING_CANCELLED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `SUPPORT_TICKET`, `BOOKING_REFUND_*`. `outcome`: `SUCCESS`, `PENDING`, `FAILED`, `CANCELLED`, `INFO` (a booking is `SUCCESS` once confirmed or completed, `PENDING` while it is processed, `FAILED` when failed or expired, `CANCELLED` once cancelled). `amount` is the booking total, the captured (or failed) payment, or the refund of a cancellation; `null` without one. Sources: `user_facts`, `booking_facts`, `cancellation_facts`, `payment_facts` and the ticket and refund audit events |

`recentActivity` (audit events only) is kept for older clients; the dashboard now uses `timeline`.

Live: `dashboard.updated` (to `ADMIN`, at most every 10 s) when facts change.

**Reports: `GET /api/admin/reports/{report}?range=&from=&to=&q=&type=&status=&sort=&page=&size=`** →
`{ range, columns: [{ key, label, type: TEXT|MONEY|NUMBER|DATE|DATETIME }], content: [ { key: value } ], page, size,
totalElements, totalPages, totals: { key: value } }` (totals over **all** rows of the range and filters, not only the page).
**`GET /api/admin/reports/{report}/export?format=csv|pdf&…same filters…`** → `text/csv` (UTF-8 with BOM, for Excel) or
`application/pdf` (`Content-Disposition: attachment; filename="bookings-2026-10-07-2026-11-05.csv"`), at most 10,000 rows
(`422 EXPORT_TOO_LARGE` beyond). Unknown report → `404`.

| `report` | Rows | `q` searches | Sorts | Totals |
|----------|------|--------------|-------|--------|
| `bookings` (`type=FLIGHT\|HOTEL`, `status=`) | reference, type, status, paymentStatus, title, destination, travelDate, customerEmail, totalAmount, refundedAmount, createdAt | reference, e-mail, title, destination | createdAt, totalAmount, travelDate | count, totalAmount, refundedAmount |
| `revenue` | date, payments, gross, refunds, net | – | date | gross, refunds, net |
| `payments` (`status=SUCCESS\|FAILED`) | paymentId, bookingReference, provider, method, status, amount, refundedAmount, at | reference, payment id | at, amount | count, amount, refundedAmount |
| `refunds` (`status=REQUESTED\|COMPLETED\|FAILED`) | refundRequestId, bookingReference, reason, status, amount, requestedAt, completedAt | reference | requestedAt, amount | count, amount |
| `cancellations` (`type=`) | bookingReference, type, title, initiatedBy, cancelledAt, paidAmount, cancellationFee, refundAmount | reference, title | cancelledAt, refundAmount | count, cancellationFee, refundAmount |
| `destinations` | city, flightBookings, hotelBookings, bookings, revenue | city | bookings, revenue | bookings, revenue |
| `customers` | email, name, registeredAt, bookings, paidBookings, spent, lastBookingAt | e-mail, name | spent, bookings, registeredAt, lastBookingAt | customers, spent |

Hotel occupancy lives where the rooms are: §14.5 (`/api/admin/hotels/occupancy`).

As built: the page also carries `report` and `title`; rows of `bookings`, `payments`, `refunds` and `cancellations`
also have `bookingId` (`cancellations` also `cancellationId`, `customers` `userId`) for links. These are not columns.
`revenue` has one row per day of the range (days without money included) and the totals also count `payments`.
In `destinations`, `topHotels` and `customers.spent`, *revenue* means paid − refunded for paid bookings. The `cancelled`
figure of `bookingTrend` counts cancellations by the day the hotel or airline confirmed them. In the `customers` report,
the rows are customers registered by the end of the range, and their bookings are those created in the range.
`payments` rows of failed attempts show the booking's amount. Errors: `400 INVALID_SORT`, `400 INVALID_FILTER` (`type`,
`status`), `400 INVALID_FORMAT`. CSV cells that start with `= + - @` get a leading `'` so a spreadsheet never runs them
as formulas. Times in CSV are India times (`yyyy-MM-dd HH:mm`). The PDF is an A4 landscape table with the totals.

**Public home page data (reporting-service, public):** `GET /api/public/popular-destinations?limit=8` →
`[{ city, bookings }]` (paid bookings of the last 90 days); `GET /api/public/popular-routes?limit=6` →
`[{ origin, destination, originCity, destinationCity, bookings }]` (paid flight bookings of the last 90 days). Both may
return fewer items (or none) on a new system; the page then shows its own suggestions.

### 14.2 Admin: bookings, refunds, coupons and offers (booking-service)

| Method & path | Permission | Notes |
|---------------|-----------|-------|
| `GET /api/admin/bookings?q=&status=&type=&from=&to=&attention=&page=&size=&sort=` | `BOOKING_READ_ANY` | the support lookup of §8.5 plus creation-date filters (`from`/`to` dates) and `sort=createdAt\|totalAmount\|startDate`; rows as §8.5 plus `userId`, `refundedAmount` |
| `POST /api/admin/bookings/{id}/refunds` | `REFUND_MANAGE` | goodwill refund `{ amount, reason (required) }` + `Idempotency-Key`: at most what is still refundable (paid − refunded − refunds in progress, `422 REFUND_TOO_LARGE`, `409 NOT_REFUNDABLE` when nothing was paid). The booking keeps its status; the refund appears in `refunds` (reason `GOODWILL`) and is audited. |
| `GET /api/admin/coupons?q=&status=&page=&size=` | `COUPON_MANAGE` | `{ id, code, title, description, discountType: PERCENT\|FIXED, discountValue, maxDiscount, minBookingAmount, appliesTo: ALL\|FLIGHT\|HOTEL, destinationCity, validFrom, validTo, usageLimit, perCustomerLimit, usedCount, reservedCount, consumedCount, status: ACTIVE\|INACTIVE, expired, demo, version }` |
| `POST /api/admin/coupons` | `COUPON_MANAGE` | the fields above (code 3–30 letters/digits/`-`, unique: `409 COUPON_CODE_TAKEN`; percent 1–100; `validTo` after `validFrom`) → `201` |
| `PUT /api/admin/coupons/{id}` | `COUPON_MANAGE` | same body + `version` (`409 CONCURRENT_MODIFICATION`); the code cannot change; limits cannot go below what is already used |
| `PATCH /api/admin/coupons/{id}/status` | `COUPON_MANAGE` | `{ status: ACTIVE\|INACTIVE }` |
| `GET /api/offers` | **public** | current offers: `[{ id, title, description, couponCode, discountLabel ("10% off, up to ₹1,500"), appliesTo, destinationCity, validTo, seasonal, theme: OCEAN\|SUNSET\|FOREST\|CITY }]` (active offer, active and not expired coupon, newest first) |
| `GET /api/admin/offers`, `POST /api/admin/offers`, `PUT /api/admin/offers/{id}`, `PATCH /api/admin/offers/{id}/status` | `COUPON_MANAGE` | `{ title (3–80), description (≤ 300), couponId, appliesTo, destinationCity?, validFrom, validTo, seasonal, theme, status, version }` |

As built:
- **Dates.** Coupon and offer `validFrom` / `validTo` are ISO-8601 instants, e.g. `2026-12-01T00:00:00+05:30`. Admin
  booking `from` / `to` are India days.
- **Admin booking search.** `size` ≤ 100. Rows also carry `refundedAmount`, `userId`, `leadName`, `attentionReason`,
  `attentionSince` and `demo`.
- **Goodwill refund.** Answers `202` with `{ id, amount, currency, reason: "GOODWILL", status: "REQUESTED",
  requestedAt, completedAt }`.
  - The refundable amount (`422 REFUND_TOO_LARGE`, `details.refundable`) is the total minus the refunds that are done or
    on their way. The admin's reason is kept as an internal note; it is not put in the audit details.
  - `409 NOT_REFUNDABLE` also answers while a cancellation is in progress.
  - The booking keeps its status. Its payment status becomes `PARTIALLY_REFUNDED` once the money is back.
  - A later cancellation works on the money that is left: the fee is capped by it, and only the rest is refunded.
- **Coupons.**
  - `GET /api/admin/coupons/{id}` also exists.
  - Errors: `422 COUPON_CODE_CANNOT_CHANGE`, `422 USAGE_LIMIT_TOO_LOW`, and `422 INVALID_VALUE` with `details.field`
    (a percent over 100, or `validTo` not after `validFrom`).
  - `maxDiscount` is only kept for percentages.
  - Every coupon or offer change is audited (`COUPON_*`, `OFFER_*`).
- **Offers.**
  - The public list also has `minBookingAmount` and `demo`.
  - An offer is shown only while the offer and its coupon are active, within their dates, and the coupon is not used up.
  - The admin view adds `couponCode`, `couponStatus`, `discountLabel` and `live` (shown on the site right now).
  - Demo data: three offers (`WELCOME10`, `GOA15` seasonal, `STAY500`).
- **Events.** booking-service publishes a `BookingSnapshot` (the whole booking) on `booking.events` with every change,
  and once for every existing booking (start-up backfill). `GuestCheckedOut` completes the booking; `GuestCheckedIn`
  is shown on the timeline.

### 14.3 Admin: payments and refunds (payment-service, `PAYMENT_READ_ANY`)

| Method & path | Notes |
|---------------|-------|
| `GET /api/admin/payments?q=&status=&provider=&method=&bookingType=&from=&to=&page=&size=&sort=` | `q` = booking reference, payment id, provider payment or order id, or the customer's e-mail (all exact); rows = Payment History rows (§9) plus `bookingType`, `userId`, `contactEmail`, `providerPaymentId`, `providerOrderId`, `failureCode` |
| `GET /api/admin/payments/summary?q=&status=&provider=&method=&bookingType=&from=&to=` | `{ total, successful, failed, pending, collectedAmount, refundedAmount, currency }` for the same filters as the list (Phase 12) |
| `GET /api/payments/{paymentId}` | owner or `PAYMENT_READ_ANY`: the payment plus `refunds: [{ id, amount, status, reason, providerRefundId, failureReason, createdAt, updatedAt }]` and `invoiceNumber` |
| `GET /api/admin/refunds?q=&status=PENDING\|PROCESSED\|FAILED&from=&to=&page=&size=` | `{ id, paymentId, bookingId, bookingReference, amount, status, reason, providerRefundId, failureReason, createdAt, updatedAt }` |

Refunds are started from the booking (cancellation, `retry-refund`, goodwill refund of §14.2), never from here.

As built:
- `GET /api/admin/payments`:
  - `size` ≤ 100, `from` / `to` are India days of `createdAt`, and `sort=createdAt|amount[,asc|desc]`.
  - Rows also have `failureMessage`, `createdAt`, `verifiedAt` and `invoiceNumber`.
  - `method` (card, upi, netbanking, wallet, emi, paylater, demo) matches without regard to case; `bookingType` is
    `HOTEL` or `FLIGHT` (taken from the booking's `BookingAwaitingPayment` event; payments that predate it get it from
    the booking reference prefix `HT-` / `FL-`, migration `V3__payable_booking_type.sql`).
  - Errors: `400 INVALID_SORT`, `400 INVALID_RANGE`, `400 INVALID_FILTER` (`bookingType`).
- `GET /api/admin/payments/summary` (`PAYMENT_READ_ANY`): one grouped query over the same filters as the list.
  `successful` = captured payments (also those refunded since), `failed` = `FAILED`, `pending` = `INITIATED` and
  `PENDING`, `collectedAmount` = their amount before refunds, `refundedAmount` = money given back; `currency` is `INR`.
- `GET /api/payments/{paymentId}`: `{ id, bookingId, bookingReference, description, provider, amount, refundedAmount,
  currency, status, method, failureCode, failureMessage, createdAt, verifiedAt, invoiceNumber, providerPaymentId,
  bookingType, contactEmail, refunds: [...] }`. Anyone other than the owner or staff gets `404`.
- `GET /api/admin/refunds`: `q` also matches a refund id or payment id. Rows also have `currency`.

### 14.4 Reviews (hotel-service)

| Method & path | Who | Notes |
|---------------|-----|-------|
| `GET /api/reviews/eligible` | customer | stays I may review: `[{ bookingId, bookingReference, hotelId, hotelName, hotelSlug, checkIn, checkOut }]`: my reservations that were checked out, or confirmed and past the check-out date, without a review yet |
| `POST /api/reviews` | customer | `{ bookingId, rating (1–5), title (3–100), text (20–2000) }` → `201 Review` with status `PENDING`. `422 NOT_ELIGIBLE` (not my stay, or not completed), `409 ALREADY_REVIEWED`. Photos: not enabled (setting `reviews.photos.enabled = false`). |
| `GET /api/reviews/mine` | customer | my reviews, any status, with `rejectionReason` |
| `POST /api/reviews/{id}/report` | any logged-in user | `{ reason (5–300) }` → `204`; once per user (`409 ALREADY_REPORTED`), never your own (`422 OWN_REVIEW`); the review goes to the moderation queue (`reported`) |
| `GET /api/hotels/{idOrSlug}/reviews?page=&size=&sort=RECENT\|HIGHEST\|LOWEST` | **public** | approved reviews `{ id, rating, title, text, authorName ("Asha R."), stayedIn ("Nov 2026"), createdAt }` + `summary: { average, count, distribution: { "5": 10, … } }` |
| `GET /api/reviews/featured?limit=6` | **public** | approved reviews with rating ≥ 4, newest first, with `hotelName`, `hotelSlug`, `city` (home page) |
| `GET /api/admin/reviews?status=PENDING\|APPROVED\|REJECTED&reported=true&q=&page=&size=` | `REVIEW_MODERATE` | `{ id, hotelId, hotelName, bookingReference, authorName, rating, title, text, status, reportCount, reports: [{ reason, createdAt }], createdAt, moderatedAt, rejectionReason }`; `reported=true`: reports not yet reviewed |
| `POST /api/admin/reviews/{id}/approve` · `POST /api/admin/reviews/{id}/reject` | `REVIEW_MODERATE` | reject needs `{ reason (5–300) }`; approving (or rejecting an approved one) updates the hotel's rating and the search index; clears open reports. Audited. |
| `GET /api/hotel-manager/hotels/{hotelId}/reviews?status=&rating=1-5&sort=newest\|oldest\|highest\|lowest&page=&size=` | the hotel's manager / admin | the hotel's reviews (read only); `422 INVALID_RATING` / `INVALID_SORT` |
| `GET /api/hotel-manager/hotels/{hotelId}/reviews/summary` | the hotel's manager / admin | `{ average, total, fiveStar, positive (4–5 stars), negative (1–2), pending, distribution: { "1": n, … "5": n }, months: [last 12 months, oldest first: { month: "2026-10", reviews, average, positive, negative }] }`; everything but `pending` counts approved reviews only |

The hotel's `guestRating` / `reviewCount` combine the seeded demo figures with approved reviews. Live: `review.changed`.

As built:
- **Pages.** `GET /api/reviews/mine` and the manager list are pages.
  - `GET /api/hotels/{idOrSlug}/reviews` is a page plus `summary`. Defaults: `size` 10, sort `RECENT`.
  - `summary.average` is `null` when there are no reviews. `distribution` always has the keys `"5"` … `"1"`.
- **Responses.** Approve and reject return the admin item (`200`). Featured reviews also have `hotelId`; admin items also
  have `stayedIn`.
- **Admin list.** `sort=createdAt|rating|moderatedAt`. `reported=false` returns reviews with no open report.
- **Who may review.** Only the customer who booked the stay. The stay must be `CHECKED_OUT`, or `CONFIRMED` with a
  check-out date before today in the hotel's time zone. Someone else's or an unknown booking → `422 NOT_ELIGIBLE` (ids
  cannot be probed). Two tabs submitting at once also get `409 ALREADY_REVIEWED`.
- **Author.** "First L." comes from the account, otherwise from the lead guest. `stayedIn` is the check-in month.
- **Reports.** Only approved reviews can be reported; for any other review, everyone except its author gets `404`.
  Every approve or reject closes the open reports, so approving an approved review is how a moderator keeps a reported
  one. Rejecting an already rejected review → `409 INVALID_REVIEW_STATE`.
- **Rating.** `(seed rating × seed count + approved ratings) / (seed count + approved count)`, one decimal, recalculated
  from scratch.
  - It changes only when a review becomes approved or stops being approved.
  - The hotel row is locked while it is written. The rating is written apart from the managers' `version`, so their
    edits do not clash with it.
  - The search index is updated after commit, and again through `HotelCatalogChanged`.
  - Moderation is audited with ids, rating and counts only, never the text or the rejection reason.
- **Live.** `review.changed` is sent on create, report, approve and reject to the author, the hotel's managers and
  `ADMIN`.

### 14.5 Hotel manager: reservations, guests, check-in/out, reports (hotel-service)

Same access rule as §6 (`403 HOTEL_NOT_ASSIGNED`). Base path `/api/hotel-manager/hotels/{hotelId}`.

| Method & path | Notes |
|---------------|-------|
| `GET /dashboard?range=&from=&to=&interval=` | `{ range, today: { arrivals, departures, inHouse, occupancyPercent, …, totalRooms, roomsForSale, roomsBooked (the rooms behind tonight's occupancy) }, upcomingArrivals: [reservation rows of the next 7 days], stats: { reservations, roomNights, revenue, cancellations, occupancyPercent, averageDailyRate } }` (stats for the range); `interval` and the v2 fields: Phase 11, see the end of this section |
| `GET /reservations?status=&from=&to=&dateField=CHECK_IN\|CREATED&q=&page=&size=&sort=` | `{ reservationId, bookingId, bookingReference, status: HELD\|CONFIRMED\|CHECKED_IN\|CHECKED_OUT\|NO_SHOW\|CANCELLED\|EXPIRED\|RELEASED, checkIn, checkOut, nights, rooms, adults, children, roomTypeName, ratePlanName, leadGuest, totalAmount, confirmationNumber, createdAt }`; `q` = booking reference, confirmation number or guest name; `roomTypeId` = only this room type (`404` for a room type of another hotel); held/expired/released only with `status=` |
| `GET /reservations/summary?from=&to=&dateField=&q=&roomTypeId=` | the counts above the list, for the same filters but not the status: `{ total (every paid reservation), confirmed, pending (held, waiting for payment), checkedIn, checkedOut, cancelled, noShow }` |
| `GET /reservations/{reservationId}` | the row plus `guests: [{ roomNo, firstName, lastName }]`, `contactEmail`, `contactPhone`, `specialRequests`, `checkedInAt`, `checkedOutAt`, `cancelledAt`, `cancellationReference`, `cancelledBy: CUSTOMER\|HOTEL` |
| `POST /reservations/{id}/check-in` | `CONFIRMED` → `CHECKED_IN`, from the check-in day (hotel time) until check-out (`409 INVALID_RESERVATION_STATE` / `422 NOT_CHECK_IN_DAY`) |
| `POST /reservations/{id}/check-out` | `CHECKED_IN` → `CHECKED_OUT` (also early; the booking is completed) |
| `POST /reservations/{id}/no-show` | `CONFIRMED` → `NO_SHOW`, only from the day after check-in |
| `POST /reservations/{id}/cancel` | `{ reason (5–300) }`: the **hotel** cancels a confirmed stay before check-in (overbooking, closure): rooms back on sale, the guest is refunded **in full** (booking-service), audited |
| `GET /reports/occupancy?range=&from=&to=` and `/export?format=csv` | per night `{ date, roomNights, bookedRoomNights, occupancyPercent }` + totals |
| `GET /reports/room-types?range=&from=&to=` | room type performance of the period: `{ range, currency, rows: [{ roomTypeId, name, stays, roomNights, revenue, averageDailyRate, revenueShare (%) }], roomNights, revenue }`; the revenue adds up to the revenue report (same rules); no CSV export (the page makes one in the browser) |
| `GET /reports/revenue?range=&from=&to=` and `/export?format=csv` | per night of stay `{ date, roomNights, revenue (room charges without GST, spread over the nights), averageDailyRate }` + totals |

Admin across hotels (`ADMIN`): `GET /api/admin/hotels/occupancy?range=&from=&to=` → `[{ hotelId, name, city, roomNights,
bookedRoomNights, occupancyPercent, revenue }]` (+ `/export?format=csv`). Public: `GET /api/hotels/recommended?limit=6` →
active hotels by guest rating with `{ id, slug, name, city, starRating, guestRating, reviewCount, imageUrl, priceFrom, demo }`.

As built:
- **Responses.** Front-desk actions return the reservation details (`200`). Details also have `subtotal`, `taxes`,
  `confirmedAt`, `noShowAt` and `cancellationReason`; rows also have `currency`.
- **Reservation list.**
  - `status` accepts a comma-separated list.
  - `sort=checkIn|checkOut|createdAt|totalAmount|bookingReference|status` (default `createdAt,desc`).
  - `to` before `from` → `422 INVALID_DATE_RANGE`.
- **Date rules** (hotel time zone):
  - **Check-in:** from the check-in day until the check-out time on the check-out day (late arrivals).
  - **Check-out:** any time, also early.
  - **No-show:** from the day after check-in (`422 NO_SHOW_TOO_EARLY`).
  - **Cancel by the hotel:** until the end of the check-in day (`422 TOO_LATE_TO_CANCEL`); after that it is a no-show.
- **Rooms back on sale.** An early check-out or a no-show releases the nights from today on. A hotel cancellation
  releases all nights.
- **Audit and live updates.** No-show and hotel cancellation are audited, without the reason. All four actions send
  `hotel.reservation-changed`.
- **Occupancy.** Booked room-nights / room-nights for sale (`room_inventory`; held rooms do not count). On a stop-sell
  night, or for an inactive room type, only the rooms already sold count as available.
- **Revenue.** Room charges without GST, spread evenly over the nights (the last night takes the leftover cent).
  - Confirmed, checked-in, checked-out and no-show stays count; no-shows keep their revenue.
  - Cancelled stays do not count. A cancellation fee is not room revenue.
- **Shapes.**
  - Occupancy report: `{ range, hotelId, hotelName, rows, totals }`. The revenue report adds `currency`.
  - The dashboard adds `hotelId`, `hotelName` and `today.date`.
  - Admin occupancy is an object `{ range, hotels: [...], totals }`; draft hotels are left out.
- **CSV.** UTF-8 with BOM, a "Total" row, formula-safe cells. Names `occupancy-<slug>-<from>-<to>.csv`,
  `revenue-…csv`, `hotel-occupancy-<from>-<to>.csv`. Another `format` → `400 UNSUPPORTED_FORMAT`.
- **Recommended hotels.**
  - Order: guest rating (unrated last), then review count, then name. `limit` 1–24.
  - `imageUrl` is the cover thumbnail; `priceFrom` is the lowest base price of an active plan.
- **No-show event.** A no-show has no event: booking-service keeps the booking confirmed until its nightly job completes
  it after the stay.

Events: `GuestCheckedIn`, `GuestCheckedOut` (booking-service completes the booking on check-out) and
`HotelReservationCancelled` with `initiatedBy: HOTEL`, the hotel's `reason` and a new `cancellationId` made by the
hotel. booking-service records a cancellation by the hotel (no fee, idempotent on that id) and refunds everything
the customer still has with us. If the customer's own cancellation is waiting at that moment, that cancellation is
completed without a fee instead. The customer gets "The hotel cancelled your stay" by bell, e-mail and PDF. Live: `hotel.reservation-changed`.

**Dashboard v2 (Phase 11), additive.** `GET /dashboard` takes the new parameter `interval` (§14.0) and ranges up to five
years (the reports keep 366 days). `HOTEL_NOT_ASSIGNED` is checked before the range and the interval are read.

| Field | Definition |
|-------|------------|
| `today.arrivingGuests` / `departingGuests` / `inHouseGuests` | people (adults + children) of today's arrivals, departures and the guests checked in now (hotel's own day) |
| `today.inHouseRooms` | rooms of the reservations checked in now (`inHouse` stays the number of reservations) |
| `stats.availableRoomNights` / `bookedRoomNights` | rooms for sale / booked on the nights of the range (as the occupancy report) |
| `stats.revPar` | revenue per available room-night = revenue / `availableRoomNights` (0 without rooms) |
| `interval`, `previousRange` | as in §14.1 |
| `cancellations` | `{ count, byCustomer, byHotel, ofBooked, rate }`: `count` = `stats.cancellations`, by who cancelled; `ofBooked` = of `stats.reservations`, the ones cancelled since; `rate` = ofBooked / reservations × 100 |
| `ratings` | `{ guestRating, reviewCount, newReviews, averageNewRating, pendingReviews }`: the hotel's rating now (as on the hotel page), the reviews approved in the range and their average (`null` without any), the reviews waiting for moderation now |
| `comparison` | with `previousRange`: `revenue`, `occupancyPercent` (points), `averageDailyRate`, `revPar`, `soldRoomNights`, `reservations`, `cancellations`, `newReviews` |
| `trend[]` | per interval (`key`, `start`, `end`): `availableRoomNights`, `bookedRoomNights`, `occupancyPercent`, `soldRoomNights`, `revenue`, `averageDailyRate`, `revPar`, `reservations`, `cancellations`, `newReviews` + `averageRating` (approved in the point), `guestRating` + `reviewCount` (the hotel's rating at the end of the point) |

Revenue is room charges without GST, spread over the nights (as the revenue report). Bookings, cancellations and
reviews count by India day; nights are hotel nights.

### 14.6 Support agents: tickets and metrics (notification-service, `SUPPORT_TICKET_MANAGE`)

| Method & path | Notes |
|---------------|-------|
| `GET /api/admin/support/tickets?status=&category=&priority=&assigned=ME\|UNASSIGNED\|ANY&agent=&from=&to=&q=&page=&size=&sort=` | the queue (`agent` = an agent's user id; `from` / `to` = India days the ticket was opened, both inclusive, `400 INVALID_RANGE` when reversed): summaries of §10c plus `customerEmail`, `priority`, `assignedAgentId`, `assignedToMe`; `q` = ticket number, e-mail or subject |
| `GET /api/admin/support/summary` | `{ open, inProgress, waitingCustomer, escalated, unassigned, assignedToMe, resolved, highPriority, total }`: `resolved` = waiting to be closed, `highPriority` = HIGH and not resolved or closed, `total` = every ticket (Phase 12) |
| `GET /api/admin/support/metrics?range=&from=&to=&interval=` | dashboard (Phase 11): `byStatus` and `open` (all tickets now), `age` of the open tickets (buckets `UNDER_1_DAY`, `1_TO_3_DAYS`, `3_TO_7_DAYS`, `OVER_7_DAYS`, `averageHours`, `oldestOpenedAt`), `opened` / `resolved` in the range and per interval (`series`), `openedByCategory`, `firstResponse` (minutes to the first agent or admin answer for tickets opened in the range: `averageMinutes`, `medianMinutes`, `responded`, `awaiting`), `resolution` (`averageHours` from opening to resolving), `comparison` with the previous period. Default `LAST_30_DAYS`, up to five years (§14.0). |
| `POST /api/admin/support/tickets/{id}/assign` | `{ agentId? }` (none = me) → ticket |
| `PATCH /api/admin/support/tickets/{id}/status` | `{ status: OPEN\|IN_PROGRESS\|WAITING_CUSTOMER\|ESCALATED\|RESOLVED\|CLOSED, priority?: NORMAL\|HIGH }` → ticket |
| `GET /api/support/tickets/{id}`, `POST /api/support/tickets/{id}/messages` | as §10c; an agent's reply notifies the customer (bell + e-mail, category `SUPPORT`) and sets `WAITING_CUSTOMER` |

As built:
- **Queue.**
  - Default order: the oldest last message first. `sort=lastMessageAt|createdAt[,asc|desc]`, `size` ≤ 100.
  - `q` matches the ticket number or customer e-mail exactly, or words of the subject.
  - Bad `assigned` → `400 INVALID_FILTER`.
- **Ticket details.** For staff, the ticket also has `customerEmail`, `priority`, `assignedAgentId` and `assignedToMe`.
  These are `null` for the customer.
- **Assign.** Taking a ticket makes an `OPEN` ticket `IN_PROGRESS`. The first agent who answers an unassigned ticket
  takes it.
- **Status.** `PATCH …/status` on a closed ticket → `409 TICKET_CLOSED`. Assignment and status changes are audited
  (`TICKET_ASSIGNED`, `TICKET_STATUS_CHANGED`).
- **E-mail.** The customer's e-mail ("New reply on your support ticket TK-…") goes out after the reply is saved. It links
  to the ticket and does not contain the reply itself. A customer who turned off support e-mails gets no e-mail.
- **Metrics (Phase 11).**
  - `resolved` counts tickets resolved or closed in the range and not reopened since; resolving and then closing counts
    once, at the first moment (`support_tickets.resolved_at`).
  - Times are wall-clock time (no business hours). Customer and system messages never count as an answer.
  - `comparison`: `opened`, `resolved` and `averageFirstResponseMinutes` (`null` when either period has no answered
    ticket; for the response time `DOWN` is good).

### 14.7 Already available for the admin portal

Users (§4, identity-service), hotels (§7), flight providers (§10a), audit logs (§11), system settings (§12), booking lookup
and actions (§8.5).

### 14.8 Customer dashboard (booking-service, Phase 11)

**`GET /api/bookings/summary?range=&from=&to=`**: any signed-in user, always the caller's own bookings (the user comes
from the token; staff accounts get their own, usually empty, figures). `range`: the presets of §14.0 (default
`LAST_12_MONTHS`), `CUSTOM` (at most five years) or `ALL_TIME` (from the day of the user's first booking, at most ten
years back). No `interval` and no comparison. Errors: `400 INVALID_RANGE`, `401` without a token.

| Field | Definition |
|-------|------------|
| `range` | the range used, `{ preset, from, to }` |
| `bookings` | paid bookings confirmed by the hotel or airline and **created in the range**: `total` (= `hotel` + `flight`), and of those `upcoming` (still `CONFIRMED` or `CANCELLATION_PENDING`), `completed`, `cancelled` (after confirmation) |
| `trips` | **all** the user's bookings as they are now, whatever the range (like the My Trips tabs): `upcoming`, `completed`, `cancelled` (after confirmation), `pending` (waiting for payment or confirmation); failed and expired bookings are in none |
| `spending` | the money of the bookings created in the range: `paid`, `refunded` (completed refunds), `net` = paid − refunded, `refundsInProgress`, `hotel` / `flight` = `{ paid, refunded, net }`, `currency`. A duplicate payment is refunded at once and never counts |
| `monthlyActivity[]` | one entry per calendar month of the range (first and last cut to the range): `month` (`YYYY-MM`), `start`, `end`, `bookings`, `hotelBookings`, `flightBookings`, `paid`, `refunded`, `net`; the months add up to `bookings.total` and `spending` |
| `nextTrip` | the `CONFIRMED` trip that starts first and has not ended, or `null`: `bookingId`, `reference`, `type`, `title`, `destination`, `startDate`, `endDate`, `startsAt`, `daysUntil`, `inProgress`, `totalAmount`, and `hotel` (hotel name, address, check-in/out, rooms, guests, room type, confirmation number) or `flight` (route, times in airport local time, airline, flight number, stops, passengers, PNR); the other is `null`. A booking with a cancellation waiting is not the next trip |
| `generatedAt` | when the answer was calculated |

**In the web app** (`/customer/dashboard`):
- The period is in the page URL: `?range=LAST_12_MONTHS` (the default, not written in the URL), `THIS_YEAR`,
  `PREVIOUS_YEAR`, `ALL_TIME` or `CUSTOM&from=YYYY-MM-DD&to=YYYY-MM-DD` (at most five years; the page checks the dates
  before it asks).
- The answer has no comparison, so the page asks a second time for the previous period of the same length:
  `range=CUSTOM`, `to` = the day before `range.from`, `from` = `to` − (days − 1), using the `range` the server resolved.
  Example: `LAST_12_MONTHS` on 6 Nov 2026 is 1 Dec 2025 … 6 Nov 2026 (341 days), so the previous period is
  25 Dec 2024 … 30 Nov 2025. `ALL_TIME` is not compared.
- The change is computed as in §14.0 (one decimal, half away from zero). `null` when the previous figure is 0 and the
  current one is not (shown as "New"); no change is shown when both are 0. Spending changes are shown neutral (grey),
  booking changes green or red.
- The query key `['bookings', 'summary', {range, from?, to?}]` sits under `['bookings']`, so `booking.status-changed`,
  `payment.status-changed` and `refund.status-changed` refresh the dashboard for every period
  ([REALTIME_UPDATES.md](REALTIME_UPDATES.md) §6).
- `400 INVALID_RANGE` (a hand-edited URL): the page shows the server's `detail` and "Show the last 12 months".
- The latest bookings on the dashboard come from `GET /api/bookings?tab=ALL&page=0&size=5`, the unread count in the
  quick actions from `GET /api/notifications/unread-count`.

### 14.9 How the staff portals use the dashboards (Phase 11)

- **Parameters.** The pages always send `range` (`LAST_30_DAYS` by default), `from` / `to` only for `CUSTOM`, and
  `interval` only when the user chose one; otherwise the server's choice (echoed as `interval`) is shown as "chosen
  automatically". The page URL keeps `?range=&from=&to=&interval=` (the default range is left out).
- **Interval limits.** For the current range the page counts the points per interval as the server does (§14.0) and
  disables the intervals above 366 / 262 / 120 / 20 points, with the reason. An interval in a URL that the server would
  refuse is dropped before the request. A `400 INVALID_INTERVAL` that still arrives (for example around midnight) shows
  `detail` with "Choose the interval automatically".
- **Charts** use `series[]` / `trend[]` with `start` as the category ("2 Nov", "Nov 2026", "2026"). The admin dashboard
  no longer reads `bookingTrend` / `revenueTrend`.
- **Growth.** `changePercent: null` (previous 0) is shown as a "New" chip; rates (`cancellationRate`,
  `occupancyPercent`) show `change` in percentage points ("+1.5 pp"); `averageFirstResponseMinutes: null` shows no chip.
  More cancellations, failed payments, refunds or opened tickets, or a longer response time, are shown red.
- **Payment success rate.** The answer has no comparison for it, so the admin page works out the previous rate from
  `comparison.successfulPayments.previous` and `comparison.failedPayments.previous` (one decimal) and shows the
  difference in points; nothing when the previous period had no attempts.
- **Hotel portfolio** (`/hotel-manager`). There is no portfolio endpoint: the page calls
  `GET /api/hotel-manager/hotels/{id}/dashboard` (default range) for each assigned hotel, at most two at a time, cached
  for a minute and shared with the hotel's own dashboard.
- **Support dashboard.** Three independent requests: `GET /api/admin/support/summary` (tiles),
  `GET /api/support/bookings?attention=true&size=1` (the needs-attention count) and `GET /api/admin/support/metrics`
  (range); one failing does not hide the others. `support.ticket-changed` also refreshes the metrics.
- **Reports** (admin reports, hotel reports) offer the longer presets these endpoints accept: last 90 days, last 12
  months, this year, previous year (each at most 366 days).

## 15. AI assistant: `/api/assistant` (mcp-client-service, Phase 11)

Any signed-in user (all four roles). Details, the tools per role and the security model:
[AI_ASSISTANT.md](AI_ASSISTANT.md). The assistant only reads: cancelling, paying and refunding stay on the pages with
their confirmations.

| Method & path | Request | Response |
|---------------|---------|----------|
| `GET /api/assistant/config` | | `{ enabled, model, voice: { transcription, speech }, limits: { maxMessageLength, maxAudioBytes, maxAudioSeconds, maxSpeechChars } }`. `enabled: false` = Ollama or the model is not available: hide the chat. `voice.*: false` = use the browser's speech APIs. |
| `POST /api/assistant/chat` | `{ conversationId?, message (1–2000) }`, `Accept: text/event-stream` | SSE: `conversation {id}`, then `status {text, tool}` / `delta {text, replace}`, then `done {messageId, sources: [{tool, label}], grounded}` or `error {code, message}`. Comment lines `: keep-alive` every 15 s. `delta.replace = true`: discard the text shown so far and show `text` (the grounding check replaced the answer). Before the stream: `400 VALIDATION_FAILED`, `404 CONVERSATION_NOT_FOUND`, `409 CHAT_IN_PROGRESS` (one answer at a time per user), `503 ASSISTANT_UNAVAILABLE`. `error` codes: `ASSISTANT_UNAVAILABLE`, `ASSISTANT_TIMEOUT`, `DATA_UNAVAILABLE`, `ASSISTANT_FAILED`. |
| `GET /api/assistant/conversations/{id}` | | `{ id, createdAt, updatedAt, messages: [{ id, role: user\|assistant, text, createdAt, sources, grounded }] }`, at most the last 20 messages; `404 CONVERSATION_NOT_FOUND` when expired (24 h after the last message) or someone else's |
| `DELETE /api/assistant/conversations/{id}` | | `204`; `404` as above |
| `POST /api/assistant/voice/transcriptions` | multipart `file` (WebM/Ogg/MP4/WAV/MP3/FLAC, ≤ 5 MB, ≤ 60 s; the format is read from the bytes) | `{ text }`; `400 EMPTY_AUDIO`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_AUDIO`, `422 AUDIO_TOO_LONG`, `503 VOICE_UNAVAILABLE` |
| `POST /api/assistant/voice/speech` | `{ text (1–1000) }` | `audio/mpeg`, `Cache-Control: no-store`; `503 VOICE_UNAVAILABLE` |

Rate limits (gateway, per user and route; each route has its own bucket): the chat costs 10 tokens per question at
1 token/s, burst 30 (3 questions, then one every 10 s); the rest of `/api/assistant/**` 2/s, burst 10. Over the limit
the gateway answers `429` with no body and no `Retry-After`; the `X-RateLimit-*` headers show the bucket. The chat
route has no response timeout (it streams); the other assistant routes have 90 s.

How the web app uses these endpoints (`frontend/src/features/assistant/`, [AI_ASSISTANT.md](AI_ASSISTANT.md) §7.2):
- `GET /config` once per sign-in (cached), again on window focus, every minute while `enabled` is false, and when the
  chat opens. No launcher while `enabled` is false.
- `POST /chat` with `fetch` and `Accept: text/event-stream`. Check `response.ok` and the `Content-Type` before reading
  (otherwise the body is Problem Details, or empty for the gateway's `429`). A `401` → `POST /api/auth/refresh` → one
  retry. Abort the request to stop an answer; right after that the next question may get `409 CHAT_IN_PROGRESS` for a
  moment.
- Keep the `conversation` id per tab and user (`sessionStorage`) and send it with the next question; on
  `404 CONVERSATION_NOT_FOUND` drop it and ask again without it.
- `GET /conversations/{id}` restores the panel after a reload; `DELETE` is "New chat".
- Render `delta` text as text only; on `replace: true` discard the text shown so far.
- `POST /voice/transcriptions`: multipart part `file` from `MediaRecorder`; stop recording before 60 s / 5 MB.
  `POST /voice/speech`: at most `limits.maxSpeechChars` per call; play the MP3 from a `blob:` URL (the CSP needs
  `media-src blob:`).

## 16. Global search: `/api/search` (search-service, public; more results with a login)

One search for every role (docs/GLOBAL_SEARCH_IMPLEMENTATION.md). Without a token: public pages, active hotels and
destinations. With a token the user's own records are added (customers), or what their permissions allow (support,
admins), or their hotels' reservations and reviews (hotel managers). The user always comes from the token.

| Method & path | Response |
|---------------|----------|
| `GET /api/search/suggest?q=chen` | `{ query, tookMs, groups: [{ category, label, total, items: SearchResult[] }] }`: the best 4 of each category with matches, best category first |
| `GET /api/search?q=chennai&category=ALL&page=0&size=10` | `{ query, tookMs, category, interpretation, categories: [{ category, label, total }], total, groups, results }`: `ALL` gives up to 5 results per category in `groups` (`results` null); a category (`HOTELS`, `BOOKINGS`, ...) gives a page in `results` (`content`, `page`, `size`, `totalElements`, `totalPages`) |
| `GET /api/admin/search/status` (role `ADMIN`) | `{ alias, index, mappingVersion, documents: { CATEGORY: count }, hotelsInHotelServiceIndex }` |
| `POST /api/admin/search/replay` (role `ADMIN`) | `202 { listeners, message }`: the listeners apply the events Kafka still keeps (7 days) again; pages and destinations are rebuilt |

`SearchResult`: `{ id, category, title, subtitle, snippet, url, status: { label, tone } | null, meta: [{ label, value }],
actions: [{ label, url }], highlight: { title, subtitle, snippet } }`. `url` is a page of the web app for this user;
highlights are text segments `[{ text, match }]`, never HTML.

Categories: `USERS`, `HOTELS`, `DESTINATIONS`, `BOOKINGS`, `PAYMENTS`, `REFUNDS`, `TICKETS`, `REVIEWS`, `PAGES`
(only those the user may search appear in `categories`).

Errors: `400 QUERY_TOO_SHORT` (under 2 characters), `400 QUERY_TOO_LONG` (over 100), `400 INVALID_CATEGORY`,
`400 VALIDATION_FAILED` (page 0–99, size 1–50), `403 FORBIDDEN` (a category the user may not search),
`503 SEARCH_UNAVAILABLE` (Elasticsearch down or slow).
