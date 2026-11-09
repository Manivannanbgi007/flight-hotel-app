# Hotel & Flight Travel Reservation System

A web application where customers search and book flights and hotels, pay online, manage trips, cancel with
refunds, and download confirmations and invoices. It also has portals for administrators, hotel managers
and support agents.

> **Project status:** Phase 11 (redesign, sign-in per role, analytics, AI assistant) ✅ done on top of Phases 5–10.
> - **Customers** search, book and pay for **flights** and **hotels** (the **DEMO** payment, or Razorpay test mode once
>   you add keys). They cancel under the booked terms, get every step by bell, e-mail and PDF, and review their stays.
>   Their dashboard (`/customer/dashboard`) shows the next trip, trips and spending.
> - **Admins** (`/admin`) have a live dashboard: daily to yearly figures with growth against the previous period, hotel
>   vs flight, payments, cancellations and customers. They also have reports with CSV/PDF export, and manage users,
>   bookings (including goodwill refunds), payments, coupons and offers, reviews, support tickets, audit logs and
>   settings.
> - **Hotel managers** (`/hotel-manager`) check guests in and out, and see occupancy, ADR, RevPAR, revenue and ratings.
> - **Support agents** (`/support`) work a ticket queue with ticket metrics.
> - **Every role signs in at its own page:** `/customer/login`, `/admin/login`, `/hotel-manager/login`,
>   `/support/login`.
> - **An AI assistant (chat and voice)** answers from the user's own data through read-only tools, with a local model
>   on Ollama ([AI_ASSISTANT.md](AI_ASSISTANT.md)).
> - **Global search** in every header (signed out too): hotels, destinations, bookings, payments, refunds, tickets,
>   reviews, users and pages, typo-tolerant and highlighted, with a results page per portal. Elasticsearch, kept in
>   sync from Kafka; every role only finds what it may see
>   ([docs/GLOBAL_SEARCH_IMPLEMENTATION.md](docs/GLOBAL_SEARCH_IMPLEMENTATION.md)).
>
> The home page shows offers, popular destinations and routes, recommended hotels and guest reviews.
>
> Tested: 604 backend and 1,455 frontend tests, and Playwright browser journeys: a flight and a hotel booking (book →
> pay → download → cancel → refund), the dashboards against their APIs, and the assistant. Also accessibility,
> security and load checks ([TESTING_GUIDE.md](TESTING_GUIDE.md)). Next: manual testing on the local Docker stack.
> AWS deployment (Phase 12) is on hold. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

**Try a booking locally:** start the Docker stack (below), open http://localhost:3000, register (the verification
e-mail is in Mailpit, http://localhost:8025), then either search **hotels** in Goa (*guest details → review → payment*) or
**flights** (for example Delhi to Mumbai: pick a flight, *passenger details → review → payment*). Flights are labelled
**Demo inventory** (a simulated airline, no real tickets). On the payment page the labelled **Demo payment** panel has
**Pay** and **Fail** buttons (no money, no account). Confirmation (hotel confirmation number or airline PNR and tickets), invoice
and notifications follow automatically. To see the airline failure paths, give a passenger the last name `Reject` (order
refused, full refund) or `Timeout` (the answer is lost; the order is found again within a minute or two).
Razorpay test mode: [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md) §9.

## Architecture in one minute

- **React + TypeScript** single-page app → **API gateway** → **7 Spring Boot microservices**
  (identity, hotel, flight, booking, payment, notification, reporting).
- Each service owns its **own MySQL database**.
- Services communicate through **Kafka events** (saga choreography). Events are published with the
  **transactional outbox + Debezium** and use shared **Avro** schemas.
- **Elasticsearch** powers hotel search and the **global search** (`search-service`, a read model fed by the Kafka
  events; CQRS read side). **Redis** handles caching, short-lived search results and rate limiting.
- Beside the seven business services: the AI assistant's two services and `search-service` (no database).
- **Auto refresh**: services push "something changed" signals over **Server-Sent Events**, and the React app re-fetches
  exactly the affected data.
- Flights come from a clearly labelled **DEMO provider** for now. Hotels use **our own inventory**. Payments use **Razorpay**
  (test mode) or a **DEMO** payment provider.

## Quick start (Docker)

