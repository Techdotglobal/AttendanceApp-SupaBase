# syntax=docker/dockerfile:1
# Build context: monorepo root (docker-compose.yml)
# Production listens on port 80 for Coolify Traefik (public HTTPS on 443).

FROM node:20-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY services/api-gateway/package.json services/api-gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=80 \
    HOST=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app services/api-gateway/package.json ./services/api-gateway/
COPY --chown=app:app services/api-gateway/package-lock.json ./services/api-gateway/
COPY --chown=app:app services/api-gateway/index.js ./services/api-gateway/
COPY --chown=app:app services/api-gateway/routes ./services/api-gateway/routes
COPY --chown=app:app services/api-gateway/lib ./services/api-gateway/lib
COPY --chown=app:app shared/security ./shared/security
COPY --chown=app:app shared/attendance ./shared/attendance
COPY --chown=app:app shared/permissions ./shared/permissions

WORKDIR /app/services/api-gateway
USER app
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
