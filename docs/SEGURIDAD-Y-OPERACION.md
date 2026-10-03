# Seguridad, privacidad y operación

## 1. Modelo de amenazas del MVP

Se protege frente a llamadas anónimas a operaciones de administración, manipulación simple de requests, origen web no autorizado, spam automatizado y doble reserva por carreras comunes. **No** es una plataforma multi-taller, entorno bancario ni sistema de seguridad auditado. El propietario sigue siendo responsable de cuentas, dispositivos, permisos, consentimiento, backups y atención.

### Controles incluidos

- **Gateway same-origin:** el navegador no recibe URL/secreto de Apps Script ni habla directo con Sheets.
- **Origen estricto:** cada POST requiere `Origin` idéntico a `APP_ORIGIN`; cookies SameSite Strict y HTTPS.
- **Turnstile server-side:** API verifica token, hostname y acción; login y mutaciones públicas fallan cerrados si falta secret.
- **Sesión admin:** hash scrypt en servidor; HMAC para cookie firmada, `HttpOnly`, `Secure`, `SameSite=Strict`, expiración 8 h; cierre borra la cookie.
- **Integridad del gateway:** envelope HMAC-SHA256, acción/rol/fecha/nonce; Apps Script comprueba firma, TTL ±120 s, nonce y allowlist.
- **Mutación serializada:** Script Lock en las operaciones que leen-modifican-escriben Sheets; lote de actualización de pestañas para una sola transacción de aplicación.
- **Validación de negocio:** longitud, tipo/formato de patente, teléfono, fecha, día laboral, horizonte, estado, kilometraje, duración y slot disponibles se revisan en el dominio central.
- **Límite público:** máximo 12 intentos de book/waitlist por teléfono/día de operación en cache del script, y máximo tres citas activas por teléfono/cliente (con excepción de reintento idempotente). Turnstile complementa, no reemplaza controles antifraude.
- **Consentimiento antes de outbox:** sin consentimiento no se genera mensaje; revocar invalida mensajes pendientes/abiertos.
- **Escritura de texto:** las celdas se envían como valores string, no como fórmulas de Sheet.
- **No hay secreto en bundle:** `VITE_*` sólo debe contener valores públicos (Site key y flag demo). Contraseñas/keys tienen nombres server-only.

### Controles operativos que faltan

No hay MFA, administración de usuarios/roles, auditoría inmutable, alertas de abuso, límite por IP, rotación automática, backup programado, recuperación point-in-time, interfaz de eliminación completa/exportación, verificación de teléfono ni pruebas de intrusión externas. Mantener acceso de edición de Google restringido y la cuenta protegida con MFA. No reutilizar contraseña de Google como contraseña del panel.

## 2. Datos personales y mínimo necesario

Se guardan nombre, teléfono, marca/modelo/año/patente, notas cortas de visita, preferencias de mensajes y trazas de estado. No se deben solicitar DNI, dirección residencial, datos de pago ni información que no necesita el taller.

- **Sheets:** protege cada hoja a nivel de cuenta/permisos; evita enlaces públicos, editores amplios y descargas a dispositivos personales.
- **Calendar:** título usa servicio y patente; descripción puede incluir nombre y vehículo. Es información identificable; usar calendario privado y personal autorizado, no un calendario público.
- **Vercel:** no habilitar logs de request body, no poner datos del cliente en parámetros de URL y revisar retención de logs del proveedor.
- **WhatsApp:** el link contiene el texto generado y se abre en la cuenta del taller. El operador debe revisar el chat correcto antes de enviar.
- **Demo:** usa ejemplos ficticios persistidos en el navegador. No copiar bases reales para “probar”.
- **Derechos/retención:** definir con asesoría local el aviso, fundamento/consentimiento, plazo de retención, procedimiento de acceso/corrección/eliminación y responsable. Este documento no reemplaza asesoría jurídica ni un aviso de privacidad.

La pestaña `clients` no implementa un borrado integral. Para una baja o solicitud de eliminación, el responsable debe verificar obligaciones de conservación, localizar referencias, respaldar lo imprescindible cuando sea lícito, anonimizar/eliminar coordinando todas las tablas y revisar copias/caches. No borrar sólo la fila del cliente: puede dejar historiales, turnos y mensajes huérfanos. Planear una acción de privacidad segura antes de escalar.

## 3. Secretos y sesiones

