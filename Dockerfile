# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx vite build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server.js .
COPY studio-lists ./studio-lists

EXPOSE 3000
CMD ["node", "server.js"]
