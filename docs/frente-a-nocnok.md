# Horizonte frente a NOCNOK

> Qué le falta a Horizonte para competir, qué no vale la pena perseguir, y en
> qué orden construirlo. Basado en el recorrido de NOCNOK del 9 de septiembre
> de 2026 y en el inventario real del repositorio a esa fecha.
>
> Documentos hermanos: [`el-producto.md`](el-producto.md) (qué es Horizonte) y
> [`estado-del-proyecto.md`](estado-del-proyecto.md) (cómo va).

---

## 1. La conclusión primero

El propio análisis de NOCNOK dice dónde está el hueco, y conviene tomarlo en
serio antes de escribir una línea de código:

> «Competir por funciones es competir por el terreno donde NOCNOK es más débil
> y menos le importa. (…) El hueco real no está en hacer un CRM mejor. Está en
> las capas que la red no cubre: profundidad conversacional de verdad
> —recontacto proactivo, agendado confirmado, seguimiento que no dependa de que
> el humano abra la app—.»

Eso reparte el trabajo en tres montones, y el orden importa más que la lista:

| | Qué es | Por qué |
| --- | --- | --- |
| **A. Mesa de apuestas** | Lo que un dueño de agencia pide en la demo y sin lo cual no hay conversación de venta. | No gana la venta, pero la pierde si falta. |
| **B. Donde ganamos** | Profundidad conversacional. La IA que vuelve a escribir, que confirma la cita, que no alucina. | Es lo que NOCNOK tiene en «Próximamente» y en beta. |
| **C. No perseguir** | La red de 263 mil propiedades, los portales de paga, el pipeline hipotecario. | No se programa: se acumula, o se negocia con terceros. |

El error caro sería empezar por A hasta agotarla. A es un piso, no una meta.

---

## 2. Lo que Horizonte ya tiene

No para presumir: para no volver a construirlo y para saber qué se puede
prometer hoy en la landing.

- Multiagencia con aislamiento real por `organizationId` en toda tabla de
  negocio, verificado en el servidor y con pruebas que lo fijan.
- Cuatro roles (`OWNER`, `ADMIN`, `SUPERVISOR`, `ADVISOR`) con alcance por
  asesor en conversaciones.
- Agentes de IA con identidad, tono, saludo, instrucciones de la agencia,
  horario y reglas de escalamiento; tres proveedores intercambiables con la
  credencial cifrada en base.
- Seis herramientas con **la identidad resuelta desde el servidor**, nunca
  desde un argumento del modelo, y reglas antialucinación probadas.
- Bandeja en tiempo real por SSE, con toma de control humano —incluida la
  respuesta desde el teléfono del asesor, que el CRM detecta.
- Memoria de conversación condensada.
- Google Calendar con OAuth administrable, sincronización idempotente y la
  distinción entre visita **solicitada** y **confirmada**.
- Importación CSV/Excel con encabezados en español.
- Auditoría, salud del sistema y métricas operativas.

Dos de esas cosas —el control desde el teléfono y la garantía antialucinación—
no aparecen en el recorrido de NOCNOK. Son material de venta, no de roadmap.

---

## 3. Montón A — mesa de apuestas

Ordenado por lo que más pesa en una demo frente a un dueño de agencia.

### A1. Multimedia en la conversación · ✅ **hecho** (`9e03fbb`)

En bienes raíces una conversación sin fotos no es una carencia de producto: es
una conversación rota. El prospecto manda la foto del terreno y pide fotos de
la casa; el asesor manda el plano.

Los bytes viven en PostgreSQL porque no hay S3 ni MinIO y un volumen local no
sobrevive a la recreación del contenedor. `storageKey` lleva el prefijo del
backend, así que migrar a S3 el día que el volumen crezca es cambiar una
implementación de `MediaStorageService`.

> Verificar el contrato antes de escribir pagó solo: `sendMedia` mandaba un
> campo `media` que no existe, y la ruta de blob que teníamos documentada
> llevaba `messageId/mediaId` cuando la real es `chatId/messageId`. Las dos
> habrían fallado siempre.

### A2. Reglas de asignación de prospectos · ✅ **hecho** (`ab8c2e1`)

NOCNOK tiene cinco modos —responsable del inmueble, líder de grupo, carrusel,
guardia, propietario— y encima una regla que manda sobre todas: **mantener al
primer asesor que atendió**. Esa última es la más importante y la más barata:
es una regla de comisión disfrazada de software, y es lo que evita la pelea
interna que hunde la adopción de un CRM en una agencia.

✅ **Hecho** (`ab8c2e1`), con los cuatro modos que importan y la regla del
asesor persistente por encima de todos. Queda fuera «líder de grupo», que
necesita el concepto de equipo y todavía no existe.

### A3. Notificaciones · **hecho** (`8bfa453`)

NOCNOK cruza cinco eventos por tres canales. Horizonte cruza cinco eventos por
**dos**: consola y WhatsApp. El correo no está y no se finge: no hay SMTP en
esta infraestructura, y la pantalla lo dice en vez de ofrecer un canal que
falla en silencio.