- Mantener `GAS_SECRET`, `SESSION_SECRET`, contraseña de admin, Turnstile secret y token Telegram en el gestor de secretos del proveedor correspondiente.
- `GAS_SECRET` vive en Script Properties + Vercel server-side. No se muestra en el panel.
- `SESSION_SECRET` sólo en Vercel; cambiarlo invalida sesiones del panel.
- `ADMIN_PASSWORD_HASH` contiene salt y hash scrypt; no contraseña en claro. La contraseña se transfiere por TLS en login y no debe registrarse.
- `TURNSTILE_SECRET_KEY` sólo server-side; Site key es pública.
- `TELEGRAM_BOT_TOKEN` sólo en Script Properties. Quien edita el Apps Script puede leer el secreto.
- Usar permisos mínimos y una cuenta Google del negocio; separar personal de producción si se puede.
- Las URL de Apps Script terminan en `/exec`; aunque sean visibles no bastan para invocar lógica válida sin el secreto firmado. Mantener versión de código protegida.

## 4. Riesgos y comportamiento ante incidentes

| Riesgo | Respuesta actual | Acción del operador |
|---|---|---|
| Reserva duplicada/dos clientes eligen mismo slot | lock + revalidación + idempotencia | Revisar agenda; cliente perdedor elige nuevo slot |
| Apps Script/Sheets indisponible | operación falla; no se debe confirmar éxito | Aviso manual, revisar Google Status/Executions; reintentar mismo requestId |
| Vercel timeout después de guardar | cliente recibe timeout; requestId hace retry idempotente | Reenviar el mismo formulario sin regenerar referencia |
| Error Calendar | cita queda guardada y `syncStatus=error`; retry periódico | Revisar permiso/ID del calendar, ejecutar `syncCalendar` luego de resolver |
| Mensaje enviado pero panel no actualizado | fila puede seguir `opened/pending`; no hay ACK del proveedor | Marcar enviado sólo después de revisar conversación; evitar reenviar sin verificar historial |
| Token/password/secreto expuesto | no hay respuesta automática | Rotar el secreto afectado, revisar historial, invalidad sesiones si `SESSION_SECRET`, actualizar deployment y propiedades, investigar accesos |
| Cliente revoca permiso | pendientes/abiertos se anulan | No enviar manualmente; confirmar pedido y respetar la revocación |
| Datos erróneos en patente/auto | búsqueda y bloqueo de patente ajena; no verificación civil | Corregir con el cliente; no reasignar patente sin verificar |
| Trigger detenido | queda última ejecución/error y cola acumulada | revisar trigger y Executions, reparar y comprobar idempotencia al reejecutar |

## 5. Copias y recuperación recomendada

**No se crea un backup automático en este MVP.** Antes de operar:

1. Designar responsable y frecuencia de copia (al menos diaria si hay actividad; conservar copias fuera de la cuenta operacional con acceso restringido).
2. Usar exportación/copia de Spreadsheet versionada; documentar fecha, propietario y destino de cada backup.
3. Probar restauración en una Sheet separada, nunca sobre producción sin revisión.
4. Verificar que las ocho pestañas y encabezados coincidan; validar cantidad de turnos/clientes, claves, fechas y permisos.
5. Definir RPO/RTO realistas para el taller; una copia manual diaria implica posible pérdida de actividad posterior a la copia.
6. No enviar exportaciones con PII por chat público/email sin protección.

## 6. Checklist operativo diario

- [ ] Abre el panel desde el dominio correcto y sesión HTTPS.
- [ ] Revisa solicitudes `requested` y confirma o contacta para aclarar.
- [ ] Revisa cola `pending`/`opened`; respeta permiso; confirma sólo envíos hechos.
- [ ] Revisa agenda de hoy y capacidad real del taller/equipamiento.
- [ ] Finaliza turnos ya realizados y registra kilometraje/notas sólo con información verificada.
- [ ] Cierra lista de espera obsoleta.
- [ ] Revisa digest, `health()`/`LAST_RUN`, `LAST_ERROR` y errores de Apps Script.
- [ ] Verifica la copia según política.

## 7. Capacidad y límites de seguridad

- Apps Script/Sheets tienen cuotas y latencia variable. Cada mutación lee y reescribe los datos operacionales, con guardia de 5.000 filas por tabla. Es un MVP para un solo taller y volumen bajo.
- El lock es global por proyecto Apps Script y puede hacer que operaciones lentas esperen. Evitar ejecutar tareas manuales pesadas durante horas pico.
- El límite por teléfono se guarda en CacheService, no es un rate limiter durable. Un reinicio/expiración de cache puede reiniciar contadores.
- El sitio y datos aún no son multi-tenant; no desplegar una copia compartida entre talleres con secretos/Sheets comunes.
- Bloqueo de CORS/origen no equivale a autorización de usuario. La sesión de administrador sí debe mantenerse firmada.
- El modelo usa un permiso de mensajes global; no sustituye un registro de finalidad/versión del aviso ni opt-outs específicos de cada canal.
