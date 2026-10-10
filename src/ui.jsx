import React,{useEffect,useRef} from 'react';
import{X,CalendarDays,Wrench}from'lucide-react';
export const STATUS={requested:'Por confirmar',confirmed:'Confirmado',completed:'Finalizado',cancelled:'Cancelado',no_show:'No asistió',expired:'Vencido'};
// #16: la moneda sale de CONFIG (pestaña config de Sheets en producción), no hardcodeada.
export const money=(config)=>new Intl.NumberFormat('es-AR',{style:'currency',currency:config?.currency||'ARS',maximumFractionDigits:0});
export function Brand(){return <span className="brand"><span className="brand-icon"><Wrench size={19}/></span>Taller<span>Flow</span><span className="brand-dot">®</span></span>}
export function Stat({label,value,hint,icon:Icon,lime}){return <section className={'stat '+(lime?'lime-stat':'')}><div><span>{label}</span><Icon size={19}/></div><strong>{value.toString().padStart(2,'0')}</strong><small>{hint}</small></section>}
export function Empty({text}){return <div className="empty"><CalendarDays size={30}/><p>{text}</p></div>}
export function Modal({title,close,children}){const box=useRef(null);
 useEffect(()=>{const f=e=>{if(e.key==='Escape')close();if(e.key==='Tab'&&box.current){const el=box.current.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])');if(!el.length)return;const first=el[0],last=el[el.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
  document.addEventListener('keydown',f);const prev=document.body.style.overflow;document.body.style.overflow='hidden';
  const t=setTimeout(()=>{if(box.current)box.current.querySelector('button,input,select,textarea,a[href]')?.focus()},0);
  return()=>{clearTimeout(t);document.body.style.overflow=prev;document.removeEventListener('keydown',f)}},[]);
 return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><section ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><span className="eyebrow">TALLERFLOW</span><h2>{title}</h2></div><button aria-label="Cerrar" className="icon-button" onClick={close}><X/></button></div>{children}</section></div>}
// #9 (tests): confirm() con stub en jsdom devuelve undefined; este helper conserva el comportamiento real y lo hace testeable.
export function askConfirm(msg){return window.confirm(msg);}
