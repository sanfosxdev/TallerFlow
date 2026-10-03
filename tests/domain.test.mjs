import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVICES,CONFIG,seed,localDate,nextWorkday,normalizePhone,normalizePlate,available,booking,transition,automate,enqueue,allowed,dispatch} from '../src/domain.mjs';
const now=new Date('2026-10-03T09:00:00-03:00');
function blank(){return {config:{...CONFIG},services:SERVICES.map(x=>({...x})),clients:[],vehicles:[],appointments:[],history:[],messages:[],waitlist:[]};}
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

test('consentimiento revocable controla creación de notificaciones',()=>{
 const db=blank(),res=booking(db,payload({consent:false}),now);
 assert.equal(db.clients[0].consent,false);assert.equal(db.messages.length,0);
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
 for(const a of ['catalog','slots','book','waitlist'])assert.equal(allowed(a,'public'),true);
 for(const a of ['snapshot','transition','message','automate','consent'])assert.equal(allowed(a,'public'),false);
 assert.equal(allowed('snapshot','admin'),true);
});