```powershell
Copy-Item .env.example .env       # then set the passwords in .env
docker compose up -d --build
docker compose ps                 # wait for "(healthy)"
```

Open http://localhost:3000. Swagger UI for all services: http://localhost:8080/swagger-ui.html.
Details: [DOCKER_SETUP.md](DOCKER_SETUP.md). To run services from PowerShell instead: [LOCAL_SETUP_GUIDE.md](LOCAL_SETUP_GUIDE.md).

## Kubernetes (kind, highly available) with GitOps

```powershell
docker compose build; docker compose --profile tools stop   # the images, and free memory for the cluster
.\deploy\scripts\kind-up.ps1             # 3 control planes + 3 workers, local registry on localhost:5001
.\deploy\scripts\push-images.ps1
.\deploy\scripts\install-platform.ps1    # Gateway API + Traefik, metrics-server, Argo Rollouts, Argo CD
.\deploy\scripts\create-secrets.ps1      # Kubernetes Secret from .env (never in Git)
.\deploy\scripts\deploy-apps.ps1         # data services, then the 12 services
```

Open http://localhost. The step-by-step guide covers blue-green releases of the web app at http://preview.localhost,
canary releases with traffic weights, Argo CD (http://argocd.localhost), the GitHub Actions pipeline and the path to
AWS EKS: [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md).

## Repository layout

```
pom.xml, mvnw.cmd          Maven build of all Java modules
platform/event-schemas     Avro event contracts (one source of truth for Kafka events)
platform/common-lib        Shared technical code: errors, security, outbox/inbox, Kafka, realtime, settings
services/*                 api-gateway + 7 business services
frontend/                  React app (Vite, Tailwind, TanStack Query)
infra/                     MySQL init, Kafka topics, Debezium connectors
docker/                    Backend Dockerfile
deploy/                    Kubernetes: kind cluster, Helm charts, per-environment values, Argo CD apps, scripts
.github/                   GitHub Actions CI/CD and Dependabot
scripts/                   PowerShell helpers for Windows; scripts/ci/ for the pipeline's manifest checks
```

## Documentation

| Document | What it covers |
|----------|---------------|
| [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) | Services, communication, tech stack, page list, assumptions |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Tables and relationships per service |
| [BOOKING_WORKFLOW.md](BOOKING_WORKFLOW.md) | Booking states and the hotel, flight and cancellation sagas |
| [docs/DESIGN_PATTERNS_TA.md](docs/DESIGN_PATTERNS_TA.md) | Design patterns used in the application, with file references (Tamil) |
| [REALTIME_UPDATES.md](REALTIME_UPDATES.md) | Auto refresh: Server-Sent Events + client-side pub/sub |
| [SUPPLIER_INTEGRATION.md](SUPPLIER_INTEGRATION.md) | Supplier evaluation, provider interfaces, DEMO provider |
| [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md) | Razorpay flow, webhooks, refunds, reconciliation |
| [DOCKER_SETUP.md](DOCKER_SETUP.md) | Running everything with Docker Compose |
| [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md) | HA kind cluster, Helm charts, blue-green and canary releases (Argo Rollouts), GitOps (Argo CD), operations, path to EKS |
| [docs/CI_CD.md](docs/CI_CD.md) | GitHub Actions: CI checks, image build/scan/sign, GitOps hand-off, repository settings |
| [LOCAL_SETUP_GUIDE.md](LOCAL_SETUP_GUIDE.md) | Windows setup, running services and tests locally |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phases, exit checks, current status |
| [platform/event-schemas/README.md](platform/event-schemas/README.md) | Rules for Avro event schemas |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | REST API: conventions, errors, auth, account, hotels, bookings, payments, notifications |
| [SECURITY_GUIDE.md](SECURITY_GUIDE.md) | Tokens, sessions, revocation, roles, sensitive data, payments, checklist for new endpoints |
| [TESTING_GUIDE.md](TESTING_GUIDE.md) | Running every test: backend, frontend, browser journeys, accessibility, security, load |
| [AI_ASSISTANT.md](AI_ASSISTANT.md) | The AI assistant: architecture, model choice, tools per role, security, voice, memory, tests |
| [frontend/DESIGN_SYSTEM.md](frontend/DESIGN_SYSTEM.md) | The web app's design system: principles, tokens, components |
