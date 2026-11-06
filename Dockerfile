FROM node:20-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server ./
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "node src/seed.js && node src/index.js"]
