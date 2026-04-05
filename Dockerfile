FROM node:24-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY . .

RUN mkdir -p users

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
