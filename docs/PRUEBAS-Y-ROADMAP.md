# Pruebas, aceptación y evolución

## 1. Ejecutar validaciones

Desde la carpeta `tallerflow`:

```bash
npm test
npm run build
npm run google:build
```

`npm test` usa el test runner nativo de Node (`node:test`); no depende de servicios externos ni accede a personas reales. La suite valida reglas del dominio, no la configuración de una cuenta Google/Vercel.

## 2. Cobertura unitaria incluida

- Formato de teléfono internacional y patentes argentinas.
- Días hábiles, horarios y horizonte de disponibilidad.
- Idempotencia del `requestId`, bloqueo de slots y solapamientos por duración.
- Datos inválidos, teléfono y año fuera de rango.
- Reserva sin consentimiento y ausencia de outbox.
- Transiciones autorizadas, finalización, kilometraje e historial.
- Cancelación, slot liberado y aviso a cliente activo de lista de espera.
- Umbrales 90/180 días, idempotencia y restricción por consentimiento/turno futuro.
- Recordatorio de 24 h y no duplicación.
- Revocación de permiso y cancelación de mensajes abiertos/pendientes.
- Validaciones de lista de espera (consentimiento, calendario y falta de slots).
- Matriz de acciones públicas/admin.

No hay todavía navegador de integración automatizado, pruebas con Turnstile real, mocks de Google Sheets/Calendar ni prueba de restauración. Completar el checklist manual de `DESPLIEGUE.md` antes de clientes.

## 3. Criterios de aceptación funcionales

### Página pública

- [ ] Móvil y escritorio muestran contenido legible y CTA visible.
- [ ] El catálogo filtra categorías; la reserva conserva el servicio seleccionado.
- [ ] Turnos sólo se ofrecen en día/hora/capacidad/duración válidos.
- [ ] Revisión de teléfono, patente, año, nombre y caracteres máximos.
- [ ] Consentimiento no viene preseleccionado.
- [ ] Doble click/reintento no genera dos turnos.
- [ ] El usuario entiende que la solicitud no está confirmada.
- [ ] Sin slots, lista de espera exige permiso y no reserva hora.

### Panel

- [ ] Una persona sin sesión no puede ver `snapshot` ni modificar turnos.
- [ ] Solicitud puede confirmarse/cancelarse; cada cambio genera efectos correctos.
- [ ] Finalizar crea historial una sola vez y mensaje de seguimiento si corresponde.
- [ ] Revocar permiso anula cola y bloquea posteriores comunicaciones.
- [ ] Buscar identifica cliente por nombre, teléfono o patente.
- [ ] `opened` y `sent` aparecen diferenciados.
- [ ] Cancelar libera slot, y hueco ofrece sólo a clientes del servicio/fecha elegidos.

### Integraciones y continuidad

- [ ] Apps Script sólo acepta HMAC/nonce válido y rechaza fecha expirada.
- [ ] Turnstile bloquea token inválido/hostname equivocado/acción equivocada.
- [ ] Hoja protege datos, trigger cada 15 min activo y `LAST_RUN` reciente.
- [ ] Calendar se sincroniza una vez por cita, recupera errores y elimina eventos al terminar/cancelar/no-show.
- [ ] No se filtran credenciales en fuentes, bundle público o logs.
- [ ] Backup restaurado en copia con datos consistentes.

## 4. Pruebas manuales de regresión

1. Hacer una consulta por WhatsApp y confirmar que el enlace abre el número esperado.
2. Reservar un servicio de 60 min, confirmarlo y probar solapamiento 09:00–09:30; no debe ofrecer el inicio superpuesto.
3. Reintentar con el mismo ID después de simular un timeout; debe conservar la referencia.
4. Intentar misma patente desde otro teléfono; se rechaza sin alterar fichas.
5. Crear reserva sin permiso y verificar que no aparece su mensaje en la cola.
6. Crear cliente con permiso, confirmar, esperar o forzar una ejecución cerca de 24 h; comprobar que el mensaje no duplica.
7. Completar trabajo, revisar historial, kilometraje y `Seguimiento`.
8. Con cliente inactivo, ejecutar `automate` con una fecha fija/prueba para validar 90/180; confirmar que no existe doble mensaje.
9. Cancelar cita futura con lista coincidente; confirmar que el aviso incluye fecha/hora y no bloquea slot.
10. Simular Calendar sin permiso, corregir permiso y comprobar reconciliación sin duplicados.
11. Revocar consentimiento, mantener mensajes viejos y verificar que no se puede abrir/enviar desde el panel.

Para operaciones de Calendar/scheduler, usar inicialmente un calendario de prueba y una hoja de prueba; no alterar datos de un taller real para fabricar condiciones de 24/90/180 días.

## 5. Riesgos MVP conocidos

- Autenticación de un solo usuario/contraseña, sin MFA ni perfiles por empleado.
- Sin historial de auditoría de cada edición ni actor en la fila.
- Sheets/Apps Script pueden llegar a límites/cuotas y no garantizan alta concurrencia.
- No hay confirmación de entrega WhatsApp, recepción de respuesta ni cancelación entrante sincronizada.
- El cliente no puede ver/modificar su turno en autoservicio; reprogramar crea nueva solicitud tras intervención manual.
- Tarifas y disponibilidad son reglas simples; no incluyen feriados, almuerzos, bahías distintas, mecánico/calificación, repuestos, trabajos simultáneos por vehículo ni estimación basada en diagnóstico.
- Teléfono y titularidad no se verifican; no se crea perfil de usuario del cliente.
- La base carece de deduplicación inteligente por nombre y placa histórica; la placa se considera única.
- No se aplica caducidad automática a waitlist ni borrado de PII.
- Digest es diario, sin seguimiento de entrega a propietario.

## 6. Roadmap recomendado por prioridad

### Antes de clientes reales (P0)

1. Configurar dominio, número, servicio, precios y horario real.
2. Validar aviso de privacidad/consentimiento y proceso para revocación, acceso, corrección y eliminación.
3. Activar Turnstile y probar sus acciones/hostname.
4. Proteger Sheet/Calendar/Apps Script con MFA y mínimos permisos.
5. Habilitar copia y prueba de restauración.
6. Prueba de extremo a extremo con clientes de prueba y teléfono no real.
7. Definir quién revisa cola/agenda y tiempos de respuesta.

### Estabilización (P1)

1. Separar consentimiento de mensajes operativos del permiso de marketing/recuperación.
2. Añadir reprogramación en panel, búsqueda avanzada, auditoría, exportación/anonimización/borrado de datos.
3. Añadir autenticación por usuario/MFA y límites de login/IP.
4. Dashboard de ejecuciones, fallos de sincronización y alertas de antigüedad de cola.
5. Políticas de retención y expiración de lista de espera.
6. Test de integración de Apps Script y Vercel con contratos/mocks.

### Escala (P2)

1. Migrar a PostgreSQL u otra base con transacciones, migraciones, backups y observabilidad.
2. Separar horarios por bahía/técnico y reglas por recursos/servicios.
3. Integrar API oficial de WhatsApp Business, webhooks, plantillas aprobadas y estados reales.
4. Implementar multi-taller/roles/aislamiento, auditoría y administración de sedes.
5. Agregar presupuestos, órdenes de trabajo, repuestos, pagos, informes y portal del cliente después de definir su modelo.
6. Considerar IA sólo para tareas auxiliares con autorización y revisión humana; nunca para diagnosticar/recomendar seguridad mecánica sin control del profesional.
