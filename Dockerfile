# syntax=docker/dockerfile:1

# ---- build: полный yarn install (с devDependencies) + компиляция TS ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# ---- deps: отдельный чистый install только продакшен-зависимостей ----
# Отдельная стадия, а не "yarn install --production=true" в build-стадии —
# чтобы компиляция (nest build, нужен @nestjs/cli из devDependencies) не
# зависела от того, что здесь NODE_ENV=production уже вырезал бы devDeps
# (та же ловушка, что уже словили на Render).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true

# ---- runtime: только dist + прод-зависимости, без исходников/тулинга ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

CMD ["node", "dist/main"]
