# syntax=docker/dockerfile:1
# Contexto de build: raíz del monorepo (ver docker-compose.yml).

FROM node:20-slim AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter "@seo/web..."
# URL pública para canonical, Open Graph y sitemap de las páginas prerenderizadas.
ARG PUBLIC_SITE_URL=https://seoranker.tech
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN pnpm --filter "@seo/web..." build

FROM nginx:1.27-alpine AS runtime
# nginx sustituye ${API_UPSTREAM} al arrancar (plantillas en /etc/nginx/templates).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
