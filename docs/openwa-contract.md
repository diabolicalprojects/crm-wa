# Contrato de OpenWA (versión fijada)

> Extraído el 31 de agosto de 2026 de la instancia desplegada en
> `https://openwa.diabolicalservices.tech` y de
> [`rmyndharis/OpenWA`](https://github.com/rmyndharis/OpenWA) · `docs/06-api-specification.md`.
>
> La spec del CRM (§28.8) prohíbe asumir endpoints. Este archivo es la fuente de
> verdad del adaptador: **si cambia la versión de OpenWA, se vuelve a derivar
> este documento antes de tocar el código.**

## Base y autenticación

| Concepto | Valor |
| --- | --- |
| Base URL | `https://<host>/api` |
| Autenticación | Header `X-API-Key: <clave>` |
| Error sin clave | `401 {"message":"API key is required","error":"Unauthorized","statusCode":401}` |
| Salud (sin auth) | `GET /api/health` → `{"status":"ok","timestamp":"…"}` |
| Salud profunda | `GET /api/health/ready` |

El Swagger (`/api/docs`) **no está habilitado** en esta instancia; `/docs`,
`/swagger` y `/api-docs` devuelven el SPA del dashboard.

## Sesiones

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `GET` | `/sessions` | — |
| `POST` | `/sessions` | `{ "name": "<nombre>" }` |
| `GET` | `/sessions/:id` | — |
| `DELETE` | `/sessions/:id` | — |
| `GET` | `/sessions/:id/config` | — |
| `PATCH` | `/sessions/:id/config` | objeto de configuración |
| `POST` | `/sessions/:id/start` | — |
| `POST` | `/sessions/:id/stop` | — |
| `POST` | `/sessions/:id/logout` | — |
| `POST` | `/sessions/:id/force-kill` | — |
| `GET` | `/sessions/:id/qr` | — → `{ qrCode: "data:image/png;base64,…" }` |
| `POST` | `/sessions/:id/pairing-code` | `{ "phoneNumber": "…" }` |
| `GET` | `/sessions/stats/overview` | — |

### Estados de sesión del proveedor

`created` · `initializing` · `qr_ready` · `authenticating` · `ready` ·
`disconnected` · `action_required` · `failed`

Mapeo al enum `SessionStatus` del CRM:

| OpenWA | CRM |
| --- | --- |
| `created` | `CREATING` |
| `initializing`, `authenticating` | `STARTING` |
| `qr_ready`, `action_required` | `QR_REQUIRED` |
| `ready` | `CONNECTED` |
| `disconnected` | `DISCONNECTED` |
| `failed` | `FAILED` |

## Mensajes

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `POST` | `/sessions/:id/messages/send-text` | `{ "chatId": "…", "text": "…" }` |
| `POST` | `/sessions/:id/messages/send-{image\|video\|audio\|voice\|document\|sticker}` | `{ "chatId": "…", … }` |
| `POST` | `/sessions/:id/messages/send-location` | objeto |
| `POST` | `/sessions/:id/messages/send-contact` | objeto |
| `POST` | `/sessions/:id/messages/send-poll` | objeto |
| `POST` | `/sessions/:id/messages/send-bulk` | objeto |
| `POST` | `/sessions/:id/messages/reply` | objeto |
| `POST` | `/sessions/:id/messages/react` | objeto |
| `POST` | `/sessions/:id/messages/delete` | objeto |
| `POST` | `/sessions/:id/messages/forward` | objeto |
| `GET` | `/sessions/:id/messages?chatId=&limit=` | — |
| `GET` | `/sessions/:id/messages/:chatId/history?limit=&includeMedia=true` | — |
| `GET` | `/sessions/:id/messages/:messageId/:mediaId/media` | — → blob |
| `GET` | `/sessions/:id/messages/batch/:batchId` | — |

Tipos de mensaje que emite el proveedor:
`text` · `image` · `video` · `audio` · `voice` · `document` · `sticker` ·
`location` · `contact` · `poll` · `call` · `revoked` · `masked` · `unknown`

## Webhooks

| Método | Ruta | Cuerpo |
| --- | --- | --- |
| `GET` | `/webhooks` | — (todos) |
| `GET` | `/sessions/:id/webhooks` | — |
| `POST` | `/sessions/:id/webhooks` | `{ url, events, secret?, headers?, filters? }` |
| `PUT` | `/sessions/:id/webhooks/:webhookId` | `{ url, events, active, filters? }` |
| `DELETE` | `/sessions/:id/webhooks/:webhookId` | — |
| `POST` | `/sessions/:id/webhooks/:webhookId/test` | — |

`secret` y `headers` son **de solo escritura**: se aceptan al crear o actualizar
pero ninguna ruta los devuelve, y tampoco aparecen en `GET /api/infra/export-data`.
Un webhook restaurado desde respaldo queda **sin firmar** hasta reconfigurarlo.

> El dashboard web no expone el campo `secret`; el API sí lo acepta. Registrar
> siempre el webhook desde el CRM, nunca desde la interfaz de OpenWA, o las
> entregas llegarán sin firma.

### Envolvente de entrega

```json
{
  "event": "message.received",
  "timestamp": "2026-02-02T10:00:00.000Z",
  "sessionId": "my-session",
  "idempotencyKey": "msg_my-session_3EB0ABC123",
  "deliveryId": "dlv_550e8400-e29b-41d4-a716-446655440000",
  "data": {}
}
```

`event`, `timestamp`, `sessionId`, `idempotencyKey` y `deliveryId` están siempre
presentes. La firma **no** viaja en el cuerpo.

### Encabezados de entrega

| Encabezado | Uso |
| --- | --- |
| `X-OpenWA-Signature` | `sha256=<hex>` — HMAC-SHA256 sobre los **bytes crudos** del cuerpo. Omitido si el webhook no tiene `secret`. |
| `X-OpenWA-Event` | Nombre del evento. |
| `X-OpenWA-Idempotency-Key` | Derivada del contenido y **estable entre reintentos**. Es la llave de deduplicación. |
| `X-OpenWA-Delivery-Id` | `dlv_<uuid>` nuevo por entrega. Solo trazabilidad, **no** sirve para deduplicar. |
| `X-OpenWA-Retry-Count` | `0` en el primer intento. |
| `User-Agent` | `OpenWA-Webhook/1.0.0` |

Verificación correcta:

```ts
const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
timingSafeEqual(Buffer.from(expected), Buffer.from(received));
```

Recalcular sobre un cuerpo re-serializado **nunca** coincide.

### Catálogo de eventos y payload de `data`

| Evento | `data` |
| --- | --- |
| `message.received` | `id`, `from`, `to`, `body`, `type`, `timestamp` (epoch **segundos**), `isGroup`, `kind`, `hasMedia`, `contact{name?,pushName?}`, `senderPhone?` |
| `message.sent` | Mismo objeto que `message.received` |
| `message.ack` | `{ id, messageId, status, ack }` — `status`: `pending`/`sent`/`delivered`/`read`/`failed` |
| `message.failed` | `{ id, messageId, status:"failed", ack:-1 }` |
| `message.revoked` | `{ id, revokedId?, chatId, from, to, type:"revoked", body:"", timestamp }` |
| `message.reaction` | `{ messageId, chatId, reaction, senderId, reactions? }` |
| `message.edited` | `{ messageId, chatId, body, senderId, from, to, fromMe, isGroup, type, hasMedia, timestamp }` |
| `session.qr` | `{ sessionId, qr }` — `qr` es un **data URL PNG**, listo para `<img src>` |
| `session.authenticated` | `{ sessionId, phone, pushName }` |
| `session.disconnected` | `{ sessionId, reason }` — no se emite en stop/logout/delete por API |
| `session.status` | `{ sessionId, status }` |
| `session.restriction` | `{ sessionId, active, kind, code, expiresAt }` |
| `session.reconnect_loop` | `{ sessionId, attempts, nextDelayMs }` |
| `call.received` | `{ callId, from, isVideo, isGroup, timestamp }` |
| `group.join` / `group.leave` / `group.update` | `{ groupId, actorId?, participantIds, timestamp }` |
| `presence.update` | `{ sessionId, chatId, participants[], groupOnlineCount? }` |
| `status.received` | Opt-in explícito; requiere listar el evento. |

`kind` discrimina el chat: `individual` · `group` · `channel` · `status` ·
`broadcast` · `unknown`.

### Consecuencias para el CRM

Tres hechos del contrato que determinan el diseño de la integración:

1. **No existe `fromMe` en `message.received`.** Los mensajes salientes llegan
   como un evento **distinto**, `message.sent`. Un asesor que responde desde su
   teléfono produce `message.sent`, no un `message.received` con bandera. Hay
   que suscribirse a ambos y tratar `message.sent` como la ruta de eco y de
   toma de control desde el teléfono (spec del CRM §8.6).

2. **La deduplicación va por `idempotencyKey`**, no por un `event_id`. Es estable
   entre reintentos; `deliveryId` cambia en cada uno y no sirve.

3. **La entrega es *at-least-once*.** El manejador debe ser idempotente por
   contrato, no por optimismo.

Además, el eco de un envío propio del CRM llega como `message.sent` con el mismo
`data.id` que devolvió `send-text`: esa es la correlación que evita duplicar el
mensaje y evita marcar la conversación como intervenida por un humano cuando en
realidad respondió la IA.

### Multimedia

Un blob mayor a `WEBHOOK_MEDIA_INLINE_MAX_BYTES` (1 MiB por defecto) no viaja en
el payload; llega como `media: { mimetype, filename?, omitted: true, sizeBytes }`.
Se recupera después con
`GET /api/sessions/:id/messages/:chatId/history?includeMedia=true` o con la ruta
de blob por mensaje.

## Otros recursos disponibles

| Recurso | Rutas |
| --- | --- |
| Claves de API | `GET/POST /auth/api-keys`, `DELETE /auth/api-keys/:id`, `POST /auth/api-keys/:id/revoke` |
| Contactos | `/sessions/:id/contacts`, `/contacts/check/:number`, `/contacts/:id/profile-picture`, `/contacts/:id/phone` |
| Chats y grupos | `/sessions/:id/chats`, `POST /sessions/:id/chats/read`, `/sessions/:id/groups` |
| Plantillas | `/sessions/:id/templates` |
| Infraestructura | `/infra/status`, `/infra/config`, `/infra/restart`, `/infra/engines` |
| Métricas | `/stats/overview`, `/stats/messages?period=` |
| Auditoría | `/audit?action=&severity=&limit=&offset=` |
| Búsqueda | `/search?…` |
| Plugins | `/plugins`, `/integration/plugins/:id/instances` (con secreto de ingreso propio) |

## Websocket

Alternativa a los webhooks, en `ws://<host>/events` con `auth: { apiKey }`:

```js
socket.emit('message', {
  type: 'subscribe',
  sessionId: 'main',
  events: ['message.received', 'message.ack', 'session.status'],
  requestId: 'sub-1',
});
```

Útil para el QR y el estado en tiempo real sin sondeo (spec del CRM §20.3).
