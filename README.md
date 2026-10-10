# TallerFlow · MVP para gestión de talleres

TallerFlow reúne una página pública para el cliente y un pequeño sistema operativo para el taller: catálogo, turnos, agenda, clientes, vehículos, historial de servicios, cola de mensajes y automatizaciones.

> **Estado de esta entrega:** MVP funcional y probado en modo demo. La demo usa datos ficticios en `localStorage`; no necesita credenciales ni manda WhatsApp, correo o Telegram. El backend de producción para Vercel + Google está incluido, pero **no está conectado a cuentas reales**. Antes de publicar turnos reales, seguí la instalación de Google, Vercel y Turnstile en `docs/DESPLIEGUE.md`.

## Qué incluye

- **Página pública responsive:** landing, categorías de servicio, precios indicativos, acceso a WhatsApp Business mediante enlace y solicitud de turno.
- **Reservas:** disponibilidad calculada en el servidor de datos, formulario cliente/vehículo, horario con duración del servicio, bloqueo del slot al solicitar y lista de espera para días completos.
- **Panel privado:** resumen, agenda por día, confirmación/cancelación/finalización/no-show, base con búsqueda, ficha de vehículos e historial, lista de espera, configuración visible y cola de mensajes.
- **Automatizaciones:** solicitud, confirmación manual, recordatorio ~24 h antes, seguimiento tras finalización, recuperación a 90/180 días y avisos de huecos cancelados a interesados.
- **Integración Google lista para configurar:** Sheets como sistema de registro, Calendar como espejo opcional, Apps Script como lógica y scheduler, Gmail/Telegram como aviso interno opcional.
- **Seguridad MVP:** firma HMAC entre Vercel y Apps Script, sesión admin firmada en cookie `HttpOnly`, verificación Turnstile obligatoria en producción, validación de origen, límite de peticiones por teléfono, consentimiento y envío manual explícito.
- **Pruebas:** 11 pruebas unitarias del dominio, validaciones, concurrencia lógica, estados, consentimiento, cola y automatizaciones.

## Probar la demo

Necesitás Node.js 20 o posterior.

```bash
npm install
npm test
npm run dev
```

Abrí la dirección local que imprime Vite. En Arena.ai también se puede usar la vista previa web que acompaña el proyecto. El modo demo está activado por defecto cuando no se establece `VITE_DEMO_MODE=false`.

1. Probá el catálogo y seleccioná un servicio.
2. En el formulario elegí una fecha/hora disponible, completá patente argentina (por ejemplo `AB123CD` o `ABC123`) y solicitá el turno.
3. Entrá a **Acceso al taller** → **Explorar el panel**. No hay contraseña de demo.
4. En **Agenda**, confirmá, cancelá o finalizá una reserva. Finalizarla agrega el servicio al historial.
5. En **Mensajes**, abrí el enlace de WhatsApp de demostración (el número es ficticio). El botón **Enviado** es una confirmación manual, no envía nada.
6. Usá **Restablecer demo** para volver a los datos iniciales.

Los cambios demo persisten en el almacenamiento local de ese navegador hasta que se restablece. No cargues información real de clientes en la demo.

## Arquitectura resumida

```text
Cliente
  ├─ Landing React/Vite en Vercel
  ├─ API same-origin /api → valida origen, sesión y Turnstile; firma HMAC
  └─ WhatsApp Business → enlace wa.me, envío manual del operador
                                         │
                                         ▼
                         Web App de Google Apps Script
                          ├─ HMAC, allowlist, lock y validación
                          ├─ Google Sheets: fuente de verdad
                          ├─ Google Calendar: espejo opcional
                          └─ Trigger cada 15 min → cola / digest
```

