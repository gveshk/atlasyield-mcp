# Builds the stdio MCP server from source. Runtime needs only outbound HTTPS to
# api.atlasyield.club and raw.githubusercontent.com.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
# vitest is test-only and its peer set trips npm's resolver without a lockfile.
RUN npm pkg delete devDependencies.vitest \
 && npm install --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
