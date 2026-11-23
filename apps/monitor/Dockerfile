FROM node:22-alpine
WORKDIR /repo
# the monitor reads the generated ABIs straight from the SDK source
COPY packages/sdk/src packages/sdk/src
COPY apps/monitor apps/monitor
RUN cd apps/monitor && npm ci
WORKDIR /repo/apps/monitor
CMD ["npx", "tsx", "src/index.ts"]
