# Guía de instalación y despliegue

Esta guía separa la **demo** del **uso real**. Para producción se necesitan cuentas externas del taller; no se deben compartir contraseñas/keys con el asistente ni ponerlas en el frontend.

## 0. Requisitos

- Node.js 20+ para local/compilación.
- Cuenta Google del taller, Google Sheets y Google Apps Script con permiso para publicar Web Apps.
- Cuenta Vercel con el proyecto/repo.
- Cloudflare Turnstile (widget + secret key) para proteger operaciones públicas.
- Cuenta WhatsApp Business del taller. Al inicio los mensajes se envían a mano desde su aplicación.
- Opcionales: Google Calendar del taller; email operativo; bot y chat de Telegram.

**No existe un botón de “conectar Google” en el panel.** La conexión se hace mediante Script Properties, despliegue Apps Script y variables de entorno; el dashboard no recibe tokens de Google.

## 1. Verificar el repositorio y la demo

```bash
cd tallerflow
npm install
npm test
npm run build
npm run dev
```

La demo no llama a Google y guarda datos ficticios localmente. Corregí cualquier nombre, tarifa, dirección y número ficticio antes de producción.

## 2. Preparar el proyecto de Apps Script

### 2.1 Crear hoja

1. Crear un Google Spreadsheet nuevo en la cuenta del taller.
2. Copiar el ID que aparece entre `/d/` y `/edit` en la URL.
3. Dejar que `setup()` cree las pestañas; no crear fórmulas en las columnas operativas.

### 2.2 Crear Apps Script y copiar el dominio

1. Ejecutar en el repo `npm run google:build`. Esto genera `google/Domain.gs` a partir de `src/domain.mjs`.
2. En `script.google.com`, crear un proyecto independiente ligado a la cuenta del taller.
3. Añadir un archivo `Domain.gs` y pegar **todo** `google/Domain.gs`.
4. Añadir un archivo `Backend.gs` y pegar `google/Backend.gs`.
5. En **Project Settings → Show `appsscript.json` manifest**, reemplazar el manifiesto por el contenido de `google/appsscript.json`.
6. En **Services / +** activar Google Sheets API (`Sheets`, versión v4). Si el panel lo solicita, habilitar Google Sheets API también en el proyecto de Google Cloud asociado.

`Domain.gs` es generado; si se cambia una regla compartida del dominio, regenerarlo y reemplazar su contenido en el editor. Cada cambio a Apps Script exige una nueva versión de despliegue.

### 2.3 Script Properties

En **Project Settings → Script properties** agregar:

| Nombre | Valor |
|---|---|
| `SPREADSHEET_ID` | ID de la hoja del taller |
| `GAS_SECRET` | Secreto aleatorio largo; usar exactamente el mismo en Vercel |
| `CALENDAR_ID` | Opcional; ID de calendario compartido con el propietario del script |
| `NOTIFY_EMAIL` | Opcional; email interno que recibe el digest diario |
| `TELEGRAM_BOT_TOKEN` | Opcional; secreto del bot, sólo Apps Script |
| `TELEGRAM_CHAT_ID` | Opcional; chat/canal privado de operaciones |
| `DASHBOARD_URL` | Opcional; URL de producción de Vercel para el digest |

Generar al menos 32 bytes aleatorios por secreto y conservarlos en un gestor de secretos. Ejemplo en terminal local: `openssl rand -hex 32`. **No usar el mismo valor para `GAS_SECRET` y `SESSION_SECRET`; no guardarlos en Git, Sheets, capturas ni `VITE_*`.**

### 2.4 Inicializar y autorizar

1. Seleccionar `setup` en el selector de funciones de Apps Script y pulsar Ejecutar.
2. Revisar permisos y autorizar Sheets, Calendar, correo, UrlFetch y triggers. Calendar es opcional; si no se configura un calendario, evitar aceptar permisos innecesarios cuando la consola permita controlarlos.
3. Revisar las pestañas y encabezados creados: `config`, `services`, `clients`, `vehicles`, `appointments`, `history`, `messages`, `waitlist`.
4. `setup()` instala un trigger de 15 minutos; si se corre otra vez, reemplaza ese trigger para no duplicarlo.
5. Ajustar la fila `config` y tabla `services`. El `value` de config contiene JSON. Mantener IDs de servicios únicos y sin cambiarlos después de tener reservas.
6. Restringir acceso de edición a la hoja y al script al propietario y personal que gestione clientes.

