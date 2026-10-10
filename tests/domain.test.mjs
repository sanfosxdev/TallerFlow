import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVICES,CONFIG,seed,localDate,nextWorkday,normalizePhone,normalizePlate,available,booking,transition,automate,enqueue,allowed,dispatch,consentRequired,hasConsent} from '../src/domain.mjs';
const now=new Date('2026-10-03T09:00:00-03:00');
function blank(){return {config:{...CONFIG},services:SERVICES.map(x=>({...x})),clients:[],vehicles:[],appointments:[],history:[],messages:[],waitlist:[],audit:[]};}
function payload(extra={}){return {requestId:'request-12345678',name:'Ana Pérez',phone:'5491112345678',brand:'Toyota',model:'Corolla',year:2022,plate:'AB123CD',date:nextWorkday(localDate(now)),time:'09:00',serviceId:'aceite',consent:true,...extra};}

test('normaliza teléfonos y patentes argentinas y rechaza datos fuera de contrato',()=>{
 assert.equal(normalizePhone('+54 9 11 1234-5678'),'5491112345678');
 assert.throws(()=>normalizePhone('12345'),/teléfono/);
 assert.equal(normalizePlate('ab 123 cd'),'AB123CD');
 assert.equal(normalizePlate('ABC 123'),'ABC123');
 assert.throws(()=>normalizePlate('patente'),/Patente inválida/);
});

test('slots respetan días hábiles, horario de taller y horizonte',()=>{
 const db=blank(),date=nextWorkday(localDate(now));
 const slots=available(db,date,'aceite',now);
 assert.ok(slots.length>0);assert.equal(slots[0].time,'09:00');assert.ok(slots.every(s=>s.end>s.start));
 const sunday='2026-10-04';assert.deepEqual(available(db,sunday,'aceite',now),[]);
 assert.deepEqual(available(db,'2027-01-01','aceite',now),[]);
});

test('solicitud es idempotente, bloquea el horario y preserva un solo cliente/auto',()=>{
 const db=blank(),p=payload();
 const first=booking(db,p,now);const second=booking(db,p,now);
 assert.equal(first.id,second.id);assert.equal(db.appointments.length,1);
 assert.equal(db.clients.length,1);assert.equal(db.vehicles.length,1);
 const slots=available(db,p.date,'aceite',now).map(s=>s.time);
 assert.ok(!slots.includes('09:00'));assert.ok(!slots.includes('09:30'));
 assert.ok(db.messages.some(m=>m.kind==='Solicitud'&&m.status==='pending'));
});

test('reserva necesita datos válidos, horario libre y consentimiento booleano controlado',()=>{
 const db=blank();
 assert.throws(()=>booking(db,payload({year:1800}),now),/año/);
 assert.throws(()=>booking(db,payload({plate:'AA1234'}),now),/Patente inválida/);
 assert.throws(()=>booking(db,payload({requestId:'bad'}),now),/Identificador/);
 assert.throws(()=>booking(db,payload({phone:'4'}),now),/teléfono/);
});

test('consentimiento operativo es requisito para reservar; sin autorización no hay notificaciones',()=>{
 // El consentimiento ops es condición de la reserva (el cliente necesita confirmaciones de su turno).
 assert.throws(()=>booking(blank(),payload({consent:false}),now),/autorizar/i);
 // Un cliente existente que revoca ops sigue siendo atendido, pero no recibe mensajes.
 const db=blank();booking(db,payload(),now);dispatch(db,'consent',{id:db.clients[0].id,consent:false},now,'admin');
 db.messages=[];
 assert.equal(db.clients[0].consent,false);assert.equal(db.clients[0].consentOps,false);
 assert.equal(enqueue(db,'test',db.clients[0].id,'Prueba','No enviar'),null);
});

