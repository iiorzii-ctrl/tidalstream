# 依存パッケージが無いので、ソースを置いて起動するだけでよい。
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# 外部から接続できるようにする（認証は AUTH_USER / AUTH_PASS で設定する）
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.mjs"]
