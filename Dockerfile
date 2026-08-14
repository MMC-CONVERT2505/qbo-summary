# syntax=docker/dockerfile:1

# ============================================================
# Stage 1 — build the client
#
# The build runs in Linux inside Docker, which also sidesteps the Windows
# Smart App Control problem that blocks Vite's native binaries locally.
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first, so the (slow) dependency install layer is cached and only
# re-runs when a package.json or the lockfile actually changes — editing
# source code then rebuilds in seconds rather than minutes.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci

COPY client ./client
RUN npm run build --workspace client


# ============================================================
# Stage 2 — runtime
#
# Starts from a clean image: no Vite, no build tools, no dev dependencies —
# only the server's production deps and the compiled client.
# ============================================================
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Written to a mounted volume, not the image, so tokens and cached summaries
# survive `docker compose down` and image rebuilds.
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY server/src ./server/src
COPY --from=builder /app/client/dist ./client/dist

# Run as a non-root user: if the app is ever compromised, the attacker lands
# as `node`, not root. The data dir is chowned so the app can still write it.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 4000

# No shell wrapper: node runs as PID 1 and receives SIGTERM directly, so
# `docker compose down` stops it cleanly instead of waiting out a 10s timeout.
CMD ["node", "server/src/index.js"]