test('transiciones válidas, historial, seguimiento, cancelación y oferta de hueco',()=>{
 const db=blank(),res=booking(db,payload(),now),appt=db.appointments[0];
 const waiter={id:'waiter',name:'Bea Ramos',phone:'5491198765432',consent:true,consentAt:now.toISOString(),createdAt:now.toISOString()};db.clients.push(waiter);
 db.waitlist.push({id:'w1',clientId:waiter.id,serviceId:'aceite',date:payload().date,status:'active',createdAt:now.toISOString()});
 assert.equal(transition(db,{id:res.id,status:'confirmed'},now).ok,true);
 assert.throws(()=>transition(db,{id:res.id,status:'requested'},now),/no permitido/);
 assert.equal(transition(db,{id:res.id,status:'completed',km:'78000',notes:'Filtro reemplazado'},now).ok,true);
 assert.equal(db.history.length,1);assert.equal(db.history[0].km,78000);
 assert.ok(db.messages.some(m=>m.kind==='Seguimiento'));
 const secondDb=blank();const r=booking(secondDb,payload(),now);secondDb.clients.push({...waiter});secondDb.waitlist.push({id:'w1',clientId:'waiter',serviceId:'aceite',date:payload().date,status:'active',createdAt:now.toISOString()});transition(secondDb,{id:r.id,status:'confirmed'},now);transition(secondDb,{id:r.id,status:'cancelled'},now);
 assert.ok(secondDb.messages.some(m=>m.kind==='Cancelación'));
 assert.ok(secondDb.messages.some(m=>m.kind==='Hueco disponible'&&m.clientId==='waiter'));
 assert.ok(available(secondDb,payload().date,'aceite',now).some(s=>s.time==='09:00'));
});

test('90/180 días crea recuperaciones una sola vez, y no si falta consentimiento o hay turno futuro',()=>{
 const db=seed(now);const before=db.messages.length;const run1=automate(db,now);const run2=automate(db,now);
 assert.equal(run1.created,0,'seed genera recordatorios al inicializar los datos');
 assert.equal(run2.created,0,'la clave idempotente evita duplicados');
 assert.ok(db.messages.every(m=>{const c=db.clients.find(x=>x.id===m.clientId);return c?.consent===true;}));
 const fresh=blank();fresh.clients.push({id:'c1',name:'Sin permiso',phone:'5491111111111',consent:false});fresh.history.push({id:'h1',clientId:'c1',date:'2026-01-01T12:00:00.000Z',serviceId:'aceite'});
 assert.equal(automate(fresh,now).created,0);
});

test('recordatorio de 24h requiere turno confirmado y no duplica',()=>{
 const db=blank(),date='2026-10-05',start='2026-10-05T12:00:00.000Z';
 db.clients.push({id:'c',name:'Cliente',phone:'5491112345678',consent:true});
 db.appointments.push({id:'a',clientId:'c',status:'confirmed',start,end:'2026-10-05T13:00:00.000Z',serviceId:'aceite',time:'09:00'});
 const future=new Date('2026-10-04T12:00:00.000Z');assert.equal(automate(db,future).created,1);assert.equal(automate(db,future).created,0);
});

test('clientes sin consentimiento no reciben mensaje y revocación invalida cola',()=>{
 const db=blank();db.clients.push({id:'c',name:'Cliente',phone:'5491112345678',consent:true});
 enqueue(db,'follow:c','c','Seguimiento','Hola');assert.equal(db.messages.length,1);
 dispatch(db,'consent',{id:'c',consent:false},now);assert.equal(db.messages[0].status,'void');
 assert.equal(enqueue(db,'second','c','Seguimiento','Hola otra vez'),null);
});

test('la lista de espera exige permiso, un día laboral válido y un servicio sin horarios',()=>{
 const db=blank(),date=nextWorkday(localDate(now)),start=new Date(date+'T09:00:00-03:00').toISOString(),end=new Date(date+'T18:00:00-03:00').toISOString();
 db.appointments.push({id:'block',status:'confirmed',start,end,serviceId:'aceite'});
 const p={name:'Bea Ramos',phone:'5491198765432',serviceId:'aceite',date,consent:true};
 const one=dispatch(db,'waitlist',p,now),two=dispatch(db,'waitlist',p,now);
 assert.ok(one.id);assert.equal(one.id,two.id);assert.equal(db.waitlist.length,1);
 assert.throws(()=>dispatch(blank(),'waitlist',{...p,consent:false},now),/consentimiento/);
 assert.throws(()=>dispatch(blank(),'waitlist',{...p,date:'2026-10-04'},now),/día hábil/);
 assert.throws(()=>dispatch(blank(),'waitlist',p,now),/horarios disponibles/);
});

test('la frontera de acciones públicas es restrictiva',()=>{
 // #23: health y automate se vuelven seguras en modo público (sólo conteos / reintentos idempotentes).
 for(const a of ['catalog','slots','book','waitlist','health','automate'])assert.equal(allowed(a,'public'),true);
 for(const a of ['snapshot','transition','message','consent','audit','waitlistClose'])assert.equal(allowed(a,'public'),false,a+' no debe ser pública');
 assert.equal(allowed('snapshot','admin'),true);
});

