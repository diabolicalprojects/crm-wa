# Horizonte CRM — qué es el producto

> Contexto de dominio. Describe qué es la aplicación, con qué vocabulario
> piensa y qué reglas la gobiernan.
>
> Documentos hermanos:
> [`especificacion-crm-ia-openwa-inmobiliaria.md`](../especificacion-crm-ia-openwa-inmobiliaria.md)
> (requisitos completos) y [`docs/openwa-contract.md`](openwa-contract.md)
> (contrato de la pasarela de WhatsApp).

---

## 1. En una frase

Un CRM conversacional donde varias agencias inmobiliarias conectan sus números
de WhatsApp y crean agentes de IA que atienden prospectos consultando el
inventario real de propiedades, con un asesor humano capaz de tomar el control
en cualquier momento.

## 2. El problema que resuelve

Una inmobiliaria recibe más conversaciones de WhatsApp de las que su equipo
puede atender. Los prospectos escriben a cualquier hora, preguntan lo mismo una
y otra vez, y la mayoría no está lista para comprar. El asesor gasta su tiempo
en filtrar en vez de en cerrar.

El producto pone un agente de IA a hacer ese primer tramo: entiende qué busca
la persona, consulta el inventario real, recomienda opciones que existen,
captura los criterios y califica la intención. Cuando la conversación amerita
una persona —negociación, dudas legales, un prospecto listo para visitar— la
transfiere con todo el contexto.

**No es un chatbot con un catálogo pegado.** Es un CRM: el inventario, los
prospectos, las conversaciones, las visitas y la auditoría viven en el mismo
sistema, y el agente de IA es una forma de operarlo.

## 3. Vocabulario del dominio

Los nombres importan porque son los del código y los de la base de datos.

| Término | Qué es |
| --- | --- |
| **Organización** | Una agencia. Es el límite de aislamiento: sus datos nunca se cruzan con los de otra. Todo registro de negocio lleva `organizationId`. |
| **Usuario** | Una persona que entra al CRM. Pertenece a una o más organizaciones mediante una **membresía** con rol. |
| **Agente** | La representación digital de un asesor real: nombre visible, tono, saludo, instrucciones y reglas de escalamiento. Tiene un `responsibleUserId` obligatorio. **No es la sesión de WhatsApp ni el modelo de lenguaje**: es la identidad con la que se responde. |
| **Sesión de WhatsApp** | La conexión con un número, a través de OpenWA. Se autentica escaneando un QR. |
| **Canal** | Cómo se le llama a una sesión en la interfaz. Un agente usa un canal, y un canal atiende a un agente: relación uno a uno mientras la asignación esté activa. |
| **Prospecto** (`Lead`) | Una persona interesada, identificada por su teléfono dentro de una organización. Acumula criterios de búsqueda, calificación y resumen. |
| **Conversación** | El hilo entre un prospecto y una sesión. Su clave natural es `(organización, prospecto, sesión)`: el mismo prospecto escribiendo a dos números produce dos conversaciones distintas, cada una con su agente. |
| **Mensaje** | Un evento de la conversación, entrante o saliente, con su autor —prospecto, IA, humano o sistema— y su origen: el CRM, WhatsApp, o el teléfono del asesor. |
| **Propiedad** | Una unidad del inventario, con operación, tipo, precio, ubicación desglosada, características y amenidades. |
| **Visita** (`Appointment`) | Una cita para ver una propiedad. PostgreSQL es su fuente de verdad; Google Calendar es un reflejo. |
| **Proveedor de IA** | Un servicio de modelos de lenguaje —Anthropic, OpenAI, Gemini o cualquiera compatible— con su credencial cifrada. Lo administra el superadministrador. |
| **Configuración de modelo** | Qué modelo concreto usar, con su temperatura y límites. Un agente puede tener la suya o heredar la predeterminada. |

## 4. Cómo se relacionan las piezas

