# syntax=docker/dockerfile:1

# 1. build the React client
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY client client
RUN npm run build -w client

# 2. runtime: server production dependencies + built client
FROM node:24-alpine
ENV NODE_ENV=production PORT=5050
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci -w server --omit=dev --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:5050/api/health || exit 1
CMD ["node", "server/src/index.js"]
