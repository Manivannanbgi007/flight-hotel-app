# Local Setup Guide (Windows)

Two ways to work:

| Option | When to use |
|--------|-------------|
| **A. Everything in Docker** | You want to use or test the app. See [DOCKER_SETUP.md](DOCKER_SETUP.md). |
| **B. Infrastructure in Docker, your service(s) on Windows** | You are developing a service and want fast restarts and debugging in your IDE. Described below. |

## 1. Install

| Tool | Version | Check |
|------|---------|-------|
| JDK | 21 | `java -version` |
| Node.js | 24 | `node -v` |
| Docker Desktop | recent, with at least 16 GB of memory (20 GB recommended; see [DOCKER_SETUP.md](DOCKER_SETUP.md)) | `docker version` |
| Git | any | `git --version` |
| Maven | optional, the repo has the Maven Wrapper (`mvnw.cmd`) | `.\mvnw.cmd -v` |

Recommended IDEs: IntelliJ IDEA (backend), VS Code (frontend).

## 2. One-time setup

```powershell
cd "D:\Drive E\dev\flight-hotel-app"
Copy-Item .env.example .env          # set real local passwords in .env (letters and digits only)
python -c "import secrets;print(secrets.token_urlsafe(48))"   # put the output in .env as MCP_SERVER_API_KEY=... (Phase 11)
.\mvnw.cmd -B install -DskipTests    # builds all Java modules once (first time: a few minutes)
cd frontend; npm ci; cd ..
```

## 3. Start the infrastructure

```powershell
.\scripts\start-infra.ps1
docker compose ps        # wait for mysql, kafka, schema-registry, kafka-connect, elasticsearch, redis to be healthy
```

To work on the AI assistant (Phase 11), add `-Assistant`: it also starts the model server and pulls the model (about
4.2 GB the first time). The speech server is optional:

```powershell
.\scripts\start-infra.ps1 -Assistant                         # + Ollama on http://127.0.0.1:11434 and the model
docker compose --profile voice up -d speaches speaches-init  # optional speech server (voice)
```

## 4. Run a service on Windows

```powershell
.\scripts\run-service.ps1 reporting-service
```

The script:
1. installs the shared modules (`event-schemas`, `common-lib`) the first time (`-Rebuild` forces it),
2. stops the Docker container of the same service if it is running (the port must be free),
3. runs `mvnw spring-boot:run` in `services/reporting-service`.

The service reads its secrets from the project's `.env`, connects to MySQL on `localhost:3307`, Kafka on
`localhost:9092`, Schema Registry on `localhost:8081` and Redis on `localhost:6379`.

**Expected result:** `Started ReportingServiceApplication in ... seconds` and `http://localhost:8107/actuator/health`
returns `{"status":"UP"}`.

### From IntelliJ IDEA

Open the root `pom.xml` as a project and run the `*Application` class of the service. Set the **working directory**
to the service folder (for example `$PROJECT_DIR$/services/hotel-service`) so it finds `../../.env`.

### Service ports

| Service | Port | | Service | Port |
|---------|------|-|---------|------|
| api-gateway | 8080 | | booking-service | 8104 |
| identity-service | 8101 | | payment-service | 8105 |
| hotel-service | 8102 | | notification-service | 8106 |
| flight-service | 8103 | | reporting-service | 8107 |
| mcp-client-service | 8108 | | mcp-server-service | 8109 |
| search-service | 8110 | | | |

Each service has Swagger UI at `http://localhost:<port>/swagger-ui.html` (except mcp-server-service, which only has
its MCP endpoint). The gateway shows all of them together at `http://localhost:8080/swagger-ui.html`.

The two assistant services (Phase 11) run the same way (`.\scripts\run-service.ps1 mcp-server-service`, then
`mcp-client-service`) or from the IDE. They need `MCP_SERVER_API_KEY` in `.env`; mcp-client-service finds Ollama on
`localhost:11434` and mcp-server-service on `localhost:8109`, and mcp-server-service calls the gateway on
`localhost:8080`. Details: [AI_ASSISTANT.md](AI_ASSISTANT.md) §3.

## 5. Run the frontend with hot reload

```powershell
.\scripts\run-frontend.ps1           # http://localhost:5173
```

Vite forwards `/api/*` to the gateway on `http://localhost:8080`, so the gateway must be running (in Docker or locally).

Links in emails (verify, reset password) point to `APP_PUBLIC_URL` (default `http://localhost:3000`, the Docker
frontend). To open them in the Vite dev server instead, set `APP_PUBLIC_URL=http://localhost:5173` in `.env` and
restart notification-service.

## 6. Run the tests

```powershell
.\mvnw.cmd -B verify                 # all backend tests + coverage report (Docker must be running: Testcontainers)
cd frontend
npm test                             # frontend unit tests (Vitest)
npm run lint
npm run typecheck
npm run test:e2e                     # browser journeys + accessibility (needs the Docker stack running)
```

Every kind of test (end-to-end, accessibility, security, load), what it proves and how to read the results:
[TESTING_GUIDE.md](TESTING_GUIDE.md).

## 7. Configuration rules

- **Secrets** live only in `.env` (git-ignored) or environment variables. Never in `application.yml`.
- **Shared defaults** for all services (Kafka, Redis, JPA, actuator, logging) are in
  `platform/common-lib/src/main/resources/travel-defaults.yml`, loaded with the *lowest* priority. A service's own
  `application.yml` and environment variables override them.
- Profiles: no profile = local Windows run; `docker` = inside Docker Compose (JSON logs); `prod` = AWS (JSON logs,
  Swagger off, schemas registered by CI).

## 8. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Access denied for user 'xxx_user'` | The password in `.env` differs from the one MySQL was created with. See DOCKER_SETUP.md › Troubleshooting. |
| `Port 8107 was already in use` | The Docker container of that service is still running: `docker compose stop reporting-service`. |
| `Could not find artifact com.flighthotel:common-lib` | Run `.\scripts\run-service.ps1 <service> -Rebuild` or `.\mvnw.cmd install -DskipTests`. |
| Integration tests fail with `Could not find a valid Docker environment` | Start Docker Desktop. |
| PowerShell blocks the scripts | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (once). |
| Tests fail with `No qualifying bean of type ...Mapper` right after `mvnw clean` | An IDE (VS Code Java / Eclipse) rebuilt `target/classes` at the same time without MapStruct annotation processing. Run the build again, or run Maven while the IDE is closed / with automatic build off. |