El flujo de producción de datos es deliberadamente sencillo: el navegador no se conecta directo a Google. **Vercel valida** cada llamada y firma un sobre; **Apps Script valida** la firma y ejecuta una acción permitida bajo lock. Sheets es la fuente de verdad. Calendar y los avisos son integraciones secundarias.

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — componentes, límites, secuencias e interacciones.
- [`docs/DATOS-Y-API.md`](docs/DATOS-Y-API.md) — modelo relacional, pestañas, estados y contrato de acciones.
- [`docs/AUTOMATIZACIONES.md`](docs/AUTOMATIZACIONES.md) — reglas, idempotencia, cuándo se crea cada mensaje y qué hace el operador.
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — configuración paso a paso de Google, Vercel, Turnstile, Calendar y notificaciones.
- [`docs/SEGURIDAD-Y-OPERACION.md`](docs/SEGURIDAD-Y-OPERACION.md) — privacidad, roles, amenazas, copias, incidentes y límites MVP.
- [`docs/PRUEBAS-Y-ROADMAP.md`](docs/PRUEBAS-Y-ROADMAP.md) — pruebas, criterios de aceptación y evolución sugerida.
- [`docs/SUGERENCIAS-DE-MEJORA.md`](docs/SUGERENCIAS-DE-MEJORA.md) — revisión del código actual con mejoras priorizadas (P0/P1/P2).

## Estructura

```text
src/domain.mjs       Reglas puras de negocio compartidas por demo y Google
src/client.mjs       Adaptador demo / API de Vercel
src/main.jsx         Landing, formularios y panel de administración
src/style.css        Diseño responsive
index.html           Shell y metadatos
vite.config.js       Preview permitido para host e2b.app
api/index.js         Gateway Vercel (sesión, Turnstile y firma HMAC)
google/Backend.gs    Web App, Sheets, Calendar, scheduler y digest interno
google/Domain.gs     Salida generada desde src/domain.mjs
scripts/build-google.mjs
scripts/password.mjs
 tests/domain.test.mjs
 docs/               Arquitectura y guías operativas
```

## Comandos

```bash
npm test                  # suite del dominio
npm run build             # compilación de producción
npm run google:build      # regenera google/Domain.gs desde el dominio compartido
```

**No edites `google/Domain.gs` a mano:** es generado. Editá `src/domain.mjs` y luego ejecutá `npm run google:build` antes de copiar el contenido al proyecto Apps Script.

## Invariantes que no se deben romper

1. La zona del negocio es `America/Argentina/Buenos_Aires` y el constructor de slots asume UTC−03, sin cambio estacional. Los horarios no deben alterarse mientras existan reservas sin una migración.
2. Una solicitud `requested` **bloquea** el horario hasta confirmar o cancelar. Sólo `confirmed` se sincroniza al calendario.
3. Sheets decide disponibilidad; Calendar es un espejo que se reconcilia cada 15 minutos, no una fuente alternativa de turnos.
4. Los mensajes sólo aparecen si el cliente autorizó WhatsApp. `opened` no significa `sent`; sólo el operador confirma el envío real.
5. `requestId`, clave de cada mensaje, locks y claves de 90/180 días son parte de la idempotencia. No eliminarlos sin migración.
6. Una oferta de hueco no reserva el turno. La solicitud normal vuelve a comprobar y bloquear el horario.

## Antes de usar con un taller real

- Reemplazá nombre, dirección, teléfono, servicios, horarios, precios y capacidad ficticios.
- Configurá Google Sheets y Apps Script; protegé el spreadsheet; restringí permisos a personas responsables.
- Desplegá Vercel con `VITE_DEMO_MODE=false` y todos los secretos/env vars requeridos.
- Activá Cloudflare Turnstile. La API bloquea reservas si no hay secreto Turnstile.
- Verificá que el propietario de Apps Script tenga acceso al calendario elegido y autorización de Sheets/Calendar.
- Hacé reservas, cancelaciones, consentimientos, recordatorios y restauración de copia en un entorno de prueba.
- Configurá exportaciones/backups, revisión diaria de la cola y responsable de responder a clientes.
- Activá el health-check del scheduler (#23): monitor GET cada 15 min a `https://<APP_ORIGIN>/api?action=ping` (UptimeRobot o cron-job.org) con alerta ante status ≠ 200; el backup diario (#10) también depende de los triggers y Google puede silenciarlos sin aviso.
- Revisá el aviso de privacidad y el mecanismo de ejercicio de derechos con asesoramiento adecuado a la jurisdicción del taller.

Para el procedimiento completo, consultar `docs/DESPLIEGUE.md` y `docs/SEGURIDAD-Y-OPERACION.md`.
