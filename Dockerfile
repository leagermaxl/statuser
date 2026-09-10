# syntax=docker/dockerfile:1

# ---- build: полный yarn install (с devDependencies) + компиляция TS ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# ---- runtime: свежий прод-only install (без devDependencies) + dist ----
# Ставим зависимости заново в этой стадии, а не копируем node_modules из
# build — там стоят и devDependencies, а --production=true здесь работает
# как явный флаг (не зависит от того, что NODE_ENV=production внутри этой
# же стадии иначе вырезал бы их сам по себе — та же ловушка, что уже
# словили на Render). Один install дважды дороже по времени сборки, зато
# укладываемся в лимит в 2 стадии для бесплатного контейнера (512MB).
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production

CMD ["node", "dist/main"]
