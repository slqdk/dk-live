FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY data ./data
# keys + geocode cache live here; mount it
VOLUME ["/app/server/cache"]
EXPOSE 4200
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:4200/api/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
