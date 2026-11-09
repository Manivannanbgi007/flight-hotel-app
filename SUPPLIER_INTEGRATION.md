# Supplier Integration (Flights and Hotels)

> Status: **Phase 1 draft** (2026-11-02). The evaluation below was checked on this date. Supplier programs
> change often, so re-check them before signing any agreement.

## 1. Which suppliers can realistically be used?

| Supplier | What it offers | Access today | Verdict for this project |
|----------|---------------|-------------|--------------------------|
| **Amadeus Self-Service** | Flight/hotel search and booking sandbox | **Shut down on 17 July 2026.** Keys disabled, portal now enterprise-only. ([PhocusWire](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)) | ❌ Not available |
| Amadeus Enterprise | Full GDS content | Commercial contract + certification | ❌ Not realistic for a demo |
| **Duffel** (flights, also "Stays" for hotels) | Modern REST API; test mode with a fictional test airline, "Duffel Airways" ([docs](https://duffel.com/docs/api/overview/test-mode)) | Test mode is documented. One 2026 source says new individual developers can no longer self-register — **unconfirmed**. Live mode needs business verification and has per-order fees. | ⚠️ Best candidate for a real flight adapter **if** you can get a test token |
| Travelport / Sabre | GDS content | Agency/enterprise agreements, certification | ❌ Not realistic for a demo |
| **Hotelbeds APItude** | Hotel search/booking | Free evaluation key, test host `api.test.hotelbeds.com`, **50 requests/day**; production needs certification + contract ([developer portal](https://developer.hotelbeds.com/documentation/)) | ⚠️ Possible optional external hotel source later |
| Expedia Rapid, Booking.com Demand API | Hotel content | Partner approval required | ❌ Not for now |

### Decision

- **Flights:** a clearly labelled **DEMO provider** first (decision D2). The interfaces are designed so a Duffel adapter
  (or another supplier) can be added later through configuration only, without changing booking logic.
- **Hotels:** our own **internal inventory** managed by Hotel Managers (decision D3). An external hotel provider
  (for example Hotelbeds) can be added later behind the same interfaces.

---

## 2. Provider interfaces

All booking logic depends only on these interfaces (package `integration` in each service). Provider-specific
request/response classes live in their own sub-package (for example `integration.duffel.model`) and are mapped to
internal DTOs. They never leak outside the adapter.

```java
// flight-service
public interface FlightSearchProvider {
    ProviderInfo info();                                   // code, isDemo, capabilities
    List<FlightOffer> search(FlightSearchCriteria criteria);
    RevalidatedOffer revalidate(String offerId, PassengerCounts counts);
}

public interface FlightBookingProvider {
    ProviderInfo info();
    SeatHold hold(HoldRequest request);                    // only if info().supportsHold()
    SupplierOrder createOrder(CreateOrderRequest request); // request.idempotencyKey() = bookingId
    Optional<SupplierOrder> findOrder(String idempotencyKey, String supplierOrderId);
    SupplierCancellation cancelOrder(String supplierOrderId, String idempotencyKey); // key = cancellation id
    Optional<SupplierCancellation> findCancellation(String supplierOrderId);         // reconciliation
    HealthStatus health();
}

// hotel-service
public interface HotelSearchProvider  { /* search, details, rooms, quote */ }
public interface HotelBookingProvider { /* hold, confirm, release, cancel, find */ }
// v1 implementation: InternalHotelInventoryProvider (our MySQL inventory)

// payment-service
public interface PaymentProvider { /* see PAYMENT_INTEGRATION.md */ }
```

The active providers are chosen in configuration, for example:

```yaml
travel:
  flight:
    providers:
      demo:   { enabled: true,  priority: 1 }
      duffel: { enabled: false, priority: 2, base-url: ${DUFFEL_BASE_URL:}, token: ${DUFFEL_TOKEN:} }
```

Admins can also enable or disable providers from **Flight Provider Management** (`flight_providers` table).

---

## 3. Rules every adapter must follow (§11)

| Rule | How |
|------|-----|
| Authentication | Credentials only from environment variables or the secrets manager. Tokens refreshed automatically. |
| Timeouts | Every call has a connect and read timeout (search 10 s, revalidate 10 s, create order 30 s). |
| Retries | **Only for safe calls** (search, revalidate, get order): max 2 retries with backoff. **Never** for create order or cancel, unless the supplier supports idempotency keys. |
| Rate limits | Resilience4j rate limiter per provider; HTTP 429 → `RATE_LIMITED` with retry-after. |
| Circuit breaker | Opens after repeated failures; search shows "temporarily unavailable" instead of stale data. |
| Error normalization | Every supplier error maps to one internal code: `SUPPLIER_TIMEOUT`, `SUPPLIER_UNAVAILABLE`, `OFFER_EXPIRED`, `PRICE_CHANGED`, `SOLD_OUT`, `INVALID_PASSENGER_DATA`, `AUTH_FAILED`, `RATE_LIMITED`, `UNKNOWN`. |
| Uncertain outcomes | A timeout on create order or cancel is reported as **UNCERTAIN**, not as failure. Reconciliation resolves it (see BOOKING_WORKFLOW.md §3). |
| Correlation IDs | `X-Correlation-Id` is sent to the supplier where supported and logged with every call. |
| Safe logging | Request/response bodies are logged only at DEBUG level, with passenger names, dates of birth, passport numbers, emails and phone numbers masked. |
| Health monitoring | A scheduled health check updates `flight_providers.health_status`; visible in the admin portal and `/actuator/health`. |
| Source labelling | Every offer and booking carries its `inventory_source` (`DEMO`, `DUFFEL`, `INTERNAL`…). DEMO results show a visible **"Demo inventory"** badge in the UI. Demo and real inventory are never mixed without this label. |

---

## 4. The DEMO flight provider

The DEMO provider behaves like a small airline system living inside flight-service. Its data is in the
`demo_*` tables (see DATABASE_DESIGN.md §4).

- **Seed data** (clearly marked `DEMO`): about 40 Indian and international airports, about 10 airlines
  (with demo logos), schedules on popular routes, and fare families for all four cabins (refundable and non-refundable).
- **Pricing**: base fare by route distance × cabin multiplier × days-before-departure factor × seat-load factor.
  Prices are therefore realistic-looking, change over time, and are calculated on the backend.
- **Seats**: `demo_seat_inventory` per flight date and cabin. Holds and sales update it atomically, the same way as
  hotel inventory.
- **Supports**: search, revalidate, hold (15 min), create order (idempotent by key), find order, cancel (with
  the fare family's cancellation fee).
- **Does not support**: date changes / rebooking (assumption A7).
- **Simulation switches** (for testing every failure path, configurable and documented in TESTING_GUIDE.md):
  - `travel.flight.demo.failure-rate`, `travel.flight.demo.timeout-rate` (default 0)
  - Magic passenger last names: `TIMEOUT` → create-order timeout (then found by reconciliation), `REJECT` → supplier
    rejects the order, `PRICECHANGE` → revalidation returns a higher price.

### 4.2 Cancellations (Phase 7)

- The DEMO airline remembers what it sold with each order (`demo_orders`: seats, fare, total, fee %; orders issued
  before Phase 7 were filled in by the `V3__cancellations.sql` migration from flight-service's own records).
- `cancelOrder`: allowed until **4 hours before the first departure** (airport time zone), fee = the fare family's
  fee % of the **fare** (Saver 100 %, Flex 10–25 %; taxes and charges are refunded), the sold seats go back on sale,
  reference `DX` + 8 characters. Idempotent: cancelling a cancelled order returns the same cancellation.
- Refusals are `SupplierRejectedException` with a code: `TOO_LATE`, `NOT_ALLOWED`, `NOT_CANCELLABLE`. A timeout is an
  unknown outcome: flight-service marks the booking `CANCEL_UNCERTAIN` and looks it up with `findCancellation`,
  never cancelling twice (BOOKING_WORKFLOW.md §4.1).
- Simulation last names: `NOCANCEL` → the airline refuses; `CANCELTIMEOUT` → cancelled but the answer is lost (found by
  reconciliation); `CANCELLOST` → no answer and nothing cancelled (after several looks the customer is told the
  booking is still valid).

### 4.1 As built in Phase 6

- Interfaces: `FlightSearchProvider` (`search`, `quote`) and `FlightBookingProvider` (`hold`, `release`, `createOrder`,
  `findOrder`, `checkHealth`, and since Phase 7 `cancelOrder`, `findCancellation`) in `com.flighthotel.flight.integration`;
  the DEMO adapter implements both. `ProviderRegistry` picks the provider for searches (enabled, not DOWN, best priority)
  and always the booking's own provider for orders and cancellations.
- Data (seeded when empty, labelled DEMO): 41 airports, 12 airlines, 8 fare families and about 1,350 generated schedules
  on popular routes (domestic hubs, international gateways; some flights with one stop and a layover). A flight is one
  flight number, possibly with a technical stop, so one seat inventory per flight, date and cabin.
- Simulation switches (all tested): last name `REJECT` → the order is rejected; `TIMEOUT` → the order **is** issued but the
  answer is lost (found later by reconciliation); `TIMEOUTLOST` → the answer and the order are lost (reconciliation finds
  nothing and the customer is refunded); `flight.demo.failure-rate` / `timeout-rate` do the same at random.
  **Deviation from section 4:** `PRICECHANGE` is not a passenger name. Passengers are entered after the revalidate step, so
  a changed fare is shown at revalidate (price rose since the search) or refused at the hold (`PRICE_CHANGED`); the tests move the
  flight's seat fill to change the price.
- Not built: Elasticsearch for flights (the DEMO timetable is queried directly; an index adds nothing at this size),
  airline logos, seat selection.

## 5. Adding a real supplier later (checklist)

1. Get sandbox credentials and read the supplier's booking flow (hold? ticketing deadline? idempotency support?).
2. Create `integration.<supplier>` with its own model classes, a client (timeouts, auth) and a mapper.
3. Implement `FlightSearchProvider` / `FlightBookingProvider` and map all errors to the internal codes.
4. Add the provider to `flight_providers` and to configuration (disabled by default).
5. Write contract tests using recorded sandbox responses, plus a sandbox smoke test.
6. Update this document.
