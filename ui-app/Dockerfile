# syntax=docker/dockerfile:1.7
# ---------- Build the React app ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Development only: VITE_DEV_ACCOUNTS=true puts the "Development Test Accounts" panel on the sign-in pages. Default false:
# a normal (production) image has no test email or password in its bundle. See docs/DEVELOPMENT_TEST_ACCOUNTS.md.
ARG VITE_DEV_ACCOUNTS=false
ENV VITE_DEV_ACCOUNTS=$VITE_DEV_ACCOUNTS
RUN npm run build

# ---------- Serve it with nginx, as a non-root user ----------
# nginx-unprivileged: the same nginx, running as uid 101 on port 8080 (no root, no privileged port), so Kubernetes can
# enforce runAsNonRoot and a read-only root file system (the config is written to /etc/nginx/conf.d, temp files to /tmp).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine
# Security updates of the base image's OS packages (the dependency scan in TESTING_GUIDE.md checks the result).
USER root
RUN apk upgrade --no-cache
USER 101
# The gateway address differs per environment (Docker Compose / Kubernetes service name, internal URL on AWS).
ENV API_GATEWAY_URL=http://api-gateway:8080
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
