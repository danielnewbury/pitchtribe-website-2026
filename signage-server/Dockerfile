FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY src ./src
COPY data ./data
COPY config.example.json ./
USER node
EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["node", "src/index.js"]
