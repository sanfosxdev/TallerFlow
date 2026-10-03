import crypto from 'node:crypto';
const password=process.env.TF_PASSWORD;if(!password||password.length<12)throw new Error('Definí TF_PASSWORD con al menos 12 caracteres. No lo pases como argumento.');const salt=crypto.randomBytes(16).toString('hex');console.log(salt+':'+crypto.scryptSync(password,salt,64).toString('hex'));
