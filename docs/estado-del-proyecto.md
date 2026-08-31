# Estado del proyecto — Horizonte CRM

> Documento de contexto para retomar el trabajo. Última actualización:
> 31 de agosto de 2026, commit `f18f12a`.
>
> Complementa, no reemplaza:
> - [`especificacion-crm-ia-openwa-inmobiliaria.md`](../especificacion-crm-ia-openwa-inmobiliaria.md) — qué debe ser el producto
> - [`docs/openwa-contract.md`](openwa-contract.md) — contrato real de la pasarela de WhatsApp

---

## 1. Qué es

CRM conversacional multiagencia. Una inmobiliaria conecta números de WhatsApp,
crea agentes de IA que representan a sus asesores, y esos agentes atienden
prospectos consultando el inventario real de propiedades.

Monorepo TypeScript: Next.js (`apps/web`), NestJS (`apps/api`), Prisma
(`packages/db`), Redis + BullMQ para la cola de IA.

---

## 2. Dónde vive

| Servicio | URL | Notas |
| --- | --- | --- |
| Frontend | https://agentesia.diabolicalservices.tech | Dokploy app `inmobiliarIA-app` |
| API | https://crmwa-back.diabolicalservices.tech | Dokploy app `crm-api` |
| Panel Dokploy | https://admin.diabolicalservices.tech | Proyecto **InmobiliarIA** |
| OpenWA | https://openwa.diabolicalservices.tech | Contenedor `openwa-api`, imagen `ghcr.io/rmyndharis/openwa:latest` |
| Repositorio | https://github.com/diabolicalprojects/crm-wa | Rama `main` |

Servicios en Dokploy (proyecto `4MkX3s9ObIZO2YMAqf3uL`, entorno `b7YQS5UmYtSOd8MMdd2Gm`):

- `crm-api` · `PMHCccn5gZVbH1pdqQIzB`
- `inmobiliarIA-app` · `4KGTfhdIdLmvclAOasako`
- `inmobiliarIA-db` · `fNuxd3MJJaJfJWmlQkGmN` — PostgreSQL, imagen `pgvector/pgvector:pg16`
- `crm-redis` · `dSwTfCEr6J21x2oaD43xk` — creado en esta sesión, no existía

**Los despliegues son manuales.** El repositorio está configurado como Git
personalizado, sin webhook de GitHub, así que `git push` **no** dispara nada.
Hay que lanzarlos desde el panel o por API.

La concurrencia de builds está limitada a **1**. Dos builds simultáneos
agotaron la memoria del servidor y tumbaron la API *y el propio panel de
Dokploy* durante dos minutos. Los despliegues tardan más, a propósito.

---

## 3. Estado actual

### Funciona

- Autenticación, roles y aislamiento multi-tenant.
- Alta de agencias, equipo, invitaciones.
- CRUD de propiedades, prospectos, agentes, visitas.
- Importación CSV/Excel con encabezados en español.
- Conexión de números por QR; los mensajes entrantes llegan y se registran.
- Bandeja de tres columnas con panel del prospecto.
- La IA responde, captura preferencias y califica al prospecto.

### Pendiente de verificar

- **El ciclo completo de herramientas.** La IA respondió y calificó, pero
  `searchProperties` nunca llegó a ejecutarse por los fallos de la sección 4.
  Falta una conversación de punta a punta que recomiende una propiedad real.

### Pendiente de configurar

1. **`OPENWA_API_KEY` está vacía** en las variables de `crm-api`. Los mensajes
   entrantes llegan porque el webhook ya estaba registrado, pero **el CRM no
   puede enviar**. Generarla en el dashboard de OpenWA → Claves de API.
2. **Cuota de Gemini agotada** (`429 You exceeded your current quota`).
   Habilitar facturación o conectar Anthropic/OpenAI.
3. **Importar el inventario** de [`scripts/seed/inventario-demo.csv`](../scripts/seed/inventario-demo.csv)
   (24 propiedades, ambas operaciones, los seis tipos).

### No implementado

Las tres capas grandes de la spec que siguen sin existir:

