# Horizonte CRM

Monorepo inicial para el CRM multiagente inmobiliario definido en `especificacion-crm-ia-openwa-inmobiliaria.md`.

## Estado

Fase 1 iniciada: estructura Next.js/NestJS, esquema Prisma multi-tenant, health check y endpoint base de agentes. OpenWA, autenticación, Redis/BullMQ y los workers se implementarán sobre estas interfaces.

## Arranque local

1. Copiar `.env.example` a `.env` y levantar PostgreSQL.
2. Ejecutar `npm install`.
3. Ejecutar `npm run db:generate` y `npm run db:push`.
4. Ejecutar `npm run dev`.

La integración OpenWA debe validarse contra el Swagger de la versión fijada antes de implementar el adaptador de producción.