El evento que vende —«prospecto nuevo»— sale por WhatsApp, que es el canal por
el que el dueño quiere enterarse sin abrir nada. Solo el primer mensaje de cada
hilo, para que el canal no se vuelva una conversación paralela con el asesor.

### A4. La ficha de propiedad, completa · ✅ **hecho** (`6e025d9`)

Lo que faltaba, y por qué importaba cada campo:

| Falta | Por qué importa |
| --- | --- |
| Operaciones más allá de venta y renta | NOCNOK maneja seis simultáneas sobre el mismo inmueble: preventa, desarrollo, temporal y remate son mercado real en México. |
| Comisión y comisión compartida | Es el campo del que cuelga toda la colaboración entre agencias. |
| Acuerdo de exclusividad | Cambia cómo se muestra y quién puede ofrecerla. |
| Clave interna propia | Las agencias ya tienen su nomenclatura y buscan por ella. |
| Medios baños, niveles, año, mantenimiento, estatus jurídico | Campos que los portales exigen y que el prospecto pregunta. |
| URL de video y recorrido virtual | Se mandan por WhatsApp más que las fotos. |
| Descripción privada del equipo | Lo que no se le dice al cliente pero el asesor necesita. |
| Propietario, confidencial por diseño | Es el activo que el dueño no quiere que se lleve un asesor. |
| Precisión de ubicación publicable | Decidir por propiedad si se muestra la calle exacta. |

### A5. Permisos granulares · **hecho en parte** (`97061da`)

Cuatro roles fijos contra los ~80 permisos de NOCNOK. Esta es la brecha que
justifica el salto de precio de asesor individual a agencia, y resuelve un
dolor que no tiene que ver con productividad: **el asesor que se va y se lleva
la cartera**.

No hacía falta copiar ochenta. Hay doce, y el rol sigue siendo el punto de
partida: la matriz existe para la excepción —un asesor que sí ve toda la
agencia, un supervisor sin reasignar— y no para llenarse entera. Se verifica
contra la base y no contra el token, para que retirar un permiso surta efecto
hoy y no cuando caduque la sesión.

**Lo que falta depende del Tramo 3.** «Editar propiedades de otros», «ver
propietarios de otros» y «descargar el inventario» no están porque `Property`
todavía no tiene dueño ni contacto confidencial, y no existe exportación. Una
prueba recorre el código y falla si alguien mete al catálogo un permiso que no
bloquea nada: un permiso que no muerde le promete al dueño un control que no
tiene.

### A6. Contactos separados del pipeline · ✅ **hecho** (`6e025d9`)

NOCNOK separa deliberadamente el **Directorio** —donde vive la persona— de
**Interesados** —donde vive la oportunidad—. Horizonte los fusionaba en `Lead`,
y eso obligaba a inventarle una oportunidad a un propietario, a un notario o a
un colega, ensuciando el embudo con registros que nunca iban a cerrar.

Ya existe `Contact`, con el teléfono único por agencia: dos fichas del mismo
dueño son un error, no un caso de uso.

### A7. Reporte al propietario y ficha compartible · ✅ **hecho** (`e071252`)

Es lo que el asesor enseña a su cliente y a su propietario, y lo único que hace
que el CRM se note fuera del equipo.

La ficha pública vive detrás de un enlace sin sesión, que la convierte en la
superficie más expuesta del sistema: lista blanca campo por campo, llave
aleatoria que no deriva del identificador, y la calle exacta solo si la agencia
lo decidió para esa propiedad.

El reporte cuenta **personas distintas**, no veces. Enseñarle la misma casa
tres veces a la misma persona no son tres interesados.

### A8. Etiquetas · **pendiente, bajo costo**

Catálogos propios para prospectos, contactos y propiedades. Es lo único que
queda del montón A.

---

## 4. Montón B — donde Horizonte gana

Esto es lo que hay que construir aunque A esté incompleto, porque es lo que
hace que la conversación de venta deje de ser una comparación de listas.

### B1. Seguimiento proactivo · **el diferenciador**

La IA vuelve a escribir sola. No cuando el humano se acuerda: cuando la regla
dice. «Pasaron dos días desde que le mandamos tres opciones y no contestó» →
un mensaje de seguimiento, con lo que ya se habló. «La visita es mañana» → un
recordatorio. «La propiedad que le gustó bajó de precio» → un aviso.

NOCNOK no lo tiene. Su asistente contesta; no persigue. Y es exactamente lo
que el dueño de agencia sabe que su equipo no hace.

✅ **Hecho** (`d3f9a40`), para el disparador de silencio. Apagado por omisión y
por agente, con franja de silencio nocturna como tope duro, baja voluntaria
detectada en la ingesta, y la capacidad del agente de negarse a insistir cuando
no tiene nada que aportar.

Faltan los otros dos disparadores del párrafo de arriba: el recordatorio de
visita y el aviso de cambio de precio. La infraestructura ya está —el barrido,
las guardas y la baja voluntaria sirven igual—; son reglas nuevas, no un
sistema nuevo.

### B2. Agendado confirmado · ✅ **hecho** (`573ea29`) · NOCNOK lo tiene en «Próximamente»

