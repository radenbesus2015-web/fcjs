FROM node:18-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install

COPY . .
RUN pnpm build

FROM node:18-alpine AS runner
WORKDIR /app

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod

EXPOSE 3008
CMD ["pnpm", "start"]
