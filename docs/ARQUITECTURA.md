# Arquitectura e interacciones — TallerFlow

## 1. Propósito y alcance

MVP para un taller mecánico pequeño: capturar consultas/solicitudes, convertirlas en turnos con capacidad limitada, conservar una ficha mínima del cliente y del auto, ordenar comunicaciones y recuperar clientes con consentimiento.

La arquitectura prioriza bajo costo y pocos sistemas que mantener. React/Vite sirve la experiencia pública y la privada; una API same-origin de Vercel protege operaciones; Apps Script centraliza reglas, locks y procesos programados; Google Sheets es la fuente de verdad. No se integró un proveedor de WhatsApp Business API, CRM, pagos, inventario ni contabilidad.

## 2. Diagrama de contexto

```text
┌─────────────────────┐               ┌──────────────────┐
│ Cliente / navegador │──────────────▶│ Landing y panel  │
└─────────┬───────────┘               │ React + Vite     │
          │ WhatsApp manual           └────────┬─────────┘
          ▼                                     │ POST /api
┌─────────────────────┐                         ▼
│ WhatsApp Business   │                ┌──────────────────┐
│ aplicación del taller│               │ API Vercel       │
└─────────────────────┘                │ auth + Turnstile │
                                       │ firma HMAC       │
                                       └────────┬─────────┘
                                                │ sobre firmado
                                                ▼
                                       ┌──────────────────┐
                                       │ Apps Script      │
                                       │ allowlist + lock │
                                       └──┬──────┬────┬───┘
                                          │      │    │
                               fuente ┌───▼──┐ ┌─▼────▼────┐
                               verdad │Sheets│ │Calendar   │
                                      └──────┘ │Gmail/Telegram│
                                               └─────────────┘
```

### Componentes

| Componente | Responsabilidad | No hace |
|---|---|---|
| `src/main.jsx` | Landing, reserva, login, panel y acciones humanas | No mantiene un backend confiable en producción |
| `src/domain.mjs` | Validación, disponibilidad, transiciones, mensajes y automatizaciones | No llama a proveedores |
| `src/client.mjs` | Selecciona modo demo o API | No contiene secretos |
| `api/index.js` | Valida origen, sesión, Turnstile; firma solicitud y reenvía | No lee Sheets directo |
| `google/Domain.gs` | Copia generada del dominio compartido | No editar manualmente |
| `google/Backend.gs` | HMAC, acceso, lock, lecturas/escrituras, Calendar, trigger y digest | No envía WhatsApp a clientes |
| Google Sheets | Base operacional pequeña, administrable por el taller | No es una base multi-tenant de alto volumen |
| Google Calendar | Espejo opcional de turnos confirmados | No determina disponibilidad |
| WhatsApp Business | Mensajes que envía una persona desde el dispositivo/cuenta del taller | No automatiza envíos |
| Gmail/Telegram | Digest interno de pendientes, opcional | No se usan como canal de clientes |

## 3. Sistemas y flujos de extremo a extremo

### A. Consulta informativa

```text
Cliente → landing/catálogo → WhatsApp (wa.me) → operador
```

El enlace abre la app de WhatsApp en el teléfono del operador/cliente según dispositivo. La web no recibe esa conversación, no la archiva y no confirma la lectura. El teléfono de demo es ficticio.

### B. Solicitud de turno

```text
Cliente
  → elige servicio y día
  → POST /api con acción slots
  → Apps Script lee Sheets y calcula capacidad/duración
  → elige slot, completa contacto/auto y decide consentimiento
  → /api: Turnstile + firma HMAC
  → Apps Script, bajo lock: revalida slot y duplicados
  → guarda cliente, vehículo, solicitud y mensaje pendiente
  → recibe referencia y estado “requested / por confirmar”
  → operador confirma o cancela en el panel
```

**Importante:** la hora se vuelve a comprobar en el momento del guardado. Si dos personas eligen el mismo hueco, la primera que completa la solicitud lo obtiene y la otra recibe un mensaje de que el horario dejó de estar disponible. La reserva pública no confirma disponibilidad hasta la respuesta del servidor. La clave idempotente del formulario evita crear dos citas si se repite el mismo POST tras una demora.

### C. Confirmación y sincronización de agenda

```text
requested → confirmar por el operador → confirmed
   ├─ mensaje “Confirmación” queda pending en la outbox
   └─ Calendar syncStatus=pending → trigger cada 15 min → evento creado/actualizado
```

El operador abre la cola, revisa el texto y abre `wa.me`. Después de enviar desde WhatsApp, confirma **Enviado** en TallerFlow. Si se cancela/finaliza/no-show, mensajes pendientes asociados al turno se marcan `void`; la cancelación agrega su propio aviso si hay consentimiento. No se debe mover un evento a mano: la agenda operativa es el panel/Sheets y el sincronizador reconciliará el evento.

### D. Finalización, historial y seguimiento

