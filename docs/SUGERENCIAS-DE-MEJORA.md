# Sugerencias de mejora

Revisión del estado actual del repositorio (octubre 2026). Verificaciones realizadas antes de redactar:

```bash
npm test          # 11 pruebas, 0 fallos
npm run build     # OK: JS 288 kB (gzip 88 kB), CSS 27 kB (gzip 6.8 kB)
node --check api/index.js   # OK
```

La base es sólida: dominio puro compartido, HMAC + nonce + TTL, lock de Apps Script, batchUpdate atómico, consentimiento explícito e idempotencia por `requestId`/clave de mensaje. Las sugerencias siguientes están ordenadas por prioridad y son complementarias del roadmap de `PRUEBAS-Y-ROADMAP.md`; señalan puntos concretos observados en el código.

## P0 · Correctitud y datos

**1. Escritura completa incluso con tablas vacías (`google/Backend.gs`, `saveDb`).**
El rango de `updateCells` termina en `endColumnIndex=headers.length`: sólo se reescriben las filas nuevas. Si una operación borra o reduce filas (p. ej. archivar mensajes `sent`/`void`), quedan filas residuales fantasma. Antes de escalar cualquier limpieza, añadir `clearRange` por tabla o borrar/recrear dimensiones. Es un bug latente que impedirá features de retención/archivado.

**2. Feriados y días no laborables.**
`available()` y la waitlist sólo miran `config.weekdays`. Un turno puede tomarse en feriados nacionales (24/31 dic, etc.). Recomendación: lista configurable `holidays` en CONFIG (fuente única compartida demo/Google) o calendario de feriados Argentina; validar también en `dispatch('waitlist')`.

**3. Bloqueos no removidos / turnos vencidos en `requested`.**
Una solicitud `requested` bloquea el slot indefinidamente si nadie la gestiona. El digest avisa por mensajes pendientes, pero no por solicitudes vencidas. Añadir en `automate()`: expiración automática de `requested` cuyo `start` pasó (estado `expired`, clave idempotente) y avisos internos de antigüedad. Conserva la invariante 2 porque recién libera slots ya transcurridos.

**4. Consentimiento único para todo.**
Un solo flag habilita mensajes operativos (confirmación/recordatorio) y de marketing (recuperación 90/180 días). Separar en `consentOps` y `consentMarketing` con migración desde el flag actual; mejor posicionamiento ante normativa de protección de datos y menor fricción para el cliente.

**5. Acciones sensibles sin auditoría.**
`transition`, `consent` y `message` no registran quién/cuándo. Agregar tabla `audit` (append-only, sin reescritura) con timestamp, acción, id y rol. Barato en Sheets y clave ante disputas con clientes.

**6. Borrado/anonimización de PII inexistente.**
No hay acción de eliminación segura coordinada entre `clients/vehicles/appointments/history/messages/waitlist` (+ Calendar y cache de nonce). Sin esto, el ejercicio de derechos es manual y propenso a dejar huérfanos. Implementar `purgeClient(db, clientId)` con anonimización conservando integridad referencial.

## P1 · Seguridad y robustez del gateway/backend

**7. Límite de tasa de login.**
En `api/index.js`, Turnstile valida el token pero no hay límite de intentos por IP/origen: el scrypt mitiga fuerza bruta offline, pero permite denegación de servicio computacional. Sumar contador en headers `x-forwarded-for` (cache/Upstash/Ratelimit) con backoff.

**8. Sin verificación de origen real en el envelope.**
`req.headers.origin===APP_ORIGIN` es trivialmente falsificable desde fuera del navegador; lo que realmente protege es HMAC+TTL+nonce. Considerar firmar también una vista canónica del cuerpo y documentar explícitamente que el Origin es cosmético (el doc de seguridad ya lo insinúa; conviene alinearlo).

**9. Reintentos y visibilidad de errores GAS→Vercel.**
Si el fetch a `GAS_URL` falla o devuelve HTML (Apps Script suele responder 200 con contenido no JSON tras errores), `r.json()` lanza y el usuario ve "Unexpected token". Envolver con `text()` + parseo tolerante, reintento simple para acciones idempotentes (`slots`, `catalog`) y mapear errores conocidos a mensajes claros.

**10. Nonce en CacheService tiene TTL 600 s vs TS ±120 s.**
Correcto hoy, pero si se amplía el TTL de `ts`, el nonce debe cubrirlo. Extraer ambos a constantes relacionadas (`NONCE_TTL >= 2 * TS_WINDOW`) y probar la relación.

**11. `saveDb` reescribe todas las tablas en cada mutación.**
Con ~5000 filas por tabla el costo crece linealmente y arriesga timeouts de Apps Script (ejecución máxima). Estrategia incremental por tabla modificada (marcar dirty dentro de `dispatch`) manteniendo atomicidad del batchUpdate. Medir con dataset sintético de 2000 reservas.

**12. Sync de Calendar limitado a 20 eventos por corrida.**
Sin métrica de cola de sincronización. Exponer en `health()` cuántos `pending/error` quedan y alertar si no drena (umbral configurable).

## P1 · UX y frontend

**13. Dividir `src/main.jsx`.**
Todo (landing, booking, panel, mensajes, settings, login) vive en un archivo con componentes de líneas kilométricas. Separar en módulos (`Landing/`, `Booking/`, `Panel/`, comunes) mejora testeabilidad y revisabilidad sin cambiar comportamiento.

**14. Pruebas de UI/componentes.**
El dominio está bien cubierto; la interfaz no tiene ninguna. Añadir Vitest + Testing Library al menos para: flujo de reserva (bloqueo del botón sin Turnstile token en modo producción), cambio de estados del panel y accesibilidad básica (diálogos con foco atrapado).

