# ---------- Stage 1 : build ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

# ---------- Stage 2 : runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    LOG_DIR=/app/logs

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r geco && useradd -r -g geco -u 10001 -m -d /home/geco geco

WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY package.json ./

RUN mkdir -p /app/data /app/logs /data/geco \
  && chown -R geco:geco /app /data/geco

USER geco
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
