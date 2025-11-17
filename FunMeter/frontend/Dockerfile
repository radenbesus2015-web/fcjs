# ---- Builder ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app ./

EXPOSE 3008
CMD ["npm", "start"]
