# network-tutor-server — Express/tsx, no compile step (systemd runs it the same way: tsx src/server.ts)
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
# tsx/typescript are devDependencies but are needed at runtime here — this service has no
# compile step, systemd runs it the exact same way (tsx src/server.ts) — so a full `npm ci`.
RUN npm ci

COPY . .
# certs/rds-global-bundle.pem is already inside the project root and comes along with `COPY . .`

EXPOSE 3300
CMD ["node_modules/.bin/tsx", "src/server.ts"]