`setup()` inicia la base vacía; no copia personas ni turnos demo. Evitar importar información real sin limpiar, validar consentimiento y normalizar teléfonos/patentes.

### 2.5 Publicar la Web App

1. En Apps Script: **Deploy → New deployment → Web app**.
2. Ejecutar como: propietario de la cuenta del taller.
3. Quién tiene acceso: **Anyone / Cualquiera** cuando la política del Workspace lo permita. El endpoint debe ser alcanzable por Vercel; las operaciones siguen verificadas con HMAC. Si la organización impide “Anyone”, esta arquitectura no puede recibir la API pública y se necesita una alternativa corporativa.
4. Desplegar y copiar la URL que termina en `/exec`.
5. Probarla sólo mediante el gateway una vez configurado. `doPost` valida HMAC y no es una API pública de uso directo.

Cada cambio posterior: **Deploy → Manage deployments → Edit → New version → Deploy**. Conservar el mismo `/exec` si se edita la implementación existente; si se crea otra, actualizar `GAS_URL`.

## 3. Preparar Cloudflare Turnstile

1. Crear un widget Turnstile para el hostname exacto de producción, por ejemplo `taller.ejemplo.com` o `mi-taller.vercel.app`.
2. Copiar **Site key** y **Secret key** por canal seguro.
3. La `Site key` se publica como `VITE_TURNSTILE_SITE_KEY`; la `Secret key` se guarda como `TURNSTILE_SECRET_KEY` en Vercel, nunca en Vite/frontend.
4. La API revisa que `hostname` coincida con `APP_ORIGIN` y que la acción verificada sea `login`, `book` o `waitlist` según corresponda.
5. Turnstile es obligatorio para admin y las acciones públicas que mutan datos. Sin la variable secreta, la API falla cerrada.

## 4. Contraseña administrativa

Generar el hash scrypt localmente. No registrar la contraseña en Git ni en un parámetro de URL/comando visible:

```bash
cd tallerflow
read -rsp "Contraseña admin (12+ caracteres): " TF_PASSWORD; echo
export TF_PASSWORD
node scripts/password.mjs
unset TF_PASSWORD
```

Guardar la única línea `salt:hash` en la variable `ADMIN_PASSWORD_HASH` de Vercel. Recomendación: frase larga y única (12 caracteres como mínimo; preferible 16+), gestor de contraseñas y proceso documentado para rotación. El frontend nunca recibe el hash.

## 5. Configurar Vercel

Importar el repositorio a Vercel. Si el proyecto entero fue subido como repo, raíz `.`; si el monorepo contiene una carpeta `tallerflow`, usar esa carpeta como Root Directory.

| Variable de entorno de Vercel | Requerida | Valor |
|---|---:|---|
| `VITE_DEMO_MODE` | Sí | `false` en producción; se incorpora al build |
| `APP_ORIGIN` | Sí | Origen exacto, ej. `https://mi-taller.vercel.app`, **sin barra final** |
| `GAS_URL` | Sí | URL `/exec` desplegada de Apps Script |
| `GAS_SECRET` | Sí | Mismo secreto aleatorio de Script Properties |
| `SESSION_SECRET` | Sí | Segundo secreto aleatorio independiente |
| `ADMIN_PASSWORD_HASH` | Sí | Valor scrypt del paso anterior |
| `VITE_TURNSTILE_SITE_KEY` | Sí | Site key pública del widget |
| `TURNSTILE_SECRET_KEY` | Sí | Secret key del widget, sólo server-side |

El archivo `.env.example` es una plantilla; duplicarlo como `.env.local` para experimentar pero **no poner secretos en `VITE_*`**. En Vercel configurar las variables para **Production** y volver a desplegar luego de cada cambio. El gateway requiere HTTPS por la cookie `Secure`.

