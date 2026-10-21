# Build stage: the toolchain is here only to compile better-sqlite3 if no
# prebuilt binary fits; none of it reaches the image that runs.
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
# Every module at the root, rather than a list of them. The root holds nothing
# but the app's own modules — the tests, the scripts and the docs are in
# directories of their own and none of them is copied — and a list is a list
# somebody has to remember to add to. deck-history.js was added to the app and
# not to this file, which built an image whose server.js required a module that
# was not in it.
COPY *.js ./
COPY middleware/ middleware/
COPY routes/ routes/
COPY public/ public/
# The app runs as the unprivileged `node` user (uid 1000 in this image). A data
# volume created by the old image, which ran as root, is owned by root and the
# app cannot write to it: chown it once on the host, e.g.
#   chown -R 1000:1000 /path/to/the/volume
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]
