# Node 24 because package.json sets `engines.node >= 24`, and because `node src/server.ts`
# relies on Node's unflagged TypeScript stripping (23.6+) — that is what lets this image
# run the sources directly with no build step, exactly as `npm start` does on a laptop.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
# package.json carries `"type": "module"`; without it Node reads src/*.ts as CommonJS.
COPY package.json ./
COPY src ./src

# Nothing here writes to disk or binds a privileged port.
USER node
EXPOSE 8083

# Not `npm start`: that adds --env-file-if-exists=.env, and Compose supplies the
# environment directly. No .env file is ever copied into the image.
CMD ["node", "src/server.ts"]