- **Fuentes de inventario** API, XML/JSON y Google Sheets (§14.4). Solo hay
  carga manual y CSV/Excel.
- **Google Calendar** (§8.7). El modelo `Appointment` guarda `personalEventId`,
  `sharedEventId` y `syncStatus`, pero nada sincroniza.
- **Multimedia** (§21). No se reciben ni almacenan imágenes ni documentos.

Tampoco hay observabilidad estructurada (§19) ni pruebas de integración/E2E
(§22.2, §22.3).

---

## 4. Historia de fallas y sus causas

Esta es la parte que cuesta reconstruir. Cada una se detectó en producción.

### 4.1 La base de datos no persistía

**Síntoma:** el superadministrador desaparecía en cada redespliegue. El
historial de git tiene seis commits de «temp superadmin recovery» peleando con
esto sin encontrar la causa.

**Causa:** la imagen es `pgvector/pgvector:pg16`, pero el volumen estaba
montado en `/var/lib/postgresql/18/docker` y contenía un directorio de datos de
**PostgreSQL 18**. PG16 no puede leerlo, así que lo ignoró e inicializó una
base nueva en `/var/lib/postgresql/data` — la capa efímera del contenedor.
Cada recreación la borraba.

**Arreglo:** `PGDATA=/var/lib/postgresql/18/docker/pg16`, un subdirectorio
*dentro* del volumen montado. Verificado: `PG_VERSION` = 16 en esa ruta.

> No se cambió el mount porque el volumen conserva en su raíz el directorio
> PG18 huérfano. Si algún día se limpia, lo correcto sería montar en
> `/var/lib/postgresql/data` con un volumen nuevo.

### 4.2 El webhook nunca se registraba

**Causa:** la URL se armaba con `PUBLIC_API_URL`, variable que no existía en el
entorno — en `.env.example` se llamaba `APP_URL`. La guarda
`if (webhookUrl.startsWith('http'))` saltaba el registro **sin error**. Las
sesiones se conectaban, el QR funcionaba, y ningún mensaje llegaba jamás.

**Arreglo:** nombre unificado y validación de configuración al arrancar
([`config.ts`](../apps/api/src/config.ts)). Un despliegue mal configurado ahora
falla de inmediato con el detalle.

### 4.3 El contrato de OpenWA no coincidía con el código

El Swagger no está expuesto en la instancia. El contrato se derivó del bundle
del dashboard (`/assets/api-*.js`, que contiene su cliente) y de
`docs/06-api-specification.md` del repositorio fuente. Quedó fijado en
[`docs/openwa-contract.md`](openwa-contract.md).

Tres incompatibilidades que rompían todo:

1. **El envelope real** es `{event, timestamp, sessionId, idempotencyKey, data}`.
   El código leía `event.type`, `event.session_id`, `event.from`. Ni un campo
   coincidía.
2. **El HMAC** se calculaba sobre el cuerpo re-serializado —que nunca reproduce
   los bytes originales— y se comparaba sin el prefijo `sha256=` que envía el
   proveedor. Requiere `rawBody: true`.
3. **No existe `fromMe`.** Los salientes llegan como un evento distinto,
   `message.sent`. El asesor que respondía desde su teléfono era invisible para
   el CRM y la IA seguía contestando encima de él.

### 4.4 Fuga entre agencias

Los `PATCH` de propiedades, prospectos, agentes y visitas pasaban el `@Body()`
crudo a Prisma. Un `ADVISOR` podía enviar `{"organizationId": "otra-agencia"}`
y mover el registro fuera de su tenant. El `ValidationPipe` no protegía porque
no había un solo decorador de `class-validator` pese a estar instalado.

**Arreglo:** DTOs en todo endpoint de escritura, `forbidNonWhitelisted`, y
`@Roles` en todos los controladores.

### 4.5 La migración destructiva

La migración generada por Prisma borraba `Property.location`, `Property.url`,
las columnas de `Message`, y las tablas `Visit` y `LlmProvider` completas
—incluidas las credenciales de IA cifradas—.

