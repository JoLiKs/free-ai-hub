/* Единое хранилище (localStorage с запасным in-memory вариантом для node-тестов). */
import { makeStore } from './util.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
let backing;
try { backing = globalThis.localStorage; backing.getItem('x'); } catch { backing = memoryStorage(); }
export const store = makeStore(backing);
export const makeMemoryStore = () => makeStore(memoryStorage());
