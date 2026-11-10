# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-alpine

# ---------- deps: всички зависимости (вкл. dev) за build ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- dev: за docker-compose.override.yml (hot reload) ----------
FROM deps AS dev
ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    SCRIPTS_DIR=/opt/barber-scripts \
    MIGRATIONS_DIR=/app/drizzle
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./
# Скриптовете се компилират извън /app, защото /app се bind-mount-ва от хоста.
RUN npm run build:scripts && mkdir -p /opt/barber-scripts \
    && mv dist-scripts/*.mjs /opt/barber-scripts/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# ---------- builder: Next.js standalone + migrate.mjs/bootstrap-admin.mjs ----------
FROM deps AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ---------- runner: минимален production образ ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    SCRIPTS_DIR=/app \
    MIGRATIONS_DIR=/app/drizzle \
    UPLOADS_DIR=/app/uploads

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts/migrate.mjs /app/dist-scripts/bootstrap-admin.mjs ./
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs docker/forwarded-headers.mjs ./forwarded-headers.mjs
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Директорията съществува в образа с правилния собственик, за да може именуваният
# volume да наследи правата при първото монтиране.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