Se reescribió preservando datos, **y falló en producción** con `42P07`: al
cambiar `DROP COLUMN` por `ALTER COLUMN TYPE` quedó vivo un índice que la misma
migración recreaba después.

**Arreglo:** una sola migración inicial que crea el esquema final. La cadena
«crear esquema viejo → transformarlo» solo aporta si hay datos que preservar, y
no los había en ningún entorno (ver 4.1). Eso elimina la clase entera de riesgo.

> **Lección:** una migración que falla deja la base bloqueada con `P3009` y el
> contenedor en bucle. Y si el contenedor viejo sigue reiniciándose mientras
> limpias el esquema, vuelve a aplicar las migraciones antiguas y lo re-rompe.
> Detén la aplicación **antes** de tocar el esquema.

### 4.6 La conversación no adoptaba el agente

**Síntoma:** ningún mensaje obtenía respuesta pese a tener agente activo, canal
conectado y webhook funcionando. Cero filas en `AiRun`, ningún log.

**Causa:** `onInbound` fotografiaba `session.agentId` al crear la conversación
y el `upsert` nunca lo revisaba después. Las conversaciones creadas **antes**
de asignar el agente al canal guardaban `agentId` nulo para siempre, y el
worker las descartaba.

**Arreglo en tres capas**, para que no dependa del orden de configuración:
al asignar un canal las conversaciones huérfanas lo adoptan; el worker resuelve
el agente desde el canal; `onInbound` completa el nulo al llegar un mensaje.

### 4.7 Gemini 3 y la firma de razonamiento

**Síntoma:** la IA respondía una vez —el saludo, sin herramientas— y fallaba en
cuanto intentaba buscar propiedades, con
`400 Function call is missing a thought_signature in functionCall parts`.

**Causa:** Gemini 3 adjunta a cada llamada de herramienta una instantánea
cifrada de su razonamiento y exige recibirla de vuelta en el turno siguiente.
La capa de compatibilidad con OpenAI la pierde. Es una incompatibilidad
conocida que afecta a varios clientes, no algo propio del CRM:

