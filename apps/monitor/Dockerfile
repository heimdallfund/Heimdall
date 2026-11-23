FROM node:22-alpine
WORKDIR /repo
COPY packages/sdk packages/sdk
COPY apps/monitor apps/monitor
RUN cd packages/sdk && npm ci && npm run build && cd ../../apps/monitor && npm ci
WORKDIR /repo/apps/monitor
CMD ["npx", "tsx", "src/index.ts"]
