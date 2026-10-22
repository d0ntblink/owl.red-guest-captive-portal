FROM node:24-alpine@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420 AS build
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build && npm test && npm prune --omit=dev

FROM node:24-alpine@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 ASTRO_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4321/health',{signal:AbortSignal.timeout(2000)}).then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]