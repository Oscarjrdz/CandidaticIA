import fs from 'fs';
// cargar REDIS_URL antes de importar storage
const env = fs.readFileSync('.env.prod.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)="?([^"]*)"?$/); if(m) process.env[m[1]]=m[2]; }
const { updateCandidate, saveCandidate, getCandidateById } = await import('./api/utils/storage.js');
import('ioredis');
const Redis = (await import('ioredis')).default;
const r = new Redis(process.env.REDIS_URL, { tls: process.env.REDIS_URL.startsWith('rediss://')?{}:undefined });

const id = 'cand_TESTLEIDO_'+Date.now();
const now = new Date().toISOString();
// Crear candidato NO-LEIDO: lastUserMessageAt reciente, sin lastHumanMessageAt
await saveCandidate({ id, whatsapp:'5210000000000', nombre:'Test Leido', tags:['YAGEO SAN NICOLAS ANUNCIO'],
  paso2Estado:'completo', lastUserMessageAt: now, unreadMsgCount: 3, createdAt: now });
await r.sadd('candidates:unread', id);

console.log('ANTES:');
console.log('  en candidates:unread?', await r.sismember('candidates:unread', id));
let c = await getCandidateById(id);
console.log('  unreadMsgCount:', c.unreadMsgCount, '| lastUser:', c.lastUserMessageAt, '| lastHuman:', c.lastHumanMessageAt||'(none)');

// ==== OPERACION EXACTA DEL NODO accion_marcar_leido ====
const nowStr = new Date(Date.now()+1000).toISOString(); // 1s después para asegurar human > user
await updateCandidate(id, { unreadMsgCount: 0, lastHumanMessageAt: nowStr });

console.log('\nDESPUES (marcar_leido):');
const inSet = await r.sismember('candidates:unread', id);
console.log('  en candidates:unread?', inSet);
c = await getCandidateById(id);
console.log('  unreadMsgCount:', c.unreadMsgCount, '| lastHuman:', c.lastHumanMessageAt);
const isUnread = (new Date(c.lastUserMessageAt||0).getTime()) > (new Date(c.lastHumanMessageAt||0).getTime());
console.log('  isUnread (timestamps)?', isUnread);
console.log('\n', (inSet===0 && c.unreadMsgCount===0 && !isUnread) ? '✅ EL NODO LIMPIA EL NO-LEIDO EN LA UI' : '❌ NO LIMPIA');

// limpiar
await r.del(`candidate:${id}`, id); await r.srem('candidates:unread', id);
await r.quit();
