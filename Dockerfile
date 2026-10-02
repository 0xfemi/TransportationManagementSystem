FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app ./
RUN chmod +x docker/entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["docker/entrypoint.sh"]
