# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/parsers/package.json packages/parsers/
COPY packages/renderers/package.json packages/renderers/
COPY packages/exporters/package.json packages/exporters/
COPY packages/cad-engine/package.json packages/cad-engine/
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV STORAGE_ROOT=/data
ENV PORT=3000
ENV SERVICE_NAME=infi90-migration-api
ENV MAX_UPLOAD_MB=100
ENV CORS_ORIGINS=https://infi90-migration-studio.vercel.app
ENV FRONTEND_ORIGIN=https://infi90-migration-studio.vercel.app
ENV NEXT_PUBLIC_API_BASE_URL=

RUN mkdir -p /data && chown -R node:node /data
COPY --from=builder /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "@infi90/web", "--", "-H", "0.0.0.0", "-p", "3000"]
