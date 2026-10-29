# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --strict-ssl=true
COPY . .
RUN npm run check && BUILDING=1 npm run build && npm prune --omit=dev && mkdir /runtime-data && chown 1000:1000 /runtime-data && chmod 700 /runtime-data

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data BODY_SIZE_LIMIT=65536 SHUTDOWN_TIMEOUT=45
WORKDIR /app
COPY --from=build --chown=1000:1000 /runtime-data /data
COPY --from=build --chown=1000:1000 /app/build ./build
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
COPY --chown=1000:1000 migrations ./migrations
COPY --chown=1000:1000 scripts ./scripts
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["build"]
