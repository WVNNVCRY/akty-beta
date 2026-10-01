# Образ сервера: фронтенд (серверный режим) + NestJS API на одном порту 3000
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig*.json vite.config.ts .env.api ./
COPY src ./src
RUN npm run build:api

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npx prisma generate && npx tsc -p .
COPY --from=web /app/dist-api /app/dist-api
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/dist-api STORAGE=local STORAGE_DIR=/data/storage
VOLUME /data/storage
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# миграции применяются при каждом старте (безопасно: только новые)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
