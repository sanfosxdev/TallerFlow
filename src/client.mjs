import {seed,dispatch,allowed} from './domain.mjs';
export const DEMO=import.meta.env.VITE_DEMO_MODE!=='false';
const KEY='tallerflow.demo.v1';
function load(){try{const d=JSON.parse(localStorage.getItem(KEY));if(d?.config)return d;}catch{}const d=seed();localStorage.setItem(KEY,JSON.stringify(d));return d;}
export async function api(action,payload={},challenge=''){
 if(DEMO){if(action==='session')return {authenticated:sessionStorage.getItem('tfDemoAdmin')==='yes'};if(action==='login'){sessionStorage.setItem('tfDemoAdmin','yes');return {authenticated:true};}if(action==='logout'){sessionStorage.removeItem('tfDemoAdmin');return {};}
 if(!allowed(action,sessionStorage.getItem('tfDemoAdmin')==='yes'?'admin':'public'))throw new Error('Ingresá al panel primero.');const db=load(),result=dispatch(db,action,payload);if(!['catalog','slots','snapshot'].includes(action))localStorage.setItem(KEY,JSON.stringify(db));return result;}
 const r=await fetch('/api',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload,challenge})});const data=await r.json();if(!data.ok)throw new Error(data.error||'Error de conexión.');return data.data;
}
export function resetDemo(){localStorage.removeItem(KEY);location.reload();}
