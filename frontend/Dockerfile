# Build the static Vue app, then serve it with Caddy (no Node.js at runtime).
# Build context is the repository root (see docker-compose.yml) because the frontend
# type-checks against shared/answer-cases.json.
FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY shared/ /app/shared/
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/frontend/dist /srv
