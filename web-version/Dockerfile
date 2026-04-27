# Server
FROM node:20-alpine AS server
WORKDIR /app
COPY server/package.json ./
RUN npm install --production
COPY server/ ./
RUN mkdir -p uploads

# Client build
FROM node:20-alpine AS client
WORKDIR /app
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Final image
FROM node:20-alpine
WORKDIR /app
COPY --from=server /app /app
COPY --from=client /app/dist /app/client/dist
RUN mkdir -p /app/data /app/uploads
EXPOSE 3000
CMD ["node", "index.js"]
