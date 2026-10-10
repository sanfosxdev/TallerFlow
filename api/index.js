import crypto from 'node:crypto';
export const config={maxDuration:60};
const publicActions=new Set(['catalog','slots','book','waitlist']);
// Rate-limit de login en memoria por instancia (aproximación sin estado externo): 10 intentos / ventana de sliding de 15 min por IP.
const LOGIN_WINDOW_MS=15*60*1000,LOGIN_MAX=10;const loginHits=new Map();let loginLastSweep=Date.now();
function clientIp(req){const fwd=req.headers['x-forwarded-for']||'';return String(fwd.split(',')[0]).trim()||req.socket?.remoteAddress||'unknown';}
function tooManyLogins(req){const now=Date.now(),ip=clientIp(req);if(now-loginLastSweep>LOGIN_WINDOW_MS){for(const [k,v] of loginHits)if(v.every(t=>now-t>LOGIN_WINDOW_MS))loginHits.delete(k);loginLastSweep=now;}
 const hits=(loginHits.get(ip)||[]).filter(t=>now-t<LOGIN_WINDOW_MS);if(hits.length>=LOGIN_MAX)return true;hits.push(now);loginHits.set(ip,hits);return false;}
function cookie(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i).trim(),v.slice(i+1)];}));}
function sign(s){return crypto.createHmac('sha256',process.env.SESSION_SECRET).update(s).digest('hex');}
function safe(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function admin(req){const t=cookie(req).tf_session||'',i=t.lastIndexOf('.');if(i<0)return false;const data=t.slice(0,i);if(!safe(sign(data),t.slice(i+1)))return false;try{const s=JSON.parse(Buffer.from(data,'base64url').toString());return s.exp>Date.now()&&s.ver===sign(process.env.ADMIN_PASSWORD_HASH);}catch{return false;}}
function password(p){const [salt,hash]=(process.env.ADMIN_PASSWORD_HASH||'').split(':');if(!salt||!hash||typeof p!=='string'||p.length>200)return false;return safe(crypto.scryptSync(p,salt,64).toString('hex'),hash);}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Usá POST.'});
 if(!process.env.APP_ORIGIN||!process.env.SESSION_SECRET||!process.env.GAS_SECRET||!process.env.GAS_URL)return res.status(503).json({ok:false,error:'Integración aún no configurada.'});
 if(req.headers.origin!==process.env.APP_ORIGIN)return res.status(403).json({ok:false,error:'Origen no permitido.'});
 try{
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
 if(JSON.stringify(body).length>10000)return res.status(413).json({ok:false,error:'Solicitud demasiado grande.'});
 const {action,payload={}}=body;
 if(action==='logout'){res.setHeader('Set-Cookie','tf_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return res.json({ok:true,data:{}});}
 if(action==='session')return res.json({ok:true,data:{authenticated:admin(req)}});
 // #23 Observabilidad: ping del scheduler. Sin secreto: expone sólo estado/antigüedad (no filas ni datos personales).
 if(action==='ping'){const r=await fetch(`${process.env.GAS_URL}?action=ping`,{redirect:'follow',signal:AbortSignal.timeout(10000)}).then(async x=>{const t=await x.text();try{return JSON.parse(t);}catch{throw new Error(`El backend respondió de forma inesperada (HTTP ${x.status}). Revisá el despliegue de Apps Script.`);}}).catch(e=>{if(e.name==='TimeoutError')throw new Error('El backend no respondió al ping a tiempo.');throw e;});return res.status(r.ok?200:400).json(r);}
 async function challenge(){
 if(!process.env.TURNSTILE_SECRET_KEY)throw new Error('Protección antispam no configurada.');
 const v=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:body.challenge||''}),signal:AbortSignal.timeout(10000)}).then(r=>r.json());
 if(!v.success||v.hostname!==new URL(process.env.APP_ORIGIN).hostname||v.action!==action)throw new Error('Verificación antispam fallida. Volvé a intentarlo.');
 }
 if(action==='login'){if(tooManyLogins(req))return res.status(429).json({ok:false,error:'Demasiados intentos de acceso. Esperá unos minutos antes de reintentar.'});await challenge();if(!password(payload.password))return res.status(401).json({ok:false,error:'Credenciales incorrectas.'});const data=Buffer.from(JSON.stringify({exp:Date.now()+8*3600000,ver:sign(process.env.ADMIN_PASSWORD_HASH)})).toString('base64url');res.setHeader('Set-Cookie',`tf_session=${data}.${sign(data)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);return res.json({ok:true,data:{authenticated:true}});}
 const role=admin(req)?'admin':'public';
 if(role!=='admin'&&!publicActions.has(action))return res.status(401).json({ok:false,error:'Iniciá sesión para continuar.'});
 if(role==='public'&&['book','waitlist'].includes(action))await challenge();
 const p=JSON.stringify({v:1,action,payload,role,ts:Date.now(),nonce:crypto.randomUUID()});
 const s=crypto.createHmac('sha256',process.env.GAS_SECRET).update('v1\n'+p).digest('hex');
 const result=await fetch(process.env.GAS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p,s}),redirect:'follow',signal:AbortSignal.timeout(50000)}).then(async r=>{const text=await r.text();try{return JSON.parse(text);}catch{throw new Error(`El backend respondió de forma inesperada (HTTP ${r.status}). Revisá el despliegue de Apps Script.`);}});
 return res.status(result.ok?200:400).json(result);
 }catch(e){console.error('TallerFlow gateway:',e.name||e.message);return res.status(400).json({ok:false,error:e.name==='TimeoutError'?'El servicio demoró demasiado. Reintentá con la misma solicitud.':e.message||'No se pudo procesar la solicitud.'});}
}
