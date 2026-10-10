import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import Booking from '../../src/Booking.jsx';
import { CONFIG, SERVICES } from '../../src/domain.mjs';

afterEach(cleanup);
const props=(o={})=>({config:CONFIG,services:SERVICES,initial:SERVICES[0],close:o.close||(()=>{}),notify:o.notify||(()=>{})});

describe('Booking (modo demo)',()=>{
 it('renderiza los DOS checkboxes de consentimiento separados (#8)',async()=>{
  render(<Booking {...props()}/>);
  await waitFor(()=>expect(screen.getByText(/Horarios disponibles/)).toBeInTheDocument());
  expect(screen.getByText(/Autorizo los mensajes de WhatsApp necesarios/)).toBeInTheDocument();
  expect(screen.getByText(/Opcional: quiero recibir avisos de mantenimiento/)).toBeInTheDocument();
 });
 it('el botón queda bloqueado sin horario elegido y habilita al elegir uno',async()=>{
  render(<Booking {...props()}/>);
  const btn=await screen.findByRole('button',{name:/Solicitar turno/});
  await waitFor(()=>expect(screen.queryByText('Cargando horarios…')).not.toBeInTheDocument());
  expect(btn).toBeDisabled();
  fireEvent.click((await screen.findAllByRole('button',{name:/^\d{2}:\d{2}$/}))[0]);
  expect(btn).toBeEnabled();
 });
 it('registra la solicitud en el dominio demo y muestra la referencia',async()=>{
  localStorage.clear();sessionStorage.clear();
  render(<Booking {...props()}/>);
  fireEvent.click((await screen.findAllByRole('button',{name:/^\d{2}:\d{2}$/}))[0]);
  fireEvent.change(screen.getByPlaceholderText('Ej. Andrea Martínez'),{target:{value:'Ana Test'}});
  fireEvent.change(screen.getByPlaceholderText('5491123456789'),{target:{value:'5491100011122'}});
  fireEvent.change(screen.getByPlaceholderText('Volkswagen'),{target:{value:'Ford'}});
  fireEvent.change(screen.getByPlaceholderText('Gol'),{target:{value:'Ka'}});
  fireEvent.change(screen.getByPlaceholderText('2020'),{target:{value:'2019'}});
  fireEvent.change(screen.getByPlaceholderText('AB123CD'),{target:{value:'ZZ999XX'}});
  fireEvent.click(screen.getByText(/Autorizo los mensajes de WhatsApp necesarios/).closest('label').querySelector('input'));
  fireEvent.click(await screen.findByRole('button',{name:/Solicitar turno/}));
  expect(await screen.findByText(/Solicitud recibida/)).toBeInTheDocument();
  expect(screen.getByText(/Referencia: /)).toBeInTheDocument();
 });
});
