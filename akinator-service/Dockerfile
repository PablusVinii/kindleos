# Akinator relay container.
#
# Northflank builds this from the repository root, so the copy paths include the
# `akinator-service/` prefix. It also works locally:
#   docker build -f akinator-service/Dockerfile -t rekindle-akinator .
#   docker run --rm -p 8080:8080 rekindle-akinator

FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies from the lockfile first so source edits do not
# invalidate the dependency layer.
COPY akinator-service/package.json akinator-service/package-lock.json ./
RUN npm ci --omit=dev

COPY akinator-service/ ./

ENV PORT=8080
EXPOSE 8080

# node:22-slim ships an unprivileged `node` user.
USER node

CMD ["node", "server.js"]
