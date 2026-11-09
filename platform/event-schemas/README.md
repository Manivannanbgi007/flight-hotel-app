# event-schemas

All Kafka event contracts live here as Avro schemas (`.avsc`). The Maven build generates Java classes from them,
and every service depends on this module. **Never write a separate DTO class for an event.**

## Rules

1. One folder per producing domain: `settings/`, `booking/`, `hotel/`, … Shared types go in `common/`.
2. Namespace: `com.flighthotel.events.<domain>`. Record name = event name in past tense (`BookingConfirmed`).
3. Schemas are registered in Schema Registry with **BACKWARD** compatibility, so consumers on the new schema can
   still read old events:
   - ✅ add a field **with a default**
   - ✅ remove a field that had a default
   - ❌ rename a field, change its type, or add a field without a default
4. Money is always `com.flighthotel.events.common.Money` (decimal logical type), never `double`.
5. Events carry IDs and the data consumers need (event-carried state). They never carry passwords, tokens,
   full passport numbers or payment instrument data.
6. Event metadata (event ID, type, correlation ID) is **not** in the payload. Debezium puts it in Kafka headers
   (`id`, `eventType`, `correlationId`) from the outbox row.

## Topics

| Topic | Producer | Key |
|-------|----------|-----|
| `settings.events` (compacted) | reporting-service | setting key |
| `identity.events` | identity-service | user id |
| `booking.events` | booking-service | booking id |
| `hotel.events` | hotel-service | booking id / hotel id |
| `flight.events` | flight-service | booking id |
| `payment.events` | payment-service | booking id |
| `audit.events` | all services | entity id |

Each topic has a matching dead-letter topic `<topic>.DLT`.
