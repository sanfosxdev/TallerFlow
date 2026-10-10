import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '../../src/ui.jsx';
afterEach(cleanup);
function Harness({onClose}){const[open,setOpen]=useState(true);return <>{open?<Modal title="Prueba" close={()=>{setOpen(false);onClose?.()}}><input data-testid="int"/></Modal>:<span>cerrado</span>}</>}
describe('Modal accesibilidad (#15)',()=>{
 it('tiene rol dialog aria-modal y etiqueta',()=>{
  render(<Modal title="Turno" close={()=>{}}>contenido</Modal>);
  const d=screen.getByRole('dialog');
  expect(d).toHaveAttribute('aria-modal','true');
  expect(d).toHaveAttribute('aria-label','Turno');
 });
 it('mueve el foco dentro del diálogo al abrirse',async()=>{
  render(<Harness/>);
  await waitFor(()=>expect(screen.getByLabelText('Cerrar')).toHaveFocus());
 });
 it('cierra con Escape',async()=>{
  const onClose=vi.fn();
  render(<Modal title="X" close={onClose}>x</Modal>);
  fireEvent.keyDown(document.body,{key:'Escape'});
  expect(onClose).toHaveBeenCalled();
 });
 it('atrapa el foco: Tab desde el último elemento vuelve al primero',async()=>{
  render(<Modal title="Foco" close={()=>{}}><button>a</button><input data-testid="int"/><button id="last">b</button></Modal>);
  const last=screen.getByRole('button',{name:'b'});
  last.focus();
  fireEvent.keyDown(last,{key:'Tab'});
  await waitFor(()=>expect(screen.getByLabelText('Cerrar')).toHaveFocus());
 });
});
