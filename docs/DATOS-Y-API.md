# Modelo de datos y contrato operativo

## 1. Reglas de persistencia

- Todas las fechas serializadas se guardan como ISO-8601 UTC; la interpretación de turnos se hace con `America/Argentina/Buenos_Aires` (UTC−03).
- Teléfono se guarda como texto de dígitos con código de país, sin `+` ni separadores. No se verifica por SMS.
- Patente se normaliza a mayúsculas, sin espacios, guiones ni puntuación.
- Los IDs son identificadores de aplicación; no exponen una secuencia de Sheets.
- En Google, una pestaña por entidad, fila 1 como encabezado. No renombrar pestañas ni cambiar encabezados sin una migración coordinada.
- No se borra un cliente cuando revoca permiso. La revocación anula su cola pendiente, no borra el historial ni la obligación de administrar/eliminar sus datos según corresponda.

## 2. Entidades y relaciones

```text
clients 1 ───── N vehicles 1 ───── N history
   │                  │                 │
   │                  └──── N appointments ─── 1 services
   ├──── N appointments
   ├──── N messages (outbox)
   └──── N waitlist entries
```

### `clients`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK, p. ej. `tf_…` |
| `name` | string | Obligatorio en reserva y lista; máximo 80 caracteres |
| `phone` | string | Único por cliente normalizado en el proceso de reserva; 10–15 dígitos |
| `consent` | boolean | Permite generar/abrir mensajes de WhatsApp de la cola |
| `consentAt` | ISO string | Momento de la última decisión registrada |
| `createdAt` | ISO string | Alta inicial |

La UI muestra “Autorizados / No autorizados”. La casilla del formulario público es voluntaria para reservas y obligatoria para lista de espera. Sin autorización se puede pedir un turno, pero no se generan mensajes automáticos; al final se ofrece enlace para contactar al taller con la referencia. Revalidar y documentar el texto legal antes de producción.

### `vehicles`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK |
| `clientId` | string | FK a `clients.id` |
| `brand`, `model` | string | Obligatorios al pedir turno; máximo 60 |
| `year` | integer | 1950 hasta año actual + 1 |
| `plate` | string | Patente argentina normalizada, única entre titulares |

Patrones admitidos: `ABC123` o `AB123CD`. Si una patente ya existe para otro cliente, la reserva se bloquea para evitar asociación equivocada. Para correcciones, validar identidad/titularidad fuera del sistema.

### `services`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | ID estable, usado en relaciones |
| `name`, `category`, `description` | string | Catálogo público |
| `duration` | integer | Minutos; se usa para calcular solapamientos |
| `price` | integer | Monto ilustrativo en ARS, no presupuesto final |
| `icon` | string | Nombre interno de icono frontend |

El catálogo demo trae cambio de aceite, frenos, distribución, diagnóstico, batería, aire acondicionado, alineación, balanceo, electricidad y revisión pre-viaje. Editar descripción/precio en Sheets no reescribe tarifas históricas; el historial referencia el `serviceId` actual.

### `appointments`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK interna |
| `requestId` | string | Clave idempotente generada al abrir formulario; 8–100 caracteres permitidos |
| `clientId`, `vehicleId`, `serviceId` | string | Relaciones |
| `time` | `HH:mm` | Hora local Buenos Aires, presentada en la UI |
| `start`, `end` | ISO string | Instantes absolutos para solapamiento/Calendar |
| `status` | enum | `requested`, `confirmed`, `completed`, `cancelled`, `no_show` |
| `notes` | string | Consulta inicial, máx. 500 caracteres |
| `createdAt` | ISO string | Momento de solicitud |
| `eventId` | string | ID de evento espejo en Google Calendar |
| `syncStatus` | enum | `none`, `pending`, `synced`, `error` (demo además usa `demo`) |

La fecha local se deriva de `start` al presentarla. Horario de atención inicial: lunes–viernes, 09:00–18:00, slots de inicio cada 30 min, capacidad 1 simultánea, hasta 60 días. `CONFIG` en dominio y pestaña `config` tienen que mantenerse alineados. Duración del servicio bloquea todos los inicios que se solapen con una solicitud/confirmación activa.

### `history`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK |
| `appointmentId` | string | Turno origen; puede estar vacío en migraciones |
| `clientId`, `vehicleId`, `serviceId` | string | Relaciones y búsqueda del último servicio |
| `date` | ISO string | Se crea al marcar turno como finalizado |
| `km` | integer o null | Manual, 0–3.000.000 |
| `notes` | string | Trabajo/recomendaciones, máx. 1.500 |

El historial es básico: todavía no lista repuestos como ítems, diagnóstico adjunto ni facturas.

### `messages` (outbox)

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK |
| `key` | string | Clave idempotente; única por evento en la lógica |
| `clientId` | string | Destinatario asociado |
| `kind` | string | `Solicitud`, `Confirmación`, `Recordatorio`, `Seguimiento`, `Recuperación 90 días`, `Recuperación 180 días`, `Cancelación`, `Hueco disponible` |
| `text` | string | Texto listo para WhatsApp |
| `appointmentId` | string | Relación opcional a turno |
| `status` | enum | `pending`, `opened`, `sent`, `void` |
| `createdAt`, `sentAt` | ISO string | Cola y confirmación manual |

`pending` es cola nueva. `opened` registra que se abrió el enlace de WhatsApp, no que se haya enviado. `sent` exige confirmación manual y hora; no existe confirmación automática de entrega. `void` ya no debe enviarse.

### `waitlist`

