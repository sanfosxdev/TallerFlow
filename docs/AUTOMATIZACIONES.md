# Automatizaciones y reglas de comunicación

## Principio operativo

Las automatizaciones **preparan trabajo, no envían WhatsApp a los clientes**. Generan filas `pending` en `messages`. Una persona autorizada revisa el texto, abre WhatsApp Business y envía. Después marca **Enviado**. `opened` sólo significa que la persona abrió el enlace.

Este diseño permite validar destinatario, fecha, tono y consentimiento sin plantillas WhatsApp, costos por conversación ni envío accidental. Si se incorpora WhatsApp API en una etapa futura, se necesita canal oficial, webhook/estados, plantillas aplicables, opt-out y configuración separada; nunca convertir `pending` en envío implícito.

## Tabla de reglas

| Evento/regla | Condición | Mensaje generado | Clave idempotente | Quién actúa |
|---|---|---|---|---|
| Pedido público | Solicitud nueva y `consent=true` | Recibimos solicitud; indica fecha/hora y pendiente de confirmación | `request:<appointmentId>` | Operador revisa/acepta/cancela |
| Confirmación | Transición `requested → confirmed`, con consentimiento | Servicio, fecha, hora, expectativa de asistencia | `confirm:<appointmentId>` | Envío manual |
| Recordatorio ~24 h | Cita confirmada entre 0 y 25 h desde corrida y consentimiento | Fecha, hora y cómo reprogramar | `rem24:<appointmentId>` | Trigger cada 15 min; envío manual |
| Seguimiento | Transición a `completed`, con consentimiento | Consulta breve sobre el trabajo recién realizado | `follow:<appointmentId>` | Envío manual |
| Inactividad 90 días | Última visita entre 90 y 179 días, sin turno futuro y consentimiento | Invitación a coordinar revisión | `rec90:<clientId>:<historyId>` | Trigger cada 15 min; envío manual |
| Inactividad 180 días | Última visita con 180+ días, sin turno futuro y consentimiento | Recuperación 180; reemplaza la categoría 90 | `rec180:<clientId>:<historyId>` | Trigger cada 15 min; envío manual |
| Cancelación | Estado pasa a cancelado | Aviso al cliente que tenía el turno | `cancel:<appointmentId>` | Envío manual |
| Hueco futuro | Cancelación futura + lista activa exacta de servicio y día | Hora que se liberó; aclara que no está reservada | `gap:<appointmentId>:<waitlistId>` | Envío a cada interesado elegible; revisión manual |

### Qué significa consentimiento en este MVP

- `consent` es una marca general para generar mensajes del producto. Reservar sin marcar es posible, pero no se programa solicitud, confirmación, recordatorio, seguimiento ni recuperación automática.
- La lista de espera exige marcar consentimiento porque su propósito es recibir avisos de huecos.
- Al revocar, los mensajes `pending`/`opened` pasan a `void`; historial y turnos no se borran.
- Si no hay consentimiento, el panel no muestra enlace operativo para enviar mensaje de la cola. El cliente aún puede iniciar una conversación desde el enlace general de WhatsApp o consultar usando su referencia.
- Antes de una operación real, revisar con asesoría local si el texto/canal/alcance de la casilla y el registro de revocación satisfacen los requisitos aplicables. Para comunicaciones transaccionales y marketing puede convenir consentimiento separado, trazable por finalidad.

## Ciclo de vida de un mensaje

```text
Evento de negocio
      │ consentimiento = true
      ▼
  pending ── operador abre wa.me ──▶ opened
      │                                  │
      ├── deja sin enviar                 ├── envío manual comprobado
      │                                  ▼
      └── se revoca/cancela/termina       sent
                    │                     │
                    └───────────────▶ void
```

No existe respuesta de entrega/lectura. No añadir checkmark visual de “entregado” basado en `sentAt`.

## Ejecución del scheduler

`setup()` instala un único trigger de Apps Script `scheduledRun` cada 15 minutos. Una corrida realiza:

1. `automate(db)` dentro de una lectura/escritura protegida por Script Lock.
2. Guarda nuevas filas de la outbox en lote.
3. `syncCalendar()` procesa hasta 20 sincronizaciones pendientes/con error (si hay `CALENDAR_ID`).
4. `notifyQueue()` envía como máximo un digest interno por día si hay mensajes pendientes y hay correo y/o Telegram configurados.
5. Escribe `LAST_RUN`; ante error escribe `LAST_ERROR` en Script Properties.

Google determina el horario real de los triggers; pueden ejecutarse algunos minutos más tarde o de manera no puntual. El sistema calcula la ventana de recordatorio para tolerarlo. La fecha de corte de recuperación se mide en días de 24 h respecto a la última fila de historial, no como aniversario calendario.

## Resumen interno por Gmail/Telegram

- Se cuentan todos los mensajes `pending` que esperan atención manual.
- El digest contiene el conteo y el enlace al dashboard (`DASHBOARD_URL`), no números de teléfono ni cuerpos del mensaje.
- Gmail (`NOTIFY_EMAIL`) y Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) son opcionales.
- El token de Telegram vive en Script Properties; restringir acceso a editores del Apps Script.
- `DIGEST_DATE` evita mensajes repetidos en el mismo día local del script. Si no hay integración configurada, la cola sigue disponible pero no llega el digest.
- Las fallas se ven en `LAST_ERROR`, ejecución de Apps Script y `health()`.

## Qué se hace manualmente en el panel

1. Confirmar cada solicitud tras verificar capacidad, elevador, recursos y consulta.
2. Abrir el mensaje, revisar nombre/fecha/texto y enviar desde la cuenta correcta.
3. Marcar **Enviado** únicamente después de enviar.
4. Si el cliente pide cancelar o reprogramar, cambiar estado en agenda. El slot viejo se libera; la nueva fecha se registra con una solicitud nueva.
5. Al acabar el trabajo, pulsar Finalizar y cargar kilómetros/recomendación si el cliente la informó.
6. Cerrar lista de espera obsoleta y revocar permiso cuando el cliente lo pida.
7. Revisar la pestaña de Mensajes varias veces por jornada, no confiar sólo en el digest.

## Idempotencia, reintentos y fallas

- Las claves de evento evitan insertar dos veces el mismo mensaje en ejecuciones normales.
- Las reservas aceptan `requestId` y lo consultan antes de reservar. Repetir el envío del mismo formulario devuelve la reserva existente.
- Los locks serializan mutaciones para no sobreasignar el único puesto.
- Si Vercel expira esperando Apps Script, el cliente puede reintentar; mantener `requestId` original.
- Si Calendar falla, el turno permanece guardado y el trigger reintenta.
- Si Sheets falla, la operación debe fallar cerrada; no confirmar al cliente hasta obtener éxito.
- Si Gmail/Telegram falla, revisar las ejecuciones, conservar la cola en Sheets y reintentar cuando el proveedor vuelva.
- No hay bandeja automática de dead-letter ni notificación al cliente de error técnico en este MVP. El responsable debe comprobar logs/`LAST_ERROR`.

## Contenido de los textos

Los mensajes se generan en `src/domain.mjs` y usan tono directo en español rioplatense. Revisarlos antes de conectar producción. No incluir datos sensibles, diagnóstico detallado, fotos, información financiera ni códigos secretos en el cuerpo de un WhatsApp. Para precios/repuestos, usar conversación o presupuesto separado.
