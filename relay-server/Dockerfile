# syntax=docker/dockerfile:1

# Why: multi-stage so the runtime image carries only prod deps + compiled JS,
# not the TypeScript toolchain. Mirrors the "stateless-first, TLS-terminated in
# front" deployment described in docs/mobile-relay-bridge.md.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist

# Why: room/token state is the only persisted data — mount it as a volume so a
# container restart keeps existing pairings (hardened 0600 file inside).
VOLUME ["/data"]
ENV RELAY_STORE_PATH=/data/rooms.json
ENV RELAY_HOST=0.0.0.0
ENV RELAY_PORT=6770
EXPOSE 6770

# Why: liveness probe via the relay's own /healthz endpoint (busybox wget ships
# in the alpine base). Applies to the long-running `serve` container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:6770/healthz || exit 1

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