`Origin` se compara exacto. Previews `*.vercel.app` o dominios alternativos no autorizados serán rechazados por el gateway. No copiar secretos de producción a Preview/Development; dejar el modo demo en esas ramas o preparar una configuración separada explícita.

**Dominio personalizado:** añadirlo en Vercel, incorporarlo al hostname del widget Turnstile, ajustar `APP_ORIGIN` exactamente y hacer un nuevo build/deploy. Sólo se permite un origen en este MVP.

## 6. Personalizar taller y servicios

Tras `setup()`:

- En pestaña `config`, editar el JSON almacenado en `value` (columna B). Ejemplo orientativo:

```json
{"name":"Taller Ejemplo","phone":"54911XXXXXXXX","address":"Av. Ejemplo 123, Buenos Aires","timezone":"America/Argentina/Buenos_Aires","open":9,"close":18,"weekdays":[1,2,3,4,5],"slotMinutes":30,"horizon":60,"capacity":1}
```

- Cambiar `services` manteniendo columnas y `id` estable. `duration` es entero de minutos; `price` es número entero en ARS; `icon` debe corresponder a los nombres soportados por la UI o cae a icono genérico.
- Precios de demo no son una oferta real. Aclarar al cliente la inspección/presupuesto definitivo.
- El constructor de slots asume Buenos Aires UTC−03. No cambiar zona/horarios/capacidad sin revisar citas activas, eventos de Calendar y compromisos acordados.
- Configurar el número `phone` sin `+`/separadores, formato internacional para wa.me. El prefijo de Argentina es `54`; verificar el formato de WhatsApp Business del taller.

## 7. Verificación de producción antes de abrir al público

1. `npm test` y `npm run build` terminan sin errores.
2. Landing muestra nombre, dirección, número, servicio, precio y horario correctos.
3. El panel permite login con Turnstile y rechaza contraseña incorrecta.
4. Un día hábil produce slots reales; una reserva crea una sola solicitud y bloquea el horario.
5. Repetir la misma solicitud conserva la referencia. Probar dos ventanas solicitando el mismo slot: una gana, la otra debe ver error comprensible.
6. Una reserva pendiente no crea evento de Calendar; confirmar crea/reconcilia el evento en máximo ~15 min; cancelar/finalizar lo borra.
7. Probar cliente con consentimiento y cliente sin consentimiento; sólo el primero ve comunicaciones en la cola.
8. Finalizar turno prueba historial/seguimiento. Probar cancelación futura con un interesado, y confirmar que el mensaje dice que el hueco no está reservado.
9. Confirmar que los enlaces abren el número real; no pulsar **Enviado** si no se envió.
10. `health()` y **Executions** no muestran `LAST_ERROR`. Verificar trigger, digest si configurado y restauración de copia de Sheet.
11. Conservar captura de configuración y procedimiento de incidente sin exponer secretos/datos personales.

Hacer primero estos ejercicios con una Sheet, Apps Script y dominio de prueba. Mantener pagos/diagnósticos/clientes reales fuera de la demo.

## 8. Operación y actualización

- Revisar la cola al menos al inicio y cierre de jornada.
- Revisar ejecuciones de Apps Script cuando Calendar o digest estén atascados; ejecutar `health()` para ver último run/error y volumen.
- Actualizar frontend: commit → Vercel deploy.
- Actualizar dominio compartido: `npm run google:build`, copiar `Domain.gs`, actualizar/deploy nueva versión Apps Script.
- Cambiar secreto HMAC de forma coordinada: primero tener ventana de mantenimiento; actualizar Script Properties y Vercel sin dejar tiempos largos con claves distintas, probar, revisar logs.
- Desactivar en Vercel o rotar sesiones tras sospecha de contraseña expuesta; si se filtra `SESSION_SECRET`, cambiarlo invalida todas las cookies activas.
- Antes de cambios de esquema, exportar Sheet y probar migración/restauración en una copia.
