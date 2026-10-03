import crypto from 'node:crypto';
export const config={maxDuration:60};
const publicActions=new Set(['catalog','slots','book','waitlist']);
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
 async function challenge(){
 if(!process.env.TURNSTILE_SECRET_KEY)throw new Error('Protección antispam no configurada.');
 const v=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:body.challenge||''}),signal:AbortSignal.timeout(10000)}).then(r=>r.json());
 if(!v.success||v.hostname!==new URL(process.env.APP_ORIGIN).hostname||v.action!==action)throw new Error('Verificación antispam fallida. Volvé a intentarlo.');
 }
 if(action==='login'){await challenge();if(!password(payload.password))return res.status(401).json({ok:false,error:'Credenciales incorrectas.'});const data=Buffer.from(JSON.stringify({exp:Date.now()+8*3600000,ver:sign(process.env.ADMIN_PASSWORD_HASH)})).toString('base64url');res.setHeader('Set-Cookie',`tf_session=${data}.${sign(data)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);return res.json({ok:true,data:{authenticated:true}});}
 const role=admin(req)?'admin':'public';
 if(role!=='admin'&&!publicActions.has(action))return res.status(401).json({ok:false,error:'Iniciá sesión para continuar.'});
 if(role==='public'&&['book','waitlist'].includes(action))await challenge();
 const p=JSON.stringify({v:1,action,payload,role,ts:Date.now(),nonce:crypto.randomUUID()});
 const s=crypto.createHmac('sha256',process.env.GAS_SECRET).update('v1\n'+p).digest('hex');
 const result=await fetch(process.env.GAS_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p,s}),redirect:'follow',signal:AbortSignal.timeout(50000)}).then(r=>r.json());
 return res.status(result.ok?200:400).json(result);
 }catch(e){console.error('TallerFlow gateway:',e.name);return res.status(400).json({ok:false,error:e.name==='TimeoutError'?'El servicio demoró demasiado. Reintentá con la misma solicitud.':e.message||'No se pudo procesar la solicitud.'});}
}
