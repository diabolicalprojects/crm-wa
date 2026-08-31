# Horizonte CRM

CRM conversacional multiagencia con agentes de IA sobre WhatsApp, definido en
[`especificacion-crm-ia-openwa-inmobiliaria.md`](especificacion-crm-ia-openwa-inmobiliaria.md).
Caso inicial: agencia inmobiliaria.

## ⚠️ Advertencia sobre WhatsApp

La pasarela [OpenWA](https://github.com/rmyndharis/OpenWA) se conecta mediante
clientes **no oficiales** (`whatsapp-web.js` o `baileys`), no con la API oficial
de Meta. Existe un **riesgo real y no eliminable** de que WhatsApp restrinja o
bloquee el número conectado.

Para reducirlo:

- Usa números dedicados, nunca el número comercial principal de la agencia.
- Atiende solo conversaciones iniciadas por el prospecto o con su consentimiento.
- No hagas campañas ni envíos masivos.
- Aplica límites de envío por sesión.
- Considera que cada sesión con Chromium consume varios cientos de MB de RAM.

El CRM registra el evento `session.restriction` en la auditoría cuando WhatsApp
aplica o levanta una restricción. El adaptador está aislado tras la interfaz
`WhatsAppGateway` para poder migrar a la API oficial sin reescribir el dominio.

## Arquitectura

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js + TypeScript |
| Backend | NestJS + TypeScript |
| Base de datos | PostgreSQL + Prisma |
| Cola y locks | Redis + BullMQ |
| WhatsApp | OpenWA — contrato fijado en [`docs/openwa-contract.md`](docs/openwa-contract.md) |
| IA | Adaptadores multi-proveedor: Anthropic, OpenAI y Gemini |

## Arranque local

```bash
npm install
cp .env.example .env   # y completa los valores
npm run db:generate
npm run db:migrate
npm run dev
```

La API valida su configuración al arrancar: si falta una variable necesaria
falla de inmediato con el detalle, en vez de arrancar a medias.

## Migraciones

El esquema se versiona con `prisma migrate`. **No uses `db push` contra una base
con datos**: no deja historial y un cambio destructivo deja el servicio sin
arrancar.

```bash
npm run db:migrate          # aplica migraciones en desarrollo
npm run db:migrate:deploy   # aplica migraciones en producción
```

Si ya tenías una base creada con `db push` antes de que existieran las
migraciones, márcala como base antes de desplegar:

```bash
npx prisma migrate resolve --applied 20260818000000_init --schema packages/db/prisma/schema.prisma
```

## Pruebas

```bash
npm test
npm run test:coverage
```

## Configuración de la IA

Las credenciales de los proveedores **no** viven en variables de entorno: el
superadministrador las captura desde la consola (`/admin/ai/providers`) y quedan
cifradas con AES-GCM en la base de datos. La agencia consume configuraciones
autorizadas y nunca ve ni administra claves.

Proveedores disponibles y sus modelos en
[`apps/api/src/ai-catalog.ts`](apps/api/src/ai-catalog.ts). El campo de modelo
acepta cualquier identificador, así que un modelo nuevo no requiere cambiar el
código.

## Documentación

- [Especificación funcional y técnica](especificacion-crm-ia-openwa-inmobiliaria.md)
- [Contrato de OpenWA](docs/openwa-contract.md)
