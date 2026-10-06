# syntax=docker/dockerfile:1
# Build context: monorepo root — preserves ../../../shared from services/auth-service/lib

FROM node:20-alpine AS deps
WORKDIR /app/services/auth-service
ENV NODE_ENV=production
COPY services/auth-service/package.json services/auth-service/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/services/auth-service/node_modules ./services/auth-service/node_modules
# Full service tree (node_modules / secrets excluded by root .dockerignore)
COPY --chown=app:app services/auth-service/package.json ./services/auth-service/
COPY --chown=app:app services/auth-service/package-lock.json ./services/auth-service/
COPY --chown=app:app services/auth-service/index.js ./services/auth-service/
COPY --chown=app:app services/auth-service/config ./services/auth-service/config
COPY --chown=app:app services/auth-service/lib ./services/auth-service/lib
COPY --chown=app:app services/auth-service/routes ./services/auth-service/routes
# Shared runtime modules are resolved from /app/shared by the service code.
COPY --chown=app:app shared/permissions ./shared/permissions
COPY --chown=app:app shared/security ./shared/security
COPY --chown=app:app shared/attendance ./shared/attendance

WORKDIR /app/services/auth-service
USER app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
