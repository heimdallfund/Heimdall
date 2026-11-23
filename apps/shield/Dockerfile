FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm i tsx@4
COPY src ./src
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["npx", "tsx", "src/server.ts"]
