# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx vite build

# Production stage
# Node >= 22.23.4 drops the compromised eMudhra roots from its built-in store
# (2026-10 incident); the system store is trimmed too, for anything that uses it.
FROM node:22-alpine
RUN apk add --no-cache ca-certificates && \
    sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' \
           -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf && \
    update-ca-certificates
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server.js .
COPY studio-lists ./studio-lists

EXPOSE 3000
CMD ["node", "server.js"]