**15. Accesibilidad del modal y tablas.**
`Modal` cierra con Escape pero no atrapa el foco ni usa `aria-modal` correctamente sobre elementos interactivos; las fuentes de 8–10 px en el panel dificultan lectura. Subir mínimo a 12 px en texto operativo y revisar contraste de `.muted`/`.legal`.

**16. Feedback de concurrencia en el panel.**
Dos operadores pueden pisarse estados (el lock serializa, gana el último `transition` válido). Mostrar toast específico cuando el turno cambió de estado desde la última carga (comparar snapshot con `createdAt`/`status` previo) y ofrecer recargar.

**17. Código muerto en `seed()` de la demo.**
Se generan appointments `b0..b8` en horarios 09:00–17:00 solapados todos contra el mismo slot de capacidad 1; los posteriores no se ven como disponibles pero ensucian historial/agenda. Generarlos sobre slots válidos o eliminarlos.

**18. Formato de precios fijo ARS.**
`MONEY` hardcodea ARS; si el taller cambia de país/moneda hay que tocar código. Derivar de `CONFIG.currency`.

## P2 · Ingeniería y operaciones

**19. CI mínima.**
No hay workflows. Un GitHub Actions que corra `npm test`, `npm run build`, `node --check api/index.js` y **verifique que `google/Domain.gs` esté regenerado** (`npm run google:build && git diff --exit-code google/Domain.gs`) evita el clásico "edité Domain.gs a mano" o "cambié domain.mjs y olvidé regenerar".

**20. Scripts faltantes en `package.json`.**
Agregar `"password": "node scripts/password.mjs"` y `"lint"`/`"format"` (prettier/eslint con reglas relajadas) — hoy el README menciona `scripts/password.mjs` pero no hay alias.

**21. Tipar el dominio.**
Migrar `src/domain.mjs` a TypeScript (o JSDoc estricto con `tsc --checkJs`) para detectar en compile-time inconsistencias de campos entre TABLES/Sheets/dominio. El build-google debería emitir también los `.d.ts`/tipos para el gateway.

**22. Versionar el contrato de acciones.**
`dispatch` acepta `action` como string libre. Publicar una constante `ACTIONS` compartida y validarla tanto en `api/index.js` como en Backend.gs; hoy Vercel define `publicActions` duplicando knowledge del dominio (riesgo de desincronización).

**23. Observabilidad del scheduler.**
`scheduledRun` guarda LAST_RUN/LAST_ERROR pero nada notifica si el trigger dejó de correr (Google a veces silencia triggers de cuentas sin actividad). Health-check externo (cron-job.org/UptimeRobot llamando a un endpoint `/api?action=ping` que lea LAST_RUN) con alerta por Telegram.

**24. Backup automatizado del spreadsheet.**
Documentado como manual. Se puede agregar trigger diario que copie la hoja a una carpeta designada con retención de N días (`DriveApp.copyFile`). Cubre el escenario de corrupción por bug de `saveDb`.

**25. `vite.config.js` con `allowedHosts: ['.e2b.app']`.**
Es para el entorno de desarrollo del proveedor; mover a configuración local (`vite.config.local.js` o variable de entorno) para que el repo desplegable no dependa de detalles de la plataforma de preview.

## Checklist rápido de bajo esfuerzo / alto impacto

| # | Cambio | Dónde | Esfuerzo | Estado |
|---|--------|-------|----------|--------|
| 1 | `clearRange` antes de reescribir tablas | Backend.gs `saveDb` | Bajo | ✅ Implementado |
| 2 | Feriados configurables | domain.mjs + docs | Bajo | Pendiente |
| 3 | Expirar `requested` vencidos | `automate()` | Medio | Pendiente |
| 4 | Tabla `audit` append-only | TABLES + dispatch | Medio | Pendiente |
| 5 | CI con tests + diff de Domain.gs | `.github/workflows` | Bajo | ✅ Implementado (`ci.yml`) |
| 6 | Parseo tolerante de respuesta GAS | client.mjs (fetch) | Bajo | ✅ Implementado |
| 7 | Rate-limit de login por IP | api/index.js | Medio | Pendiente |
| 8 | Separar consentimientos ops/marketing | domain.mjs + UI | Medio | Pendiente |
| 9 | Split de main.jsx + tests de componentes | src/ | Alto | Pendiente |
| 10 | Backup diario automático del Sheet | Backend.gs trigger | Bajo | Pendiente |

**Scripts agregados a package.json:** `npm run password` (hash scrypt), `npm run deploy` (`vercel deploy --prod`), `npm run clasp:push` (`clasp push`).

## Detalle de lo implementado (ronda actual)

- **#1 clearRange:** en `saveDb`, si `getLastRow() > records.length+1` se agrega un request `clearRange` (fields: contents) sobre las filas sobrantes antes del `updateCells`, dentro del mismo batchUpdate atómico. Elimina filas fantasma al achicar tablas (archivado/limpieza).
- **#6 parseo tolerante:** el `catch` de `r.json()` en `src/client.mjs` ahora distingue 502/504 ("el servidor tardó en responder") de otras respuestas no-JSON ("respuesta válida… reintentá"), y se usa `data?.ok`/`data?.error` para objetos inesperados. Nada más "toca" la red, así que el cambio es seguro.
- **#19 CI:** `.github/workflows/ci.yml` — Node 20, `npm ci`, regenera `google/Domain.gs` y falla si hay diff (invariante de código generado), corre `npm test`, `npm run build` y `node --check api/index.js`.
- **#20 scripts:** alias `password`, `deploy` y `clasp:push` en package.json.

Para cada ítem P0/P1 se recomienda abrir issue propia con criterio de aceptación y prueba asociada; ninguno requiere re-arquitecturar, y todos preservan las seis invariantes del README.
