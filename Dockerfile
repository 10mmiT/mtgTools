FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error
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
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]
