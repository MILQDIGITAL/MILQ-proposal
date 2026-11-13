# Build from the WORKSPACE ROOT (core is a sibling package):
#   docker build -f server/Dockerfile -t parking-lingo-server .
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production

# Manifests first for layer caching. All workspace manifests are copied so `npm ci`
# accepts the shared lockfile; only the server's (and core's) deps are installed.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force

COPY packages/core/src packages/core/src
COPY server/src server/src
COPY server/tsconfig.json server/

USER node
WORKDIR /srv/server
# Behind one proxy appending X-Forwarded-For; on Fly override with TRUST_PROXY=fly.
ENV PORT=8080 HOST=0.0.0.0 TRUST_PROXY=xff TRUSTED_PROXY_HOPS=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
