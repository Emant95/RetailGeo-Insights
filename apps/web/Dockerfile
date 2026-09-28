# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /repo
ARG VITE_API_URL=/api/v1
ARG VITE_MAP_PROVIDER=leaflet
ENV VITE_API_URL=$VITE_API_URL VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @retailgeo/web

FROM nginx:1.27-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
