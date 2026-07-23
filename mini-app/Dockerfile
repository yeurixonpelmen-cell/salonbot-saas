FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
