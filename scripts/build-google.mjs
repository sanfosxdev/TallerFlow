import fs from 'node:fs';
const source=fs.readFileSync('src/domain.mjs','utf8').replace(/^export /gm,'');
fs.writeFileSync('google/Domain.gs','/** Generated from src/domain.mjs; do not edit directly. */\n'+source);
console.log('Generated google/Domain.gs');
