export const SERVICES = [
 {id:'aceite',name:'Cambio de aceite',category:'Mantenimiento',duration:60,price:45000,icon:'Droplets',description:'Aceite y filtro. Cuidá el corazón de tu motor.'},
 {id:'frenos',name:'Frenos',category:'Seguridad',duration:90,price:60000,icon:'ShieldCheck',description:'Revisión de pastillas, discos y circuito.'},
 {id:'distribucion',name:'Distribución',category:'Mantenimiento',duration:180,price:180000,icon:'Settings',description:'Control y cambio de kit de distribución.'},
 {id:'diagnostico',name:'Diagnóstico',category:'Diagnóstico',duration:60,price:30000,icon:'ScanLine',description:'Escaneo y evaluación de fallas del vehículo.'},
 {id:'bateria',name:'Batería',category:'Electricidad',duration:30,price:18000,icon:'BatteryCharging',description:'Chequeo de carga y sistema de arranque.'},
 {id:'aire',name:'Aire acondicionado',category:'Confort',duration:90,price:45000,icon:'Wind',description:'Diagnóstico, mantenimiento y revisión de fugas.'},
 {id:'alineacion',name:'Alineación',category:'Neumáticos',duration:60,price:28000,icon:'MoveHorizontal',description:'Geometría y dirección para un andar parejo.'},
 {id:'balanceo',name:'Balanceo',category:'Neumáticos',duration:60,price:22000,icon:'CircleDot',description:'Menos vibraciones, más confort al manejar.'},
 {id:'electricidad',name:'Electricidad',category:'Electricidad',duration:90,price:35000,icon:'Zap',description:'Revisión de luces, cableado y alternador.'},
 {id:'previaje',name:'Revisión pre-viaje',category:'Seguridad',duration:90,price:40000,icon:'Route',description:'Un chequeo integral antes de salir a la ruta.'}
];
export const CONFIG={name:'TallerFlow',phone:'5491100000000',address:'Av. del Taller 123 · Buenos Aires',timezone:'America/Argentina/Buenos_Aires',open:9,close:18,weekdays:[1,2,3,4,5],holidays:['2026-12-24','2026-12-25','2026-12-31','2027-01-01'],requestExpireHours:48,capacity:1,slotMinutes:30,horizon:60};
export function uid(){return 'tf_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);}
export function localDate(d=new Date()){if(typeof Utilities!=='undefined')return Utilities.formatDate(d,CONFIG.timezone,'yyyy-MM-dd');return new Intl.DateTimeFormat('en-CA',{timeZone:CONFIG.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
export function nextWorkday(date=localDate()){let d=new Date(date+'T12:00:00-03:00');d.setDate(d.getDate()+1);while(!CONFIG.weekdays.includes(d.getDay()))d.setDate(d.getDate()+1);return localDate(d);}
export function cleanText(v,max=120){return String(v??'').trim().slice(0,max);}
export function normalizePhone(v){const p=String(v??'').replace(/\D/g,'');if(p.length<10||p.length>15)throw new Error('Ingresá un teléfono con código de país (10 a 15 dígitos).');return p;}
export function normalizePlate(v){let p=String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-Z]{3}\d{3}$|^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p))throw new Error('Patente inválida. Usá ABC123 o AB123CD.');return p;}
export function allowed(action,role){return role==='admin'||['catalog','slots','book','waitlist'].includes(action);}
/** Auditoría append-only: acciones sensibles y mutaciones excepcionales (p. ej. borrado de PII). */
export function audit(db,p,now=new Date()){if(!Array.isArray(db.audit))db.audit=[];db.audit.push({id:uid(),at:now.toISOString(),action:cleanText(p.action,40),targetId:cleanText(p.targetId,60),actor:p.actor==='admin'?'admin':'public',detail:cleanText(p.detail,300)});return {ok:true};}
export function overlaps(a,b){return a.start<b.end&&a.end>b.start;}
export function available(db,date,serviceId,now=new Date()){
 const service=db.services.find(s=>s.id===serviceId); if(!service)throw new Error('Servicio inexistente.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Fecha inválida.');
 const day=new Date(date+'T12:00:00-03:00'); if(Number.isNaN(+day)||localDate(day)!==date)throw new Error('Fecha inválida.');
 if(!db.config.weekdays.includes(day.getDay()))return [];
 if((db.config.holidays||[]).includes(date))return [];
 const latest=new Date(now);latest.setDate(latest.getDate()+db.config.horizon);if(date>localDate(latest))return [];
 const slots=[];for(let m=db.config.open*60;m+service.duration<=db.config.close*60;m+=db.config.slotMinutes){
 const hh=String(Math.floor(m/60)).padStart(2,'0'),mm=String(m%60).padStart(2,'0');
 const start=new Date(`${date}T${hh}:${mm}:00-03:00`).toISOString(),end=new Date(new Date(start).getTime()+service.duration*60000).toISOString();
 if(new Date(start)<=now)continue;
 const busy=db.appointments.filter(a=>['requested','confirmed'].includes(a.status)&&overlaps({start,end},a));
 if(busy.length<db.config.capacity)slots.push({time:`${hh}:${mm}`,start,end});}
 return slots;
}
export function enqueue(db,key,clientId,kind,text,appointmentId=''){
 const c=db.clients.find(c=>c.id===clientId);if(!c?.consent||db.messages.some(m=>m.key===key))return null;
 const message={id:uid(),key,clientId,kind,text,appointmentId,status:'pending',createdAt:new Date().toISOString(),sentAt:''};db.messages.push(message);return message;
}
export function booking(db,p,now=new Date()){
 const old=db.appointments.find(a=>a.requestId===p.requestId);if(old)return {id:old.id,status:old.status,start:old.start};
 if((db.config.holidays||[]).includes(p.date))throw new Error('Ese día es feriado y el taller no atiende. Elegí otra fecha.');
 if(!/^[\w-]{8,100}$/.test(p.requestId||''))throw new Error('Identificador de reserva inválido.');
 const name=cleanText(p.name,80),brand=cleanText(p.brand,60),model=cleanText(p.model,60),phone=normalizePhone(p.phone),plate=normalizePlate(p.plate),year=Number(p.year);
 if(name.length<2||!brand||!model||!Number.isInteger(year)||year<1950||year>new Date().getFullYear()+1)throw new Error('Revisá nombre, marca, modelo y año.');
 const slot=available(db,p.date,p.serviceId,now).find(s=>s.time===p.time);if(!slot)throw new Error('Ese horario ya no está disponible. Elegí otro.');
 let client=db.clients.find(c=>c.phone===phone); if(!client){client={id:uid(),name,phone,consent:false,consentAt:'',createdAt:now.toISOString()};db.clients.push(client);}
 client.name=name;if(p.consent===true){client.consent=true;client.consentAt=now.toISOString();}
 let vehicle=db.vehicles.find(v=>v.plate===plate);if(vehicle&&vehicle.clientId!==client.id)throw new Error('La patente ya está registrada. Contactá al taller para verificar la titularidad.');
 if(!vehicle){vehicle={id:uid(),clientId:client.id,brand,model,year,plate};db.vehicles.push(vehicle);}
 const a={id:uid(),requestId:p.requestId,clientId:client.id,vehicleId:vehicle.id,serviceId:p.serviceId,...slot,status:'requested',notes:cleanText(p.notes,500),createdAt:now.toISOString(),eventId:'',syncStatus:'none'};db.appointments.push(a);
 db.waitlist.filter(w=>w.clientId===client.id&&w.serviceId===p.serviceId&&w.date===p.date&&w.status==='active').forEach(w=>w.status='closed');
 enqueue(db,'request:'+a.id,client.id,'Solicitud',`Hola ${client.name}, recibimos tu solicitud para el ${p.date} a las ${p.time}. El turno está pendiente de confirmación del taller.`,a.id);
 return {id:a.id,status:a.status,start:a.start};
}
export function automate(db,now=new Date()){
 const before=db.messages.length;
 // Solicitudes requested sin gestionar cuyo horario ya pasó liberan el slot (invariante 2 intacta: sólo vence turnos futuros).
 for(const a of db.appointments){if(a.status!=='requested'||new Date(a.end)>now)continue;a.status='expired';a.syncStatus='none';audit(db,{action:'transition',targetId:a.id,actor:'system',detail:'requested→expired (vencimiento automático)'},now);}
 for(const a of db.appointments){if(a.status!=='confirmed')continue;const hours=(new Date(a.start)-now)/3600000;if(hours>0&&hours<=25)enqueue(db,'rem24:'+a.id,a.clientId,'Recordatorio',`Hola ${db.clients.find(c=>c.id===a.clientId)?.name}, te esperamos el ${localDate(new Date(a.start))} a las ${new Date(a.start).toLocaleTimeString('es-AR',{timeZone:CONFIG.timezone,hour:'2-digit',minute:'2-digit'})}. Avisanos si necesitás reprogramar.`,a.id);}
 for(const c of db.clients){const visits=db.history.filter(h=>h.clientId===c.id).sort((a,b)=>b.date.localeCompare(a.date));const last=visits[0];if(!last||db.appointments.some(a=>a.clientId===c.id&&['requested','confirmed'].includes(a.status)&&new Date(a.end)>now))continue;const days=Math.floor((now-new Date(last.date))/86400000);for(const threshold of [90,180])if(days>=threshold&&!(threshold===90&&days>=180))enqueue(db,`rec${threshold}:${c.id}:${last.id}`,c.id,`Recuperación ${threshold} días`,`Hola ${c.name}, pasaron más de ${threshold} días desde tu último servicio. ¿Querés que coordinemos una revisión?`);}
 return {created:db.messages.length-before};
}
export function transition(db,p,now=new Date()){
 const a=db.appointments.find(a=>a.id===p.id);if(!a)throw new Error('Turno inexistente.');
 const valid={requested:['confirmed','cancelled','expired'],confirmed:['completed','cancelled','no_show'],completed:[],cancelled:[],no_show:[],expired:[]};
 if(a.status===p.status)return {ok:true};if(!valid[a.status]?.includes(p.status))throw new Error('Cambio de estado no permitido.');
 audit(db,{action:'transition',targetId:a.id,actor:p.actor,detail:`${a.status}→${p.status}`},now);
 const client=db.clients.find(c=>c.id===a.clientId),service=db.services.find(s=>s.id===a.serviceId);
 a.status=p.status;a.syncStatus=p.status==='confirmed'?'pending':(a.eventId?'pending':'none');
 if(p.status==='confirmed')enqueue(db,'confirm:'+a.id,a.clientId,'Confirmación',`Hola ${client.name}, tu turno de ${service.name} está confirmado para el ${localDate(new Date(a.start))} a las ${a.time}. ¡Te esperamos!`,a.id);
 if(['cancelled','completed','no_show'].includes(p.status))for(const m of db.messages)if(m.appointmentId===a.id&&['pending','opened'].includes(m.status))m.status='void';
 if(p.status==='completed'){
 const km=p.km===''||p.km===undefined?null:Number(p.km);if(km!==null&&(!Number.isInteger(km)||km<0||km>3000000))throw new Error('Kilometraje inválido.');
 db.history.push({id:uid(),appointmentId:a.id,clientId:a.clientId,vehicleId:a.vehicleId,serviceId:a.serviceId,date:now.toISOString(),km,notes:cleanText(p.notes,1500)});
 enqueue(db,'follow:'+a.id,a.clientId,'Seguimiento',`Hola ${client.name}, ¿cómo quedó tu vehículo después de ${service.name}? Gracias por confiar en nosotros.`,a.id);
 }
 if(p.status==='cancelled'){
 enqueue(db,'cancel:'+a.id,a.clientId,'Cancelación',`Hola ${client.name}, tu turno del ${localDate(new Date(a.start))} a las ${a.time} fue cancelado. Escribinos para coordinar otra fecha.`,a.id);
 if(new Date(a.start)>now)for(const w of db.waitlist.filter(w=>w.status==='active'&&w.serviceId===a.serviceId&&w.date===localDate(new Date(a.start)))){
 const wc=db.clients.find(c=>c.id===w.clientId);if(!wc)continue;
 enqueue(db,`gap:${a.id}:${w.id}`,wc.id,'Hueco disponible',`Hola ${wc.name}, se liberó un lugar para ${service.name} el ${w.date} a las ${a.time}. Respondé si te interesa; el horario no queda reservado hasta completar la solicitud.`);
 }}return {ok:true};
}
export function dispatch(db,action,p={},now=new Date(),role='public'){
 if(action==='catalog')return {config:db.config,services:db.services};
 if(action==='slots')return available(db,p.date,p.serviceId,now);
 if(action==='book')return booking(db,p,now);
 if(action==='snapshot')return db;
 if(action==='transition')return transition(db,{...p,actor:role},now);
 if(action==='automate')return automate(db,now);
 if(action==='consent'){const c=db.clients.find(c=>c.id===p.id);if(!c)throw new Error('Cliente inexistente.');c.consent=p.consent===true;c.consentAt=now.toISOString();audit(db,{action:'consent',targetId:c.id,actor:role,detail:p.consent===true?'otorgado':'revocado'},now);if(!c.consent)db.messages.filter(m=>m.clientId===c.id&&['pending','opened'].includes(m.status)).forEach(m=>m.status='void');return {ok:true};}
 if(action==='message'){const m=db.messages.find(m=>m.id===p.id);if(!m)throw new Error('Mensaje inexistente.');if(!db.clients.find(c=>c.id===m.clientId)?.consent)throw new Error('Cliente sin consentimiento.');if(!['opened','sent'].includes(p.status)||['void','sent'].includes(m.status))throw new Error('Estado no permitido.');m.status=p.status;if(p.status==='sent')m.sentAt=now.toISOString();audit(db,{action:'message',targetId:m.id,actor:role,detail:p.status},now);return {ok:true};}
 if(action==='waitlist'){
 const phone=normalizePhone(p.phone),name=cleanText(p.name,80);if(name.length<2||p.consent!==true)throw new Error('Nombre y consentimiento obligatorios.');if(!db.services.some(s=>s.id===p.serviceId)||!/^\d{4}-\d{2}-\d{2}$/.test(p.date))throw new Error('Servicio o fecha inválidos.');
 if((db.config.holidays||[]).includes(p.date))throw new Error('Ese día es feriado y el taller no atiende. Elegí otra fecha.');
 const waitDay=new Date(p.date+'T12:00:00-03:00'),maxDay=new Date(now);maxDay.setDate(maxDay.getDate()+db.config.horizon);
 if(localDate(waitDay)!==p.date||p.date<localDate(now)||p.date>localDate(maxDay)||!db.config.weekdays.includes(waitDay.getDay()))throw new Error('Elegí un día hábil disponible dentro de los próximos 60 días.');
 if(available(db,p.date,p.serviceId,now).length)throw new Error('Ese día todavía tiene horarios disponibles. Elegí uno o probá otra fecha.');
 let c=db.clients.find(c=>c.phone===phone);if(!c){c={id:uid(),phone,name,consent:true,consentAt:now.toISOString(),createdAt:now.toISOString()};db.clients.push(c);}else{c.name=name;c.consent=true;c.consentAt=now.toISOString();}
 let item=db.waitlist.find(w=>w.clientId===c.id&&w.date===p.date&&w.serviceId===p.serviceId&&w.status==='active');if(!item){item={id:uid(),clientId:c.id,serviceId:p.serviceId,date:p.date,status:'active',createdAt:now.toISOString()};db.waitlist.push(item);}return {ok:true,id:item.id};
 }
 if(action==='waitlistClose'){const w=db.waitlist.find(w=>w.id===p.id);if(!w)throw new Error('Registro inexistente.');w.status='closed';return {ok:true};}
 if(action==='audit')return audit(db,p,now);
 throw new Error('Acción no permitida.');
}
export function seed(now=new Date()){
 const db={config:{...CONFIG},services:SERVICES.map(s=>({...s})),clients:[],vehicles:[],appointments:[],history:[],messages:[],waitlist:[],audit:[]};
 const names=['Martín Rodríguez','Lucía Fernández','Diego Suárez','Camila Torres','Pablo Méndez','Sofía García','Nicolás Ríos','Valentina López'];
 const cars=[['Volkswagen','Gol','AB123CD'],['Toyota','Corolla','AC456EF'],['Ford','Focus','AD789GH'],['Peugeot','208','AE234IJ'],['Renault','Sandero','AF567KL'],['Fiat','Cronos','AG890MN'],['Chevrolet','Onix','AH345OP'],['Honda','Fit','AI678QR']];
 names.forEach((name,i)=>{db.clients.push({id:'c'+i,name,phone:'54911000000'+String(i).padStart(2,'0'),consent:i!==4,consentAt:now.toISOString(),createdAt:now.toISOString()});db.vehicles.push({id:'v'+i,clientId:'c'+i,brand:cars[i][0],model:cars[i][1],plate:cars[i][2],year:2017+i%6});const d=new Date(now);d.setDate(d.getDate()-(i<4?20+i*8:95+(i-4)*35));db.history.push({id:'h'+i,clientId:'c'+i,vehicleId:'v'+i,serviceId:SERVICES[i].id,date:d.toISOString(),km:42000+i*7500,notes:'Servicio de demostración. Control general realizado.',appointmentId:''});});
 const date=nextWorkday(localDate(now));[0,1,2,3].forEach((i)=>{const time=['09:00','10:30','12:00','15:00'][i],start=new Date(date+'T'+time+':00-03:00').toISOString();db.appointments.push({id:'a'+i,requestId:'seed000'+i,clientId:'c'+i,vehicleId:'v'+i,serviceId:SERVICES[i===2?3:i].id,time,start,end:new Date(new Date(start).getTime()+SERVICES[i===2?3:i].duration*60000).toISOString(),status:i===3?'requested':'confirmed',notes:'',createdAt:now.toISOString(),eventId:'',syncStatus:'demo'});});
 const waitDate=nextWorkday(date);for(let i=0;i<9;i++){const time=String(9+i).padStart(2,'0')+':00',start=new Date(waitDate+'T'+time+':00-03:00').toISOString(),ci=i%4;db.appointments.push({id:'b'+i,requestId:'seedB000'+i,clientId:'c'+ci,vehicleId:'v'+ci,serviceId:'aceite',time,start,end:new Date(new Date(start).getTime()+60000*60).toISOString(),status:'confirmed',notes:'',createdAt:now.toISOString(),eventId:'',syncStatus:'demo'});}
 db.waitlist.push({id:'w0',clientId:'c6',serviceId:'aceite',date:waitDate,status:'active',createdAt:now.toISOString()});automate(db,now);return db;
}
