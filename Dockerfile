FROM node:22-slim AS build

RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y python3 make g++ git \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY src/web/static ./dist/web/static

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["node", "dist/index.js"]