Hoy la IA registra una **solicitud** de visita y un asesor la aprueba —una
decisión correcta contra la alucinación—. El siguiente paso es que, cuando la
agencia lo autorice, la IA lea la disponibilidad real del calendario del asesor
y confirme dentro de esa disponibilidad. Sigue sin inventar: propone solo
huecos que existen.

Es la función que más pesa en una demo, y el competidor la tiene apagada.

### B3. La garantía antialucinación, como producto · **hecho** (`97061da`)

Que el agente no pueda mencionar una propiedad que no salió de una herramienta
ejecutada en esa conversación no es un detalle técnico: es la objeción número
uno de cualquier dueño que ha visto a un bot prometer algo inexistente.

Ya es visible. `AiRun` guardaba una lista de nombres de herramienta —con eso no
se responde «¿de dónde sacó ese precio?»— y ahora guarda con qué se llamó cada
una y qué devolvió. El panel de la conversación lo enseña junto a las
propiedades que la IA llegó a mostrar, con su hora. Un turno sin consultas se
dice con esas palabras: no afirmó nada del inventario.

### B4. Analista en lenguaje natural · **NOCNOK lo tiene en beta**

Preguntar «¿cuántos prospectos sin atender tengo?» y recibir la respuesta. La
infraestructura de herramientas ya existe; es un agente más con herramientas de
lectura sobre las métricas.

---

## 5. Montón C — no perseguir (con matices)

**La red compartida.** 263 mil propiedades y 29 mil oficinas no se programan.
El propio reporte lo dice: es simultáneamente el beneficio que se compra y el
candado que impide irse. Competir ahí es perder.

> El matiz: sí existe una versión pequeña y honesta. Cuando Horizonte tenga
> varias agencias, ofrecerles una bolsa **opt-in** entre ellas con comisión
> compartida explícita cuesta poco y empieza a acumular. No se anuncia como
> «red»: se ofrece como colaboración entre las agencias que ya están.

**Los portales de paga.** Inmuebles24 y MercadoLibre son contratos comerciales,
no código, y su factura es varias veces la del CRM.

> El matiz: los portales gratuitos —Mitula, Trovit, Clasco— se alimentan de un
> feed XML. Publicar un feed es trabajo de un día y es un renglón entero del
> comparador de planes.

**Pipeline hipotecario.** Es una vertical con su propio modelo de datos, sus
permisos y su directorio de brokers. Vale la pena, pero después de B.

**Sitio web incluido.** Plantilla más subdominio más el inventario propio. Es
un buen renglón de plan y no es difícil —el inventario y las fichas ya
existen—, pero no mueve la decisión de compra de quien vino por la IA.

---

## 6. Orden propuesto

Tres tramos. Cada uno termina en algo demostrable.

**Tramo 1 — que la conversación esté completa** (A1, A2, B1) · ✅ **hecho el
9 de septiembre de 2026, commits `9e03fbb`, `ab8c2e1` y `d3f9a40`**
Multimedia, la regla del asesor persistente más carrusel y guardia, y el
seguimiento proactivo. Al terminar, la demo es: llega un mensaje a las 11 de la
noche con una foto, se reparte solo, se contesta, y a los dos días la IA
insiste sin que nadie haga nada.

**Tramo 2 — que el dueño confíe** (A5, B3, A3) · ✅ **hecho el 9 de septiembre
de 2026, commits `97061da` y `8bfa453`**
Permisos que se piden en voz alta, el registro visible de lo que hizo la IA en
cada conversación, y notificaciones. Al terminar, la demo responde a «¿y cómo
sé que no está inventando?» y a «¿y cómo evito que mi asesor se lleve todo?».

Queda una parte de A5 atada al Tramo 3: los permisos sobre la propiedad no se
pueden exigir hasta que la propiedad tenga dueño.

**Tramo 3 — que la ficha aguante el mercado** (A4, A6, A7, B2) · ✅ **hecho el
9 de septiembre de 2026, commits `6e025d9`, `e071252` y `573ea29`**
La propiedad completa con comisión y exclusividad, contactos separados de
oportunidades, el reporte al propietario, y el agendado confirmado. Arrastró
además la deuda de A5: los tres permisos de inventario que el Tramo 2 no pudo
exigir porque no existía lo que gateaban.

Después de eso —y solo después— tienen sentido el feed a portales gratuitos, el
sitio web y la bolsa opt-in.

---

## 7. Lo que esto significa para el mensaje

Horizonte no es «NOCNOK pero mejor». La comparación directa se pierde: no hay
red que ofrecer y no la habrá pronto.

Lo que sí es cierto, y es lo que debe decir la landing:

- NOCNOK vende el lugar donde están tus colegas. **Horizonte vende la
  conversación que no estás teniendo a las 11 de la noche.**
- Su asistente contesta. **El nuestro no inventa, y eso es comprobable.**
- Su gestor de agenda dice «Próximamente». **El nuestro está en el calendario
  del asesor.**
- Su producto real vive en la web y su app móvil está abandonada. **El nuestro
  vive en WhatsApp, que es donde ya trabaja el asesor.**
