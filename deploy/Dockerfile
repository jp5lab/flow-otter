# Multi-stage build for the FlowOtter server.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json tsconfig.build.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY src ./src
COPY bin ./bin
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
ENTRYPOINT ["node", "dist/bin/flow-otter.js"]