```
Organización
├── Usuarios (con rol)
├── Agentes ──── 1:1 ──── Sesiones de WhatsApp
│     │                          │
│     └──────────┬───────────────┘
│                ▼
│          Conversaciones ──── Mensajes
│                │
├── Prospectos ──┘
│     └── Criterios de búsqueda, calificación, resumen
│
├── Propiedades ──── recomendadas en ──── Conversaciones
│
└── Visitas ──── reflejadas en ──── Google Calendar
```

Las dos reglas estructurales que más consecuencias tienen:

1. **Un agente representa a un asesor real**, y en esta versión un asesor tiene
   como máximo un agente activo. El agente no es un bot genérico: es «Andrea,
   la asesora de residencial».
2. **Un agente usa un canal y un canal atiende a un agente.** El historial
   permanece ligado a la conversación aunque cambie la asignación.

## 5. El flujo central

1. Un prospecto escribe al número de WhatsApp de la agencia.
2. OpenWA entrega el mensaje al CRM por webhook, firmado.
3. El CRM identifica la sesión, encuentra o crea al prospecto y la conversación,
   y guarda el mensaje.
4. Se encola un trabajo de respuesta, uno solo por conversación, con una ventana
   corta que agrupa mensajes consecutivos.
5. El agente construye su contexto, consulta el inventario con herramientas y
   redacta una respuesta.
6. Antes de enviar se revalida quién tiene el control: si un humano intervino
   mientras tanto, la respuesta se descarta.
7. La respuesta sale por la misma sesión por la que entró el mensaje.

En paralelo, la bandeja del CRM se actualiza en vivo para quien la esté mirando.

## 6. El agente de IA

### Cómo se construye su contexto

Por capas, en este orden. Cada una puede matizar a las siguientes, nunca
contradecir a las anteriores:

1. Políticas de seguridad y privacidad.
2. Reglas del negocio inmobiliario, incluidas las antialucinación.
3. Configuración de la organización: zona horaria, idioma.
4. Identidad del agente: nombre, tono, saludo, instrucciones de la agencia.
5. Reglas de escalamiento configuradas.
6. Perfil del prospecto: criterios confirmados, etapa, calificación.
7. Memoria condensada de lo hablado antes de la ventana reciente.
8. Historial reciente de mensajes.

Las instrucciones que escribe la agencia van delimitadas: son un aporte al
comportamiento, no una vía para desactivar las reglas del sistema.

### Sus herramientas

Seis, y son la única forma en que toca datos:

| Herramienta | Para qué |
| --- | --- |
| `searchProperties` | Busca en el inventario con filtros estructurados y puntúa la coincidencia. |
| `getPropertyDetails` | Trae la ficha completa de una propiedad y verifica que siga disponible. |
| `updateLeadPreferences` | Guarda los criterios que el prospecto expresó. |
| `qualifyLead` | Asigna calificación y etapa con motivos visibles. |
| `requestPropertyVisit` | Registra una **solicitud** de visita. |
| `handoffToHuman` | Transfiere la conversación con su motivo y prioridad. |

La identidad —qué agencia, qué prospecto, qué conversación— **se resuelve
siempre desde el contexto del trabajador, nunca desde un argumento que genere
el modelo**. Aunque el modelo invente un identificador de otra agencia, no
tiene efecto.

### Lo que tiene prohibido

- Inventar propiedades, precios, disponibilidad, ubicaciones o enlaces. Todo lo
  que menciona debe venir de una herramienta ejecutada en esa conversación.
- Afirmar que una visita quedó confirmada cuando solo se creó una solicitud.
- Prometer rendimientos, plusvalía o aprobación de crédito.
- Dar asesoría legal, fiscal o financiera.

Cuando no hay coincidencias, lo dice y pregunta qué criterio se puede
flexibilizar. No ofrece alternativas inventadas.

## 7. Quién manda en una conversación

Una conversación tiene un **modo de control** que decide quién responde:

- `AI_ACTIVE` — la IA responde automáticamente.
- `HUMAN_ACTIVE` — solo una persona responde; la IA queda en silencio.
- `AI_PAUSED` — pausada sin que nadie la haya tomado.
- `DISABLED` — sin automatización.

Tres formas de que un humano tome el control:

