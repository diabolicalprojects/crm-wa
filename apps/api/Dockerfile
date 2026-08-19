FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db packages/db
RUN npm ci
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
COPY apps/api apps/api
COPY tsconfig.json turbo.json ./
RUN npm run build --workspace=@horizonte/api
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
