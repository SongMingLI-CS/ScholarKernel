FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG DEBIAN_MIRROR="http://deb.debian.org"
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
ARG NPM_REGISTRY="https://registry.npmjs.org"
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --registry=$NPM_REGISTRY
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV ENCRYPTION_SECRET="build-only-placeholder-not-used-at-runtime"
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build -- --webpack

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG DEBIAN_MIRROR="http://deb.debian.org"
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/next.config.ts ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./
COPY --from=builder --chown=node:node /app/generated ./generated
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm start -- --hostname 0.0.0.0"]