1. **Desde el CRM**, con el botón de tomar la conversación.
2. **Respondiendo desde el CRM**: enviar un mensaje pausa la IA.
3. **Respondiendo desde el teléfono.** El asesor escribe por WhatsApp como
   siempre, y el CRM se entera y pausa la automatización.

La pausa **no vence sola**. Solo un «Devolver a la IA» explícito la reactiva, y
al hacerlo se deja una nota de sistema en el contexto para que el agente sepa
que hubo intervención humana.

## 8. Roles

| Rol | Qué puede |
| --- | --- |
| `SUPER_ADMIN` | Crea agencias, administra proveedores de IA e integraciones globales, y supervisa la salud del sistema. No pertenece a ninguna agencia. |
| `OWNER` | Control total de su agencia. |
| `ADMIN` | Gestiona miembros, agentes, canales, inventario y conversaciones. |
| `SUPERVISOR` | Ve todas las conversaciones de la agencia, reasigna y toma control. |
| `ADVISOR` | Ve solo las conversaciones de su agente o las que le asignaron. |

Los permisos se verifican en el servidor. Ocultar un botón en la interfaz no es
autorización.

## 9. Arquitectura

Monorepo TypeScript con tres piezas y dos servicios de apoyo:

| Pieza | Responsabilidad |
| --- | --- |
| `apps/web` — Next.js | La interfaz: bandeja, inventario, prospectos, configuración y consola de superadministración. |
| `apps/api` — NestJS | Autenticación, autorización, aislamiento por agencia, webhooks, herramientas del agente y trabajador de respuestas. |
| `packages/db` — Prisma | Esquema y migraciones de PostgreSQL, la fuente de verdad. |
| Redis + BullMQ | Cola de respuestas, con una partición por conversación. |
| OpenWA | Pasarela de WhatsApp: mantiene las sesiones y transporta los mensajes. |

### Fronteras que el diseño respeta

- **OpenWA transporta, no decide.** Vive detrás de una interfaz propia; el
  dominio no conoce su formato. Cambiar de pasarela debería ser escribir otra
  implementación, no reescribir el CRM.
- **El modelo de lenguaje propone, no ejecuta.** No toca la base de datos: pide
  herramientas, y esas herramientas validan agencia, argumentos y permisos.
- **El trabajo pesado no ocurre en el ciclo del webhook.** El webhook responde
  rápido y encola; generar una respuesta puede tardar segundos.
- **Las credenciales se administran, no se despliegan.** Las claves de los
  proveedores de IA y de Google viven cifradas en la base y se capturan desde
  la consola, no en variables de entorno.

## 10. Decisiones que explican el comportamiento

**El inventario acota lo que se puede ofrecer.** Si una propiedad no está en el
CRM, para el agente no existe. Es deliberado: es la garantía de que no promete
algo que la agencia no tiene.

**Una visita solicitada no es una visita confirmada.** La IA registra la
intención; un asesor la aprueba. El calendario lo refleja marcándola como
pendiente de confirmar.

**La entrega de mensajes es «al menos una vez».** El sistema deduplica por una
llave estable, porque la pasarela puede entregar el mismo evento más de una vez.

**La memoria no es «los últimos diez mensajes».** Además de la ventana reciente
se conserva un resumen que distingue hechos confirmados, inferencias y
pendientes.

**WhatsApp mediante cliente no oficial.** Conlleva riesgo de restricción del
número. El sistema registra esos eventos en la auditoría y el adaptador está
preparado para migrar a la API oficial.

## 11. Hacia dónde se extiende

La infraestructura común —organizaciones, usuarios, agentes, canales,
prospectos, conversaciones, handoff, auditoría— no es específica de inmuebles.
El módulo inmobiliario es un catálogo con sus herramientas de búsqueda.

Una agencia de viajes reutilizaría todo lo anterior y sustituiría el catálogo:
destinos, paquetes e itinerarios, con sus propias herramientas de consulta y
cotización, bajo la misma interfaz de herramientas. Los campos de viajes no se
agregan a `Property`: se modela un catálogo aparte.
