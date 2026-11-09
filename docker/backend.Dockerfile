# syntax=docker/dockerfile:1.7
# One Dockerfile for all backend services.
#   docker build -f docker/backend.Dockerfile --build-arg SERVICE=booking-service -t flighthotel/booking-service .
# The "build" stage is identical for every service, so Docker builds it once and reuses it.

# ---------- Build all modules ----------
FROM eclipse-temurin:21.0.13_9-jdk-noble AS build
WORKDIR /workspace

COPY mvnw pom.xml ./
COPY .mvn .mvn
COPY platform platform
COPY services services
RUN chmod +x mvnw

# The Maven repository is cached between builds (BuildKit cache mount).
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -q -DskipTests package

# Split every service jar into layers (dependencies change rarely, application code often).
RUN for dir in services/*/; do \
      name=$(basename "$dir"); \
      java -Djarmode=tools -jar "$dir/target/$name-0.1.0-SNAPSHOT.jar" extract --layers --launcher \
           --destination "extracted/$name"; \
    done

# ---------- Runtime image for one service ----------
FROM eclipse-temurin:21.0.13_9-jre-noble AS runtime
ARG SERVICE

# Security updates of the base image's OS packages (the dependency scan in TESTING_GUIDE.md checks the result).
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN groupadd --system spring && useradd --system --gid spring --no-create-home spring
WORKDIR /app
# Local file storage (profile photos, documents). Owned by the app user so a named volume mounted here is writable.
RUN mkdir -p /app/storage && chown spring:spring /app/storage

COPY --from=build /workspace/extracted/${SERVICE}/dependencies/ ./
COPY --from=build /workspace/extracted/${SERVICE}/spring-boot-loader/ ./
COPY --from=build /workspace/extracted/${SERVICE}/snapshot-dependencies/ ./
COPY --from=build /workspace/extracted/${SERVICE}/application/ ./

USER spring
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom"
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
