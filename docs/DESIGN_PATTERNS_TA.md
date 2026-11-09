# Design Patterns (தமிழ் விளக்கம்)

இந்த application-ல் பயன்படுத்தப்பட்டுள்ள design patterns: ஒவ்வொன்றும் **எங்கே** (file link) உள்ளது, **என்ன** செய்கிறது என்ற விவரத்துடன்.

> கடைசியாக analyse செய்த தேதி: 2026-11-09. Code மாறினால், இங்குள்ள file links-ஐயும் விளக்கங்களையும் சரிபார்க்கவும்.

## Contents

1. [Tech Stack](#1-tech-stack)
2. [Architecture Patterns](#2-architecture-patterns)
3. [Distributed Transaction Patterns](#3-distributed-transaction-patterns)
4. [CQRS and Read Model Patterns](#4-cqrs-and-read-model-patterns)
5. [Concurrency Patterns](#5-concurrency-patterns)
6. [Integration Patterns](#6-integration-patterns)
7. [Resilience Patterns](#7-resilience-patterns)
8. [Realtime Patterns](#8-realtime-patterns)
9. [Security Patterns](#9-security-patterns)
10. [Cross-Cutting Patterns](#10-cross-cutting-patterns)
11. [Code-Level Patterns](#11-code-level-patterns)
12. [AI Assistant Patterns](#12-ai-assistant-patterns)
13. [Frontend Patterns](#13-frontend-patterns)
14. [Deployment Patterns](#14-deployment-patterns)
15. [End-to-End Booking Flow](#15-end-to-end-booking-flow)
16. [Summary](#16-summary)

---

## 1. Tech Stack

- **Backend:** Java 21, Spring Boot 4.1, Spring Cloud Gateway, 11 microservices ([pom.xml](../pom.xml))
- **Data:** MySQL 8.4 (ஒவ்வொரு service-க்கும் தனி DB), Redis, Elasticsearch
- **Messaging:** Kafka + Schema Registry (Avro) + Debezium (outbox CDC)
- **AI:** Spring AI 2.0 + Ollama (local model `granite4:tiny-h`) + MCP. Voice-க்கு Speaches (STT/TTS).
- **Frontend:** React 19, Vite, Tailwind, TanStack Query
- **Deployment:** Docker Compose (local), Helm + Argo CD (kind / EKS)

---

## 2. Architecture Patterns

- **Microservices:** identity, hotel, flight, booking, payment, notification, reporting, search, mcp-server, mcp-client, api-gateway. ஒவ்வொரு service-உம் தனி business பகுதியைக் கையாளும்.
- **Database per Service:** ஒவ்வொரு service-க்கும் தனி DB உள்ளது (`booking_db`, `hotel_db`, `payment_db`...). ஒரு service இன்னொரு service-ன் table-ஐ நேரடியாகப் படிக்காது.
- **API Gateway:** [api-gateway](../services/api-gateway/) தான் ஒரே நுழைவாயில். Routing, JWT check, rate limit எல்லாம் இங்கே நடக்கும்.
- **Shared Library / Custom Starter:** [common-lib](../platform/common-lib/) `@AutoConfiguration` மூலம் outbox, security, error handling, logging-ஐ எல்லா services-க்கும் தானாகக் கொடுக்கிறது.
- **Contract-First Events:** [event-schemas](../platform/event-schemas/)-ல் Avro schemas + Schema Registry உள்ளன. Event format மாறினால் compile நேரத்திலேயே தெரியவரும்.

---

## 3. Distributed Transaction Patterns

> இந்த app-ன் மிக வலுவான பகுதி இதுதான்.

- **Saga (Choreography):** [BookingSaga](../services/booking-service/src/main/java/com/flighthotel/booking/service/BookingSaga.java), [FlightSaga](../services/booking-service/src/main/java/com/flighthotel/booking/service/FlightSaga.java), [CancellationSaga](../services/booking-service/src/main/java/com/flighthotel/booking/service/CancellationSaga.java)
  - Services ஒன்றுக்கொன்று command அனுப்புவதில்லை. `HotelInventoryHeld`, `PaymentSucceeded` போன்ற நடந்து முடிந்த **events**-க்கு ஒவ்வொரு service-உம் react செய்யும்.
  - தாமதமாக வரும் events-உம் duplicate events-உம் ignore செய்யப்படும்.
- **State Machine:** [BookingStatus.java](../services/booking-service/src/main/java/com/flighthotel/booking/entity/BookingStatus.java)
  - `INITIATED → PENDING_PAYMENT → PAYMENT_SUCCESS → SUPPLIER_PENDING → CONFIRMED...` என்ற அனுமதிக்கப்பட்ட transitions ஒரு Map-ல் உள்ளன. தவறான transition கேட்டால் `Booking.moveTo()` exception throw செய்யும்.
  - [BookingLifecycle](../services/booking-service/src/main/java/com/flighthotel/booking/service/BookingLifecycle.java) தான் status மாற்றும் **ஒரே வழி**. அது timeline row, realtime update, snapshot மூன்றையும் ஒரே transaction-ல் செய்யும்.
- **Transactional Outbox + CDC:** [OutboxEventPublisher](../platform/common-lib/src/main/java/com/flighthotel/common/outbox/OutboxEventPublisher.java)
  - Event முதலில் `outbox_events` table-ல், business change நடக்கும் **அதே transaction-ல்** எழுதப்படும்.
  - பிறகு Debezium (`EventRouter`, [infra/kafka-connect](../infra/kafka-connect/)) அதை Kafka-க்கு அனுப்பும். DB commit ஆனால் மட்டுமே event போகும்.
- **Inbox / Idempotent Consumer:** [ProcessedEventStore](../platform/common-lib/src/main/java/com/flighthotel/common/inbox/ProcessedEventStore.java)
  - Kafka ஒரே event-ஐ இரண்டு முறை கொடுத்தாலும், அது ஒரு முறை மட்டுமே process ஆகும். Marker row-உம் business change-உம் ஒன்றாக commit ஆகும்.
- **Compensation:** Booking fail அல்லது expire ஆனால் seats/rooms release ஆகும். Payment வந்த பிறகு booking fail ஆனால் `REFUND_PENDING` நிலைக்குப் போகும்.
- **Retry + Dead Letter Topic:** [CommonKafkaAutoConfiguration](../platform/common-lib/src/main/java/com/flighthotel/common/config/CommonKafkaAutoConfiguration.java)
  - Exponential backoff-உடன் retry செய்யும். அதன் பிறகும் தோல்வியடைந்தால் message `<topic>.DLT`-க்குப் போகும். ஒரு உடைந்த message partition-ஐ block செய்யாது.
- **Reconciliation:** [ReconciliationService](../services/payment-service/src/main/java/com/flighthotel/payment/service/ReconciliationService.java)
  - Webhook தொலைந்தாலோ browser tab மூடப்பட்டாலோ, ஒவ்வொரு 5 நிமிடத்துக்கும் provider-இடம் payment status-ஐக் கேட்டுச் சரிசெய்யும்.
  - Flight ticket order outcome தெரியாவிட்டால், [HoldService](../services/flight-service/src/main/java/com/flighthotel/flight/booking/HoldService.java) கண்மூடித்தனமாக retry செய்யாது; reconcile மட்டுமே செய்யும்.
- **Idempotency Key:** [IdempotencyKeys](../services/booking-service/src/main/java/com/flighthotel/booking/service/IdempotencyKeys.java). பணம் சம்பந்தப்பட்ட actions இரண்டு முறை நடக்காது.

---

## 4. CQRS and Read Model Patterns

- **CQRS:** Write செய்யும் இடம் MySQL (ஒவ்வொரு service-ம் தன் DB). Read செய்யும் இடங்கள் தனி:
  - [search-service](../services/search-service/): Elasticsearch-ல் global search
  - [reporting-service facts](../services/reporting-service/src/main/java/com/flighthotel/reporting/facts/FactStore.java): dashboard மற்றும் reports
- **Event-Carried State Transfer:** [BookingSnapshots](../services/booking-service/src/main/java/com/flighthotel/booking/service/BookingSnapshots.java)
  - ஒவ்வொரு மாற்றத்துக்கும் முழு booking-ஐ `BookingSnapshot` event-ஆக அனுப்பும். அதனால் reporting, search services booking-service-ஐக் கேட்க வேண்டியதில்லை.
- **Idempotent Upsert:** [IndexWriter](../services/search-service/src/main/java/com/flighthotel/search/index/IndexWriter.java), [FactStore](../services/reporting-service/src/main/java/com/flighthotel/reporting/facts/FactStore.java)
  - ஒரே event இரண்டு முறை வந்தாலும் முடிவு அதேதான். பழைய event தாமதமாக வந்தால், புதிய state-ஐ மாற்றாது.
- **Event Replay + Backfill:** [IndexMaintenance](../services/search-service/src/main/java/com/flighthotel/search/sync/IndexMaintenance.java) மூலம் Kafka topic-ஐ ஆரம்பத்திலிருந்து மீண்டும் படிக்கலாம். பழைய data-வுக்கு `*SnapshotBackfill` classes உள்ளன.

---

## 5. Concurrency Patterns

- **Pessimistic Locking:** [InventoryService](../services/hotel-service/src/main/java/com/flighthotel/hotel/inventory/InventoryService.java)
  - கடைசி room-க்கு இரண்டு பேர் போட்டியிட்டால் `SELECT ... FOR UPDATE` காரணமாக ஒருவர் மட்டுமே வெற்றி பெறுவார். **Overbooking நடக்காது.**
  - Booking, coupon-க்கும் `PESSIMISTIC_WRITE` உள்ளது ([BookingRepository:32](../services/booking-service/src/main/java/com/flighthotel/booking/repository/BookingRepository.java#L32)).
- **Optimistic Locking:** 21 entities-ல் `@Version` உள்ளது.
- **Competing Consumers (DB Job Queue):** [AuditExportRunner](../services/reporting-service/src/main/java/com/flighthotel/reporting/export/AuditExportRunner.java)
  - பல instances ஓடினாலும், conditional UPDATE மூலம் ஒரு job-ஐ ஒரே ஒரு instance மட்டுமே எடுக்கும்.
- **Expiring Hold (TTL):**
  - [HoldExpiryJob](../services/hotel-service/src/main/java/com/flighthotel/hotel/scheduler/HoldExpiryJob.java): Customer பணம் செலுத்தாவிட்டால் hold செய்த rooms மீண்டும் விற்பனைக்கு வரும்.
  - [OfferStore](../services/flight-service/src/main/java/com/flighthotel/flight/service/OfferStore.java): Flight search results Redis-ல் 20 நிமிடங்கள் மட்டுமே இருக்கும்.

---

## 6. Integration Patterns

- **Strategy + Adapter:**
  - Payment: [PaymentProvider](../services/payment-service/src/main/java/com/flighthotel/payment/provider/PaymentProvider.java) interface-க்கு `RazorpayPaymentProvider`, `DemoPaymentProvider` என இரண்டு implementations. Razorpay-ன் paise → rupees மாற்றம் adapter-க்குள்ளேயே நடக்கும்.
  - Flight: [FlightProviders](../services/flight-service/src/main/java/com/flighthotel/flight/integration/FlightProviders.java) interfaces-ஐ [DemoFlightProvider](../services/flight-service/src/main/java/com/flighthotel/flight/integration/demo/DemoFlightProvider.java) implement செய்கிறது.
- **Anti-Corruption Layer:** [FlightModel](../services/flight-service/src/main/java/com/flighthotel/flight/integration/FlightModel.java) ஒரு provider-neutral model. Supplier-ன் format உள்ளே கசியாது.
- **Registry + Failover:** [ProviderRegistry](../services/flight-service/src/main/java/com/flighthotel/flight/service/ProviderRegistry.java)
  - Search-க்கு, DOWN இல்லாத, அதிக priority உள்ள provider தேர்வாகும். Booking-ஐ எப்போதும் அதை hold செய்த provider-ஏ கையாளும்.
  - [PaymentProviders](../services/payment-service/src/main/java/com/flighthotel/payment/config/PaymentProviders.java)-உம் இதே முறையில் வேலை செய்கிறது.
- **Health Check:** [ProviderHealthJob](../services/flight-service/src/main/java/com/flighthotel/flight/booking/ProviderHealthJob.java). Provider health-ஐ அவ்வப்போது சரிபார்க்கும்.
- **Secure Webhook:** [WebhookService](../services/payment-service/src/main/java/com/flighthotel/payment/service/WebhookService.java)
  - Raw bytes மீது signature சரிபார்த்த பிறகே parse செய்யும். Duplicate event id ignore செய்யப்படும்.

---

## 7. Resilience Patterns

- **Circuit Breaker (custom):** [CircuitBreaker](../services/mcp-server-service/src/main/java/com/flighthotel/mcpserver/gateway/CircuitBreaker.java)
  - தொடர்ந்து பல failures வந்தால், சிறிது நேரத்துக்கு calls உடனே fail ஆகும் (fail fast). ஒவ்வொரு area-க்கும் (`/api/bookings`, `/api/admin`) தனி breaker.
- **Retry + Timeout:** [GatewayClient](../services/mcp-server-service/src/main/java/com/flighthotel/mcpserver/gateway/GatewayClient.java)
  - குறுகிய timeouts. GET calls மட்டும் ஒருமுறை retry ஆகும் (reads idempotent என்பதால்).
- **Graceful Degradation:**
  - Redis down ஆனால் rate limiter requests-ஐ block செய்யாமல் அனுமதிக்கும் ([RateLimitConfig](../services/api-gateway/src/main/java/com/flighthotel/gateway/config/RateLimitConfig.java)).
  - Realtime signal தோல்வியடைந்தாலும் business operation உடையாது.

---

## 8. Realtime Patterns

- **Pub/Sub + After-Commit Publish:** [RealtimePublisher](../platform/common-lib/src/main/java/com/flighthotel/common/realtime/RealtimePublisher.java)
  - DB commit ஆன **பிறகு** மட்டுமே Redis Pub/Sub-க்கு signal போகும். Rollback ஆனால் எதுவும் அனுப்பப்படாது.
- **SSE Hub + Connection Registry:** [RealtimeHub](../services/notification-service/src/main/java/com/flighthotel/notification/realtime/RealtimeHub.java), [RealtimeConnectionRegistry](../services/notification-service/src/main/java/com/flighthotel/notification/realtime/RealtimeConnectionRegistry.java)
  - User மற்றும் role அடிப்படையில் சரியான browser connections-க்கு மட்டும் அனுப்பும். Heartbeat உண்டு. Shutdown ஆகும்போது clients-ஐ வேறு instance-க்கு reconnect செய்யச் சொல்லும்.

---

## 9. Security Patterns

- **JWT (RS256) + JWKS + Key Rotation:** [SigningKeyService](../services/identity-service/src/main/java/com/flighthotel/identity/security/SigningKeyService.java)
  - Private key encrypted-ஆக DB-ல் இருக்கும். பழைய key ஒரு நாள் வரை JWKS-ல் தொடர்ந்து இருக்கும். Key-ஐ இரண்டு instances ஒரே நேரத்தில் உருவாக்காமல் MySQL named lock தடுக்கும்.
- **Token Revocation:** [TokenRevocationValidator](../platform/common-lib/src/main/java/com/flighthotel/common/security/TokenRevocationValidator.java). Logout அல்லது password reset ஆனால் token உடனே செல்லாது.
- **RBAC + Resource Ownership:**
  - 36 files-ல் `@PreAuthorize` உள்ளது.
  - [HotelAccess](../services/hotel-service/src/main/java/com/flighthotel/hotel/staff/HotelAccess.java): Manager தன் hotels-ஐ மட்டுமே பார்க்க, மாற்ற முடியும்.
  - வேறொருவரின் data-வைக் கேட்டால் 404 வரும் (அந்த data இருக்கிறது என்பதே வெளியே தெரியாது).
- **Security Trimming:** [AccessRules](../services/search-service/src/main/java/com/flighthotel/search/query/AccessRules.java). Access filter **Elasticsearch-க்குள்ளேயே** போடப்படுகிறது. அனுமதி இல்லாத result திரும்பி வரவே வராது.
- **Field-Level Encryption:** [EncryptedStringConverter](../platform/common-lib/src/main/java/com/flighthotel/common/crypto/EncryptedStringConverter.java). Passport போன்ற sensitive columns encrypt செய்யப்படுகின்றன.
- **Service-to-Service API Key:** [ApiKeyFilter](../services/mcp-server-service/src/main/java/com/flighthotel/mcpserver/security/ApiKeyFilter.java). MCP server-ஐ mcp-client மட்டுமே அழைக்க முடியும்.
- **Rate Limiting:** Gateway-ல் Redis அடிப்படையில், per user அல்லது per IP, ஒவ்வொரு route-க்கும் தனி bucket.

---

## 10. Cross-Cutting Patterns

- **AOP Logging:** [ServiceLoggingAspect](../platform/common-lib/src/main/java/com/flighthotel/common/logging/ServiceLoggingAspect.java). எல்லா `@Service` methods-க்கும் duration மற்றும் outcome log ஆகும். PII ஆபத்து காரணமாக arguments log ஆகாது.
- **Correlation ID:** [CorrelationIdFilter](../platform/common-lib/src/main/java/com/flighthotel/common/correlation/CorrelationIdFilter.java) (HTTP) மற்றும் [CorrelationIdRecordInterceptor](../platform/common-lib/src/main/java/com/flighthotel/common/kafka/CorrelationIdRecordInterceptor.java) (Kafka). ஒரு request-ஐ எல்லா services-லும் trace செய்யலாம்.
- **Global Exception Handler + Problem Details:** [GlobalExceptionHandler](../platform/common-lib/src/main/java/com/flighthotel/common/error/GlobalExceptionHandler.java). எல்லா errors-க்கும் ஒரே JSON format. Stack trace client-க்குப் போகாது.
- **JPA Auditing:** [AuditableEntity](../platform/common-lib/src/main/java/com/flighthotel/common/persistence/AuditableEntity.java). `created_by`, `updated_at` போன்ற columns தானாக நிரம்பும்.
- **Audit Log via Outbox:** [AuditPublisher](../platform/common-lib/src/main/java/com/flighthotel/common/audit/AuditPublisher.java). Action உண்மையில் நடந்தால் மட்டுமே audit entry உருவாகும்.
- **Dynamic Config:** [SystemSettings](../platform/common-lib/src/main/java/com/flighthotel/common/settings/SystemSettings.java). Admin ஒரு setting-ஐ மாற்றினால், Kafka compacted topic வழியாக restart இல்லாமல் எல்லா services-க்கும் சில நொடிகளில் போய்ச் சேரும்.

---

## 11. Code-Level Patterns

GoF மற்றும் பிற code-level patterns:

| Pattern | எங்கே |
|---|---|
| **Strategy** | `PaymentProvider`, `FileStorage` ([Local / S3](../platform/common-lib/src/main/java/com/flighthotel/common/storage/FileStorage.java)) |
| **Adapter** | `RazorpayPaymentProvider`, `DemoFlightProvider` |
| **Factory** | [DocumentFactory](../services/notification-service/src/main/java/com/flighthotel/notification/document/DocumentFactory.java): ticket, invoice, voucher PDFs |
| **Builder** | Avro events (`BookingInitiated.newBuilder()`), Spring AI options |
| **Registry** | `ProviderRegistry`, `PaymentProviders`, `RealtimeConnectionRegistry` |
| **State** | `BookingStatus` transition table |
| **Observer** | Kafka `@KafkaListener` (21 files), Redis Pub/Sub |
| **Repository** | Spring Data repositories |
| **Specification** | [UserSpecifications](../services/identity-service/src/main/java/com/flighthotel/identity/repository/UserSpecifications.java): dynamic filters |
| **DTO + Mapper** | [IdentityMapper](../services/identity-service/src/main/java/com/flighthotel/identity/mapper/IdentityMapper.java) (MapStruct). Entities service layer-ஐ விட்டு வெளியே போகாது. |
| **Service Interface + Impl** | [identity service/impl](../services/identity-service/src/main/java/com/flighthotel/identity/service/impl/) |
| **Command** | [ToolDefinition](../services/mcp-server-service/src/main/java/com/flighthotel/mcpserver/tools/ToolDefinition.java)`.Handler`: ஒவ்வொரு tool-உம் ஒரு command |
| **Sealed Types (ADT)** | [ChatEvent](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/chat/ChatEvent.java), `StreamingGuard.Output` |

---

## 12. AI Assistant Patterns

- **Spring AI ChatClient + Local LLM:** [ChatService](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/chat/ChatService.java). Ollama-வில் `granite4:tiny-h` model, streaming response.
- **MCP Client–Server பிரிவு:**
  - [mcp-server-service](../services/mcp-server-service/): tools இங்கே உள்ளன. அனைத்தும் **read-only**.
  - [mcp-client-service](../services/mcp-client-service/): LLM மற்றும் chat இங்கே.
- **Role-Based Tool Exposure:** [ToolSet](../services/mcp-server-service/src/main/java/com/flighthotel/mcpserver/tools/ToolSet.java) groups (customer, admin, manager, support). User-ன் role-க்கு உரிய tools மட்டுமே LLM-க்குத் தெரியும்.
- **On-Behalf-Of Token:** [McpToolGateway](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/tools/McpToolGateway.java). Tools **user-ன் சொந்த JWT**-உடன் ஓடும். அதனால் gateway-ன் எல்லா permission rules-உம் அப்படியே பொருந்தும்.
- **Guardrails (Hallucination தடுப்பு):**
  - [GroundingGuard](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/grounding/GroundingGuard.java): Tool results-ல் இல்லாத booking ref, PNR அல்லது amount பதிலில் வந்தால், அந்தப் பதில் மாற்றப்படும்.
  - [StreamingGuard](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/grounding/StreamingGuard.java): Streaming நடக்கும்போதே கடைசி சில words-ஐ நிறுத்தி வைத்துச் சரிபார்க்கும். தவறான மதிப்பு browser-க்குப் போகவே போகாது.
  - [ToolFirstGate](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/ToolFirstGate.java): Live data பற்றிய கேள்விக்கு tool call இல்லாமல் LLM தன் நினைவிலிருந்து பதில் சொல்ல முடியாது.
- **Rule-Based Routing (LLM இல்லாமல்):** [Intent](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/Intent.java). கேள்வியின் words வைத்தே intent கண்டுபிடிக்கப்படுகிறது.
- **Deterministic UI:** [BlockBuilder](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/BlockBuilder.java), [ActionPlanner](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/ActionPlanner.java), [ResponseAssembler](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/ResponseAssembler.java)
  - Cards-ம் buttons-ம் tool results-லிருந்து code மூலமே உருவாகின்றன. **இங்கே LLM எதையும் முடிவு செய்வதில்லை.**
  - [Route](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/blocks/Route.java) allowlist-ல் உள்ள route keys மட்டுமே பயன்படும். LLM எந்த URL-ஐயும் உருவாக்க முடியாது.
- **Memory:** [ConversationStore](../services/mcp-client-service/src/main/java/com/flighthotel/assistant/memory/ConversationStore.java). Redis-ல் 24 மணி நேர TTL, அதிகபட்சம் 20 messages (sliding window). ஒரு user-க்கு ஒரே நேரத்தில் ஒரு பதில் மட்டுமே (lock).
- **Limits:** ஒரு கேள்விக்கு max tool calls, first-token மற்றும் total timeouts.
- **Evals:** [tests/assistant/eval-cases.json](../tests/assistant/eval-cases.json) + [model-eval.mjs](../tests/assistant/model-eval.mjs). எதிர்பார்க்கும் tool, arguments, கட்டாயம் இருக்க வேண்டிய words, இருக்கக்கூடாத words ஆகியவற்றை வைத்து model சோதிக்கப்படுகிறது.
- **இல்லாதவை:** RAG/VectorStore இல்லை, multi-agent இல்லை. இது **ஒரே agent + வலுவான deterministic guardrails** என்ற design.

---

## 13. Frontend Patterns

- **Feature-Based Structure:** [frontend/src/features/](../frontend/src/features/) (flights, hotels, bookings, admin...)
- **Provider Pattern (React Context):** [AuthProvider, RealtimeProvider](../frontend/src/app/providers/)
- **Route Guards:** [guards.tsx](../frontend/src/app/guards.tsx). Role அடிப்படையில் pages பாதுகாக்கப்படுகின்றன.
- **Server-State Cache:** TanStack Query
- **Schema Validation:** zod + react-hook-form
- **API Layer:** [frontend/src/lib/api/](../frontend/src/lib/api/) (axios)

---

## 14. Deployment Patterns

- **Reusable Helm Chart:** [deploy/charts/microservice/](../deploy/charts/microservice/). எல்லா services-க்கும் ஒரே template (HPA, PDB, ConfigMap).
- **GitOps:** [deploy/argocd/](../deploy/argocd/)
- **Environment Overlays:** kind (local), EKS (production)

---

## 15. End-to-End Booking Flow

ஒரு booking-ல் இந்த patterns எப்படி ஒன்றாக இணைகின்றன:

```
Customer → API Gateway (JWT, Rate Limit)
   → booking-service: INITIATED (State Machine) + outbox row (ஒரே transaction)
   → Debezium → Kafka → hotel-service (Inbox check)
   → Inventory FOR UPDATE lock → HotelInventoryHeld (Outbox)
   → booking-service (Saga) → PENDING_PAYMENT
   → payment-service (Razorpay Adapter, Idempotency Key, Webhook signature, Reconciliation)
   → PaymentSucceeded → CONFIRMED
   → BookingSnapshot → search-service + reporting-service (CQRS read models)
   → After-commit Redis signal → SSE → Browser தானாக refresh
   → notification-service → Email + PDF (Factory)
```

---

## 16. Summary

- **மிக வலுவான பகுதிகள்:**
  - Data consistency (Saga + Outbox + Inbox + State Machine + Reconciliation)
  - Concurrency (overbooking தடுப்பு)
  - Security (ownership, security trimming, token revocation)
  - AI guardrails (grounding check, tool-first rule)
- Payment, inventory போன்ற நம்பகத்தன்மை முக்கியமான இடங்களில் code deterministic-ஆக உள்ளது. LLM-க்கு read-only tools மட்டுமே கொடுக்கப்பட்டுள்ளன.
- மேலும் விவரங்களுக்கு: [BOOKING_WORKFLOW.md](../BOOKING_WORKFLOW.md), [SUPPLIER_INTEGRATION.md](../SUPPLIER_INTEGRATION.md), [PAYMENT_INTEGRATION.md](../PAYMENT_INTEGRATION.md), [REALTIME_UPDATES.md](../REALTIME_UPDATES.md), [SECURITY_GUIDE.md](../SECURITY_GUIDE.md), [AI_ASSISTANT.md](../AI_ASSISTANT.md).
