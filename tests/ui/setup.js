import '@testing-library/jest-dom/vitest';
class LS{#m=new Map();getItem(k){return this.#m.has(k)?this.#m.get(k):null}setItem(k,v){this.#m.set(k,String(v))}removeItem(k){this.#m.delete(k)}clear(){this.#m.clear()}}
for(const k of ['localStorage','sessionStorage'])Object.defineProperty(globalThis,k,{value:new LS(),configurable:true});
if(!window.matchMedia)window.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){}});