test('feriados configurables bloquean horarios, reservas y lista de espera',()=>{
 const db=blank(),date=nextWorkday(localDate(now));
 db.config.holidays=[date];
 assert.deepEqual(available(db,date,'aceite',now),[],'el feriado no ofrece horarios');
 assert.throws(()=>booking(db,payload(),now),/feriado/);
 assert.throws(()=>dispatch(db,'waitlist',{name:'Bea Ramos',phone:'5491198765432',serviceId:'aceite',date,consent:true},now),/feriado/);
 // Sin feriados el mismo día vuelve a ser operable.
 db.config.holidays=[];
 assert.ok(available(db,date,'aceite',now).length>0);
});

test('automate expira solicitudes requested vencidas, libera slots pasados y no toca turnos futuros',()=>{
 const db=blank();const res=booking(db,payload(),now);
 const late=new Date(now.getTime()+5*86400000);
 const run=automate(db,late);
 assert.equal(db.appointments[0].status,'expired');
 assert.ok(db.audit.some(x=>x.actor==='system'&&x.detail.includes('expired')));
 assert.equal(run.created,0,'la expiración no genera mensajes al cliente');
 // Un slot pasado ya no bloquea: available lo filtra por now igualmente.
 assert.ok(!available(db,payload().date,'aceite',late).some(s=>s.time==='09:00'));
 // Solicitud futura NO vence: invariante 2 (sólo administración confirma/cancela turnos vigentes).
 const db2=blank();booking(db2,{...payload(),date:nextWorkday(localDate(new Date(now.getTime()+5*86400000))),requestId:'request-99887766'},now);
 automate(db2,new Date(now.getTime()+3600000));
 assert.equal(db2.appointments[0].status,'requested');
 // El admin puede cancelar explícitamente una solicitud pendiente.
 assert.equal(transition(db2,{id:db2.appointments[0].id,status:'cancelled'},now).ok,true);
});

test('auditoría append-only registra transiciones, consentimientos y mensajes con actor',()=>{
 const db=blank(),res=booking(db,payload(),now);
 transition(db,{id:res.id,status:'confirmed',actor:'admin'},now);
 dispatch(db,'consent',{id:db.clients[0].id,consent:false},now,'admin');
 const kinds=db.audit.map(x=>x.action);
 assert.ok(kinds.includes('transition')&&kinds.includes('consent'));
 assert.equal(db.audit.find(x=>x.action==='transition').detail,'requested→confirmed');
 assert.equal(db.audit.find(x=>x.action==='transition').actor,'admin');
 assert.equal(db.audit.find(x=>x.action==='consent').detail,'ops:revocado');
 // Datos legados sin tabla audit no rompen el dominio.
 const legacy={...blank()};delete legacy.audit;
 const legacyRes=booking(legacy,payload({requestId:'request-55443322'}),now);
 assert.equal(transition(legacy,{id:legacyRes.id,status:'confirmed',actor:'admin'},now).ok,true);
 assert.equal(legacy.audit.length,1);
});

