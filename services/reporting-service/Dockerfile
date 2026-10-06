# syntax=docker/dockerfile:1
# Build context: monorepo root
#
# reportStorage.js uses path.join(__dirname, '../data/reports')
# with code under /app/services → data lives at /app/data (named volume).

FROM node:20-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY services/reporting-service/package.json services/reporting-service/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0

# Split into separate layers (was one chained RUN): isolates which step
# fails in build logs and lets Docker cache the earlier steps independently
# of apk's network-dependent fetch from Alpine's CDN.
RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache su-exec
RUN mkdir -p /app/data/reports
RUN chown -R app:app /app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app services/reporting-service/package.json ./services/reporting-service/
COPY --chown=app:app services/reporting-service/package-lock.json ./services/reporting-service/
COPY --chown=app:app services/reporting-service/index.js ./services/reporting-service/
COPY --chown=app:app services/reporting-service/config ./services/reporting-service/config
COPY --chown=app:app services/reporting-service/jobs ./services/reporting-service/jobs
COPY --chown=app:app services/reporting-service/routes ./services/reporting-service/routes
COPY --chown=app:app services/reporting-service/services ./services/reporting-service/services
COPY --chown=app:app services/reporting-service/utils ./services/reporting-service/utils
COPY --chown=app:app services/reporting-service/lib ./services/reporting-service/lib
COPY --chown=app:app shared/security ./shared/security
COPY --chown=app:app shared/attendance ./shared/attendance
COPY --chown=app:app shared/permissions ./shared/permissions
COPY --chown=root:root services/reporting-service/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

# Remain root for ENTRYPOINT (volume chown); entrypoint drops to app.
WORKDIR /app/services/reporting-service
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "index.js"]
