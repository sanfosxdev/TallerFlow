import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{X,CheckCircle2}from'lucide-react';
import{api,DEMO,resetDemo}from'./client.mjs';import{SERVICES,CONFIG}from'./domain.mjs';import './style.css';
import Landing from './Landing.jsx';import Panel from './Panel.jsx';import Booking from './Booking.jsx';
import{Brand}from'./ui.jsx';
function App(){const[page,setPage]=useState(location.hash.startsWith('#panel')?'panel':'home'),[config,setConfig]=useState(CONFIG),[services,setServices]=useState(SERVICES),[booking,setBooking]=useState(null),[toast,setToast]=useState('');
 useEffect(()=>{api('catalog').then(d=>{setConfig(d.config);setServices(d.services)}).catch(e=>setToast(e.message));const f=()=>setPage(location.hash.startsWith('#panel')?'panel':'home');window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(t)}},[toast]);
 return <>{DEMO&&<div className="demo-strip"><span className="live-dot"/> DEMO INTERACTIVA <span>· Datos ficticios. No se envían mensajes.</span><button onClick={resetDemo}>Restablecer demo</button></div>}{page==='home'?<Landing config={config} services={services} reserve={s=>setBooking(s||services[0])}/>:<Panel config={config} services={services} notify={setToast} reserve={()=>setBooking(services[0])}/>}{booking&&<Booking config={config} services={services} initial={booking} close={()=>setBooking(null)} notify={setToast}/>}<div aria-live="polite">{toast&&<div className="toast"><CheckCircle2 size={18}/>{toast}<button onClick={()=>setToast('')}><X size={16}/></button></div>}</div></>;}
createRoot(document.getElementById('root')).render(<App/>);