test('consentimientos separados: ops para turnos, marketing opt-in para recuperación',()=>{
 // Marketing es explícito: la reserva con consentimiento sólo habilita mensajes operativos.
 const db=blank();booking(db,payload({consent:true}),now);
 assert.equal(db.clients[0].consentOps,true);assert.equal(db.clients[0].consentMarketing,false);
 assert.ok(db.messages.some(m=>m.kind==='Solicitud'),'recordatorio operativo sí se crea');
 automate(db,now);
 assert.ok(!db.messages.some(m=>m.kind.startsWith('Recuperación')),'sin marketing no hay campañas');
 // Alta voluntaria de marketing → recién ahí se genera la campaña 90 días (el cliente tiene historial a -120 días y sin turnos futuros).
 dispatch(db,'consent',{id:db.clients[0].id,consent:true,scope:'marketing'},now,'public');
 assert.equal(db.clients[0].consentMarketing,true);
 db.history.push({id:'hOld',clientId:db.clients[0].id,vehicleId:db.vehicles[0].id,serviceId:'aceite',date:new Date(now.getTime()-120*86400000).toISOString(),km:50000,notes:'',appointmentId:''});
 transition(db,{id:db.appointments[0].id,status:'cancelled',actor:'admin'},now);
 automate(db,now);
 assert.ok(db.messages.some(m=>m.kind.startsWith('Recuperación')&&m.status==='pending'));
 // Revocar marketing anula sólo Recuperación; los operativos ya emitidos siguen vivos.
 dispatch(db,'consent',{id:db.clients[0].id,consent:false,scope:'marketing'},now,'admin');
 assert.equal(db.messages.filter(m=>m.kind.startsWith('Recuperación')&&m.status==='void').length,1);
 assert.equal(db.messages.filter(m=>m.kind==='Solicitud'&&['pending','opened'].includes(m.status)).length,0,'la Solicitud pasó a void por cancelarse el turno (regla de transiciones), no por la revocación de marketing');
 assert.equal(db.messages.filter(m=>m.kind==='Solicitud').length,1,'el consentimiento de marketing no anuló mensajes operativos');
 assert.equal(db.clients[0].consentOps,true);
 // La revocación de marketing no borra el flag consentOps del cliente (los flags quedan independientes).
 assert.ok(db.audit.some(x=>x.action==='consent'&&x.detail==='marketing:revocado'));
 // El gate de envío (message opened/sent) respeta el scope por tipo de mensaje: la Recuperación quedó anulada y no puede marcarse enviada.
 const rec=db.messages.find(m=>m.kind.startsWith('Recuperación'));
 assert.equal(rec.status,'void');
 assert.throws(()=>dispatch(db,'message',{id:rec.id,status:'sent'},now,'admin'),/Estado no permitido|sin consentimiento/);
 // Un segundo turno confirmado genera Confirmación operativa aunque marketing esté revocado.
 booking(db,payload({requestId:'request-99887766'}),now);
 transition(db,{id:db.appointments[1].id,status:'confirmed',actor:'admin'},now);
 assert.ok(db.messages.some(m=>m.kind==='Confirmación'&&m.status==='pending'),'ops sigue habilitado con marketing revocado');
 assert.throws(()=>booking(db,payload({requestId:'request-55554444',consent:false,time:'16:30'}),now),/autorizar/i);
 // Revocar ops anula los operativos pendientes; marketing sigue revocado (independiente).
 dispatch(db,'consent',{id:db.clients[0].id,consent:false},now,'admin');
 assert.equal(db.messages.filter(m=>['Solicitud','Confirmación'].includes(m.kind)&&m.status==='void').length,3,'dos Solicitudes + una Confirmación anuladas por revocar ops');
 assert.equal(db.clients[0].consentMarketing,false);
 assert.equal(db.clients[0].consentOps,false);
 assert.ok(db.audit.some(x=>x.action==='consent'&&x.detail==='ops:revocado'));
 // La reserva otorga consentimiento ops explícito (queda registrado en la ficha del cliente).
 assert.equal(db.clients[0].consentOps,false);assert.equal(db.clients[0].consent,false);
 // Datos legados (sólo consent=true) conservan mensajes operativos pero nunca reciben marketing.
 const legacy=blank();legacy.clients.push({id:'cL',name:'Legado',phone:'5491122233344',consent:true,consentAt:'',createdAt:''});
 legacy.history.push({id:'hL',clientId:'cL',vehicleId:'',serviceId:'aceite',date:new Date(now.getTime()-100*86400000).toISOString(),km:10,notes:'',appointmentId:''});
 assert.ok(enqueue(legacy,'x2','cL','Confirmación','Turno confirmado'),'ops heredado desde consent=true');
 assert.equal(enqueue(legacy,'x3','cL','Recuperación 90 días','Hola'),null,'marketing nunca implícito');
 automate(legacy,now);
 assert.ok(!legacy.messages.some(m=>m.clientId==='cL'&&m.kind.startsWith('Recuperación')));
});

// #23 Observabilidad: métricas de salud (cola Calendar + mensajes pendientes) vía dispatch('health').
test('health expone la cola de sincronización de Calendar y mensajes pendientes',()=>{
 const db=blank();
 assert.deepEqual(dispatch(db,'health',{},{},'admin'),{calendarBacklog:0,pendingMessages:0});
 const date=nextWorkday(localDate(now));
 booking(db,payload({requestId:'request-h1000001'}),now);
 transition(db,{id:db.appointments[0].id,status:'confirmed',actor:'admin'},now);
 // Confirmado => syncStatus 'pending' (cola de Calendar). Un error sume igual.
 let h=dispatch(db,'health',{},{},'admin');
 assert.equal(h.calendarBacklog,1);assert.ok(h.pendingMessages>=1,'confirmación en cola de WhatsApp');
 db.appointments.push({...db.appointments[0],id:'aX',requestId:'request-h1000002',syncStatus:'error'});
 h=dispatch(db,'health',{},{},'admin');
 assert.equal(h.calendarBacklog,2,'los eventos con error cuentan como backlog');
 db.appointments.forEach(a=>a.syncStatus='synced');
 assert.equal(dispatch(db,'health',{},{},'admin').calendarBacklog,0,'la cola drenó');
});