- [openai/codex#7519](https://github.com/openai/codex/issues/7519)
- [openai-python#2758](https://github.com/openai/openai-python/issues/2758)
- [Foro de Google AI](https://discuss.ai.google.dev/t/openai-api-compatibility-broken-due-to-thought-signature-on-gemini-3-pro-preview/109823)

**Arreglo:** `OpenAiCompatibleAdapter` transporta `extra_content` de forma
opaca — lo captura de la respuesta y lo devuelve intacto. No lo interpreta.

> Si el ciclo de herramientas es crítico, **Anthropic u OpenAI evitan este
> rodeo por completo.**

### 4.8 Una falla dejaba la conversación muda para siempre

El `jobId` de la cola es el `conversationId`, para garantizar un solo trabajo
activo por conversación. Pero un trabajo terminado —completado o fallido—
conserva su `jobId` hasta que se elimina, y **BullMQ descarta en silencio**
toda alta con un id ocupado.

Un solo `429` de cuota dejaba esa conversación sin respuesta permanentemente.
Y corregir `removeOnFail` no bastaba: las ya atascadas seguían con su trabajo
viejo en Redis.

**Arreglo:** `removeOnFail: true` **y** `enqueue` retira el trabajo previo si
está en estado terminal, lo que repara las atascadas al siguiente mensaje.

---

## 5. Trampas conocidas

**Un 502 de Traefik se ve como error de CORS.** Las respuestas de error del
proxy no llevan cabeceras CORS, así que el navegador reporta «blocked by CORS
policy». Antes de tocar la configuración de CORS, comprueba que el servicio
esté vivo.

**El botón «Probar» de un proveedor de IA no ejerce las herramientas.** Hace
una llamada mínima sin `tools`. Puede salir verde y aun así fallar el ciclo
completo. Pendiente: ampliarlo para que valide una llamada con herramientas.

**El descubrimiento de modelos devuelve los IDs con prefijo.** Gemini lista
`models/gemini-3.1-flash-lite`. Funciona así, pero si aparece un error de
modelo no encontrado, prueba sin el prefijo.

**El catálogo de modelos escrito a mano envejece rápido.** Estaba desactualizado
en dos de tres proveedores a las pocas semanas. Por eso existe
`POST /admin/ai/providers/discover-models`: pregunta al proveedor qué admite
esa credencial. El catálogo es solo el respaldo previo a capturar la clave.

**La imagen de OpenWA es `latest`.** La spec §18.2 pide fijar versión. Una
actualización automática puede cambiar el contrato documentado sin aviso.

---

## 6. Recetas de diagnóstico

No hay acceso SSH directo. La vía es crear una tarea programada en Dokploy con
`scheduleType: "dokploy-server"`, ejecutarla a mano y leer su log.

```bash
CID=$(docker ps -qf name=inmobiliaria-db-l4l1ik | head -1)
docker exec "$CID" psql -U crm -d crm_ia -x -c "TU CONSULTA"
```

> El lector de logs devuelve solo el **final**. Consultas cortas, o pon lo
> importante al final del script.

Consultas que resolvieron los problemas de este documento:

```sql
-- ¿Por qué no responde la IA? Empieza aquí.
SELECT status, model, "createdAt", "latencyMs", "toolsInvoked",
       left(coalesce("errorMessage",'-'), 260) AS error
FROM "AiRun" ORDER BY "createdAt" DESC LIMIT 5;

-- ¿Las conversaciones tienen agente? (causa de 4.6)
SELECT count(*) FILTER (WHERE "agentId" IS NULL) AS sin_agente,
       count(*) AS total FROM "Conversation";

-- ¿Hay proveedor de IA utilizable?
SELECT (SELECT count(*) FROM "AiProvider" WHERE enabled) AS proveedores,
       (SELECT count(*) FROM "AiModelConfig" WHERE enabled) AS configs;

-- ¿Llegan los webhooks y en qué estado?
SELECT "eventType", status, count(*) FROM "WebhookEvent"
GROUP BY 1,2 ORDER BY 3 DESC;
```

Desde `f18f12a` el worker **registra el motivo** cuando decide no responder
—qué agente, en qué estado, qué canal, si está fuera de horario—, así que
revisa primero los logs de `crm-api` antes de consultar la base.

---

## 7. Decisiones tomadas

| Decisión | Razón |
| --- | --- |
| Alcance: los 22 criterios de aceptación completos | Elección del propietario sobre una demo vertical más corta |
| Tres proveedores de IA con selector de modelo | Anthropic, OpenAI, Gemini y compatibles; la clave se elige después |
| Anthropic vía SDK oficial; el resto vía formato OpenAI | Gemini expone endpoint compatible, no necesita adaptador propio |
| Credenciales de IA en base cifrada, no en variables de entorno | Cada agencia puede tener la suya; el superadministrador las administra |
| `OPENWA_BASE_URL`/`OPENWA_API_KEY` no bloquean el arranque | Ya fallan de forma ruidosa al usarlas; tumbar todo el CRM por una credencial pendiente es peor |
| `PUBLIC_API_URL` sí bloquea el arranque | Su ausencia causaba una falla silenciosa (4.2), que es la peor clase |

---

## 8. Siguientes pasos sugeridos

1. **Cerrar el ciclo end-to-end.** Resolver la cuota de IA, capturar
   `OPENWA_API_KEY`, importar el inventario y confirmar que el agente recomienda
   una propiedad real.
2. **Ampliar la prueba del proveedor** para que ejerza una llamada con
   herramientas, no solo texto.
3. **Fuentes de inventario externas** (§14.4) — el motor de mapeo ya está
   diseñado en el esquema (`PropertySource`, `PropertySyncRun`), falta el worker.
4. **Google Calendar** (§8.7) — el modelo está listo, falta OAuth y el worker
   de sincronización.
5. **Observabilidad** (§19) — logs estructurados con `conversationId`,
   `aiRunId`, y alertas de sesión caída y cola atascada.
6. **Pruebas de integración** con un mock contractual de OpenWA (§22.2), que
   habrían atrapado casi todo lo de la sección 4.
