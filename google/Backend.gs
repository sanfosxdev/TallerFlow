/** TallerFlow. Requires Advanced Google Sheets service (identifier Sheets). */
const TABLES={
 config:['id','value'],services:['id','name','category','duration','price','icon','description'],
 clients:['id','name','phone','consent','consentOps','consentMarketing','consentAt','createdAt'],vehicles:['id','clientId','brand','model','year','plate'],
 appointments:['id','requestId','clientId','vehicleId','serviceId','time','start','end','status','notes','createdAt','eventId','syncStatus'],
 history:['id','appointmentId','clientId','vehicleId','serviceId','date','km','notes'],
 messages:['id','key','clientId','kind','text','appointmentId','status','createdAt','sentAt'],
 waitlist:['id','clientId','serviceId','date','status','createdAt'],
 audit:['id','at','action','targetId','actor','detail']
};
function props(){return PropertiesService.getScriptProperties();}
function spreadsheet(){return SpreadsheetApp.openById(props().getProperty('SPREADSHEET_ID'));}
function response(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function readDb(){const ss=spreadsheet(),db={};for(const name in TABLES){const rows=ss.getSheetByName(name).getDataRange().getValues();db[name]=rows.slice(1).filter(r=>r[0]!=='').map(r=>Object.fromEntries(TABLES[name].map((h,i)=>[h,r[i]])));}db.config=JSON.parse(db.config[0].value);return db;}
function cell(v){if(v===null||v===undefined||v==='')return {};if(typeof v==='number')return {userEnteredValue:{numberValue:v}};if(typeof v==='boolean')return {userEnteredValue:{boolValue:v}};return {userEnteredValue:{stringValue:String(v)}};}
/** One atomic Sheets batchUpdate: no half-written customer/booking/outbox state. */
function saveDb(db){const ss=spreadsheet(),requests=[];for(const name in TABLES){const sh=ss.getSheetByName(name),headers=TABLES[name],records=name==='config'?[{id:'main',value:JSON.stringify(db.config)}]:db[name];if(records.length>5000)throw new Error('Límite MVP: 5000 filas por tabla. Archivá o migrá antes de continuar.');if(sh.getMaxRows()<records.length+1)requests.push({appendDimension:{sheetId:sh.getSheetId(),dimension:'ROWS',length:records.length+1-sh.getMaxRows()}});const lastRow=Math.max(1,sh.getLastRow());if(lastRow>records.length+1)requests.push({clearRange:{range:{sheetId:sh.getSheetId(),startRowIndex:records.length+1,endRowIndex:lastRow,startColumnIndex:0,endColumnIndex:headers.length},fields:'contents'}});requests.push({updateCells:{range:{sheetId:sh.getSheetId(),startRowIndex:0,startColumnIndex:0,endColumnIndex:headers.length},rows:[{values:headers.map(cell)},...records.map(r=>({values:headers.map(h=>cell(r[h]))}))],fields:'userEnteredValue'}});}Sheets.Spreadsheets.batchUpdate({requests},ss.getId());SpreadsheetApp.flush();}
function locked(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw new Error('Sistema ocupado. Reintentá.');try{return fn();}finally{lock.releaseLock();}}
function doPost(e){try{
 if(!e?.postData?.contents||e.postData.contents.length>16000)throw new Error('Solicitud inválida.');
 const envelope=JSON.parse(e.postData.contents),p=envelope.p,s=envelope.s;if(typeof p!=='string'||typeof s!=='string')throw new Error('Firma inválida.');
 const secret=props().getProperty('GAS_SECRET');if(!secret)throw new Error('Falta configuración.');
 const hash=Utilities.computeHmacSha256Signature('v1\n'+p,secret,Utilities.Charset.UTF_8).map(b=>(b&255).toString(16).padStart(2,'0')).join('');let diff=hash.length^s.length;for(let i=0;i<hash.length;i++)diff|=hash.charCodeAt(i)^(s.charCodeAt(i)||0);if(diff)throw new Error('Firma inválida.');
 const request=JSON.parse(p);if(request.v!==1||Math.abs(Date.now()-request.ts)>120000||!request.nonce||!['public','admin'].includes(request.role)||!allowed(request.action,request.role))throw new Error('Solicitud no autorizada.');
 const data=locked(()=>{
 const cache=CacheService.getScriptCache();if(cache.get('nonce:'+request.nonce))throw new Error('Solicitud repetida.');cache.put('nonce:'+request.nonce,'1',600);
 const db=readDb();if(!Array.isArray(db.audit))db.audit=[];
 if(request.role==='public'&&['book','waitlist'].includes(request.action)){
 const phone=normalizePhone(request.payload.phone);const key='rate:'+phone+':'+localDate();const count=Number(cache.get(key)||0);if(count>=12)throw new Error('Demasiados intentos. Contactá al taller.');cache.put(key,String(count+1),21600);
 const active=db.appointments.filter(a=>a.clientId===db.clients.find(c=>c.phone===phone)?.id&&['requested','confirmed'].includes(a.status));const retry=db.appointments.some(a=>a.requestId===request.payload.requestId);
 if(request.action==='book'&&active.length>=3&&!retry)throw new Error('Ya tenés varias solicitudes. Contactá al taller.');
 }
 const result=dispatch(db,request.action,request.payload,new Date(),request.role);if(!['catalog','slots','snapshot'].includes(request.action))saveDb(db);return result;
 });return response({ok:true,data});
 }catch(err){console.error(err);return response({ok:false,error:err.message||'Error interno.'});}}
function setup(){locked(()=>{const ss=spreadsheet();for(const name in TABLES){let sh=ss.getSheetByName(name)||ss.insertSheet(name);sh.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]]);sh.setFrozenRows(1);sh.getRange(1,1,1,TABLES[name].length).setFontWeight('bold').setBackground('#d9ead3');}if(ss.getSheetByName('config').getLastRow()<2)saveDb({config:CONFIG,services:SERVICES,clients:[],vehicles:[],appointments:[],history:[],messages:[],waitlist:[],audit:[]});});installTriggers();}
function installTriggers(){for(const t of ScriptApp.getProjectTriggers())if(t.getHandlerFunction()==='scheduledRun')ScriptApp.deleteTrigger(t);ScriptApp.newTrigger('scheduledRun').timeBased().everyMinutes(15).create();}
function scheduledRun(){try{locked(()=>{const db=readDb();if(!Array.isArray(db.audit))db.audit=[];automate(db);saveDb(db);});syncCalendar();notifyQueue();props().setProperty('LAST_RUN',new Date().toISOString());props().deleteProperty('LAST_ERROR');}catch(e){props().setProperty('LAST_ERROR',e.message);console.error(e);}}
/** Calendar is secondary. Sheet slots remain the source of truth. */
function syncCalendar(){const id=props().getProperty('CALENDAR_ID');if(!id)return;const calendar=CalendarApp.getCalendarById(id);if(!calendar)throw new Error('Calendar no accesible.');
 // Lock avoids concurrent trigger reconciliation. Calendar errors never invalidate a booking.
 locked(()=>{const db=readDb();for(const a of db.appointments.filter(a=>['pending','error'].includes(a.syncStatus)).slice(0,20)){
 try{let event=a.eventId?calendar.getEventById(a.eventId):null;
 if(a.status==='confirmed'){
 if(!event)event=calendar.getEvents(new Date(a.start),new Date(a.end)).find(e=>e.getTag('tallerflowId')===a.id||e.getDescription().includes('TF_ID:'+a.id));
 if(!event){const c=db.clients.find(c=>c.id===a.clientId),v=db.vehicles.find(v=>v.id===a.vehicleId),s=db.services.find(s=>s.id===a.serviceId);event=calendar.createEvent(`${s.name} · ${v.plate}`,new Date(a.start),new Date(a.end),{description:`TF_ID:${a.id}\nCliente: ${c.name}\nVehículo: ${v.brand} ${v.model}\nGestionar desde TallerFlow. No mover este evento manualmente.`});event.setTag('tallerflowId',a.id);}a.eventId=event.getId();
 }else if(event){event.deleteEvent();a.eventId='';}a.syncStatus='synced';
 }catch(e){a.syncStatus='error';console.error('Calendar '+a.id+': '+e.message);}}
 saveDb(db);});}