| Campo | Tipo | Regla / uso |
|---|---|---|
| `id` | string | PK |
| `clientId`, `serviceId` | string | Relaciones |
| `date` | `YYYY-MM-DD` | Día local solicitado, no un horario reservado |
| `status` | string | `active` o `closed` |
| `createdAt` | ISO string | Alta |

Sólo acepta días hábiles futuros, dentro del horizonte, con consentimiento expreso y sin slots libres para ese servicio. La notificación de cancelación incluye el horario concreto y no lo bloquea.

### `config`

Dos columnas `id`, `value`; una fila `main` cuyo `value` es JSON. Contiene nombre, teléfono, dirección, zona, horarios, slots, capacidad y horizonte. El código aplica zona Buenos Aires/UTC−03. No cambiar `timezone` sólo editando la celda.

### Pestañas de Google Sheets

`config`, `services`, `clients`, `vehicles`, `appointments`, `history`, `messages`, `waitlist`. El `setup()` crea hojas/cabeceras que falten; no hace borrados destructivos. La app protege sus propios writes bajo lock, pero Sheets sigue siendo una superficie sensible: proteger pestañas, restringir editores y no manipular estados a mano.

## 3. Transiciones del turno

```text
requested ──▶ confirmed ──▶ completed
    │              ├──────▶ cancelled
    │              └──────▶ no_show
    └─────────────────────▶ cancelled
```

No se permite retroceder de estado ni reabrir desde final/cancelado/no-show. Cancelar es la forma correcta de liberar un horario. Un cambio manual de estado directo en Sheets no dispara outbox, historial ni Calendar; usar el panel.

## 4. Acciones `/api`

Todas las acciones se transportan por `POST /api` con JSON `{ "action": "…", "payload": {…}, "challenge": "…" }`; sólo para acceso público y operaciones del panel. `challenge` es el token Turnstile (vacío sólo en demo). La respuesta normal es `{ "ok": true, "data": … }` o `{ "ok": false, "error": "…" }`.

| Acción | Público | Admin | Payload esencial | Efecto |
|---|---:|---:|---|---|
| `catalog` | Sí | Sí | — | Devuelve config/catálogo |
| `slots` | Sí | Sí | `date`, `serviceId` | Slots disponibles, sin mutar |
| `book` | Sí + Turnstile | Sí | request ID, contacto, vehículo, servicio, día, hora, consentimiento | Crea o devuelve cita idempotente; vuelve a validar slot |
| `waitlist` | Sí + Turnstile | Sí | nombre, teléfono, servicio, fecha, consentimiento `true` | Crea/retorna interés idempotente |
| `session` | Pre-sesión | Pre-sesión | — | Estado booleano de sesión admin |
| `login` | Pre-sesión + Turnstile | Pre-sesión | `password` | Emite cookie de sesión, 8 h |
| `logout` | Sí | Sí | — | Borra cookie |
| `snapshot` | No | Sí | — | Datos necesarios para panel |
| `transition` | No | Sí | `id`, `status`, opcional `km`, `notes` | Cambia estado e impacta historial/outbox |
| `message` | No | Sí | `id`, `status` (`opened`/`sent`) | Actualiza cola; comprueba consentimiento |
| `consent` | No | Sí | `id`, `consent: false` | Revoca y anula cola pendiente |
| `waitlistClose` | No | Sí | `id` | Cierra interés |
| `automate` | No | Sí | — | Ejecuta generación de mensajes; útil para operación manual |

La tabla indica permisos teóricos en código. `login`/`session` no se retransmiten a Google. En el gateway se usa una allowlist pública limitada a catálogo, slots, booking y waitlist. Las acciones internas requieren cookie verificada.

### Ejemplo de solicitud de turno (sin token real)

```json
{
  "action": "book",
  "payload": {
    "requestId": "tf_muestra_8caracteres",
    "name": "Andrea Martínez",
    "phone": "5491123456789",
    "brand": "Toyota",
    "model": "Corolla",
    "year": 2022,
    "plate": "AB123CD",
    "serviceId": "aceite",
    "date": "2026-10-05",
    "time": "09:00",
    "notes": "Ruido al arrancar",
    "consent": true
  },
  "challenge": "TOKEN_TURNSTILE_DE_UN_USO"
}
```

La respuesta pública expone referencia, estado y comienzo del turno; no devuelve lista de clientes ni tablas internas.

## 5. Reglas de duplicación y conflictos

- Mismo `requestId`: retornar mismo turno sin agregar una segunda fila (idempotencia de reserva).
- Mismo teléfono: reutilizar ficha de cliente y actualizar nombre/consentimiento; `consentAt` refleja la decisión más reciente.
- Patente asociada a otro cliente: rechazar, no fusionar fichas automáticamente.
- Misma combinación cliente/servicio/fecha en lista `active`: retornar el mismo registro.
- Clave de mensaje repetida: no insertar de nuevo.
- Slot ocupado: rechazar con error legible; el cliente elige otro.
- Mensajes pendientes/abiertos al cancelar, finalizar o marcar no-show: pasan a `void`, excepto el aviso nuevo de cancelación/hueco que se agrega después.

## 6. Tamaño, archivo y migraciones

`saveDb()` falla de forma explícita al superar 5.000 filas por pestaña. La escritura reescribe la representación operacional de todas las tablas en cada mutación; costo y latencia crecen con el histórico. Antes de acercarse al límite: exportar copia, definir política de archivo por período, probar restauración y luego migrar a una base relacional. No borrar filas “viejas” en Sheets sin entender las claves foráneas, la idempotencia y los conteos de clientes.