```text
confirmed → operador Finalizar → km/notas opcionales
            ├─ historial del servicio en el vehículo
            └─ mensaje de seguimiento pending si hay consentimiento
```

El historial muestra servicio, fecha, kilometraje informado y observaciones. El kilometraje es manual, no proviene del vehículo.

### E. Recuperación

```text
historial más reciente → tarea cada 15 min
   ├─ 90–179 días → recuperación 90
   ├─ 180+ días    → recuperación 180 (no duplica también 90)
   ├─ sin consentimiento → no crear mensaje
   └─ con turno futuro/solicitado → no crear mensaje
```

La tarea agrega mensajes en una cola; no envía WhatsApp. La clave de outbox ligada a cliente y última visita evita duplicados en nuevas ejecuciones.

### F. Cancelación y hueco

```text
confirmed/requested → cancelar
   ├─ liberar slot inmediatamente en Sheets
   ├─ aviso de cancelación al cliente si autorizó
   └─ hueco futuro + cliente en lista activa del mismo servicio/fecha
       → crear aviso “Hueco disponible” para cada interesado autorizado
           → el interesado puede abrir el formulario y solicitar el slot
           → primero que complete la solicitud lo bloquea
```

La oferta no bloquea ni reserva el lugar. No se notifica un hueco pasado. El operador cierra manualmente registros obsoletos de la lista de espera.

### G. Calendario

- `requested`: bloquea disponibilidad en Sheets, aún no se agrega a Google Calendar.
- `confirmed`: se reconcilia en Calendar.
- `cancelled`, `completed` o `no_show`: el evento espejo se borra en la reconciliación.
- Error de Calendar: `syncStatus=error`, se reintenta en el próximo trigger y no revierte un turno guardado.
- Falta de `CALENDAR_ID`: citas confirmadas quedan marcadas pendientes; no es una configuración de producción completa.

## 4. Fuente de verdad y consistencia

**Google Sheets es autoridad** para agenda, clientes, consentimiento y cola. Se vuelve a calcular el slot justo antes de guardarlo, dentro de `LockService`. La escritura utiliza un `Sheets.Spreadsheets.batchUpdate` con todas las pestañas en un solo lote, después de validar la mutación. Se mantiene un límite defensivo de 5.000 filas por tabla.

Calendar, Gmail y Telegram son secundarios. No se escribe primero en Calendar para después inferir si el turno existe. Esta decisión reduce fallos de doble escritura, pero implica que una interrupción de Google Sheets bloquea el flujo de negocio.

El modo demo no comparte el backend: `localStorage` conserva una copia de demostración por navegador. Es útil para recorrer pantallas y reglas, no para simular concurrencia entre dispositivos.

## 5. Sesión y límites de confianza

- El usuario público puede consultar catálogo/slots y crear solicitudes/lista de espera. No puede acceder a `snapshot`, clientes, cola, transición, automatizaciones ni consentimiento.
- El acceso administrativo usa contraseña guardada como scrypt (`ADMIN_PASSWORD_HASH`), Turnstile en login y sesión HMAC de 8 h en cookie `Secure`, `HttpOnly`, `SameSite=Strict`.
- Vercel acepta llamadas POST sólo si `Origin` coincide exactamente con `APP_ORIGIN` y reenvía al Google Web App un sobre firmado con `GAS_SECRET` y marca temporal/nonce.
- Apps Script rechaza firma inválida, marca de tiempo con más de 120 s, nonce repetido y acción fuera de la allowlist.
- Turnstile se valida del lado servidor por acción y hostname para login/reserva/lista de espera.
- El origen del cliente no es un sistema de roles confiable. Google está configurado para ejecutar como propietario; mantener privado el secreto HMAC.

## 6. Stack y ambientes

| Ambiente | UI | Estado | Mensajería | Uso |
|---|---|---|---|---|
| Demo local / vista previa | Vite | `localStorage` | Ninguna real | Explorar y revisar UX |
| Producción inicial | Vercel | Sheets + Apps Script | WhatsApp manual, digest interno opcional | Taller real tras configurar secretos |
| Evolución | Vercel + backend/DB dedicado | PostgreSQL/Supabase u otro | WhatsApp Business API con consentimiento y plantillas | Sólo cuando el volumen lo justifique |

## 7. Evoluciones de arquitectura

1. Añadir `tenantId`, roles por usuario y separación entre talleres antes de ofrecer SaaS multi-taller.
2. Migrar a una base transaccional si se superan cuotas, tamaño o concurrencia de Sheets.
3. Usar proveedor oficial de WhatsApp Business API (webhooks, plantillas, opt-out) si se necesita envío desatendido.
4. Incorporar registro de auditoría (`actor`, acción, cambios, timestamp), backup automático y consola de fallos.
5. Crear pagos, inventario, cotizaciones, portal de cliente y análisis como sistemas separados, evitando meterlos en las reglas de agenda sin diseño.