/** Internal digest only: this NEVER marks WhatsApp messages as sent. */
function notifyQueue(){const count=locked(()=>readDb().messages.filter(m=>m.status==='pending').length);if(!count)return;const key=localDate(),last=props().getProperty('DIGEST_DATE');if(last===key)return;
 const url=props().getProperty('DASHBOARD_URL')||'',text=`TallerFlow: hay ${count} mensajes pendientes. Revisá el panel: ${url}`;
 const email=props().getProperty('NOTIFY_EMAIL');if(email)MailApp.sendEmail(email,'TallerFlow · Cola pendiente',text);
 const token=props().getProperty('TELEGRAM_BOT_TOKEN'),chat=props().getProperty('TELEGRAM_CHAT_ID');if(token&&chat){const r=UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chat,text}),muteHttpExceptions:true});if(r.getResponseCode()!==200)throw new Error('Falló aviso Telegram.');}
 if(email||(token&&chat))props().setProperty('DIGEST_DATE',key);
}
function health(){console.log(JSON.stringify({lastRun:props().getProperty('LAST_RUN'),lastError:props().getProperty('LAST_ERROR'),rows:locked(()=>{const d=readDb();return Object.fromEntries(Object.keys(TABLES).filter(k=>k!=='config').map(k=>[k,d[k].length]));})}));}
