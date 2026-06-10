# ── Étape 1 : build du front (mode réel : VITE_MOCK absent) ──────────
FROM node:24-alpine AS build
WORKDIR /app

# GitHub Packages (scope @mister-guiiug) : token read:packages requis.
ARG NODE_AUTH_TOKEN
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ── Étape 2 : runtime Node (API + front statique, même origine) ──────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

ARG NODE_AUTH_TOKEN
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && rm -f .npmrc

# Le serveur tourne en TypeScript natif (type stripping Node ≥ 22.18).
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

ENV SUPABOSS_HOST=0.0.0.0 \
    SUPABOSS_PORT=8787 \
    SUPABOSS_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:8787/api/system/health >/dev/null || exit 1

USER node
CMD ["node", "server/src/index.ts"]
