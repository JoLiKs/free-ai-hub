/* Состояние приложения: настройки, ключи, активный чат. Без обращений к DOM. */
import { store } from './store.js';
import { PROVIDERS, pById } from './providers.js';
import { newChat } from './chats.js';

export const DEFAULT_SETTINGS = {
  provider: 'ovh', models: {}, providerB: 'chat', modelB: '', compare: false,
  system: '', preset: '', temp: 0.7, maxTokens: 0, autoFallback: true, theme: 'dark', cyber: false,
  customUrl: '', customModel: '', tab: 'model', localOk: {}, lastChat: '', proxy: ''
};

export const state = {
  keys: store.get('keys', {}),
  settings: Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {})),
  lists: {},                    // providerId -> {list, source, ts, error?}
  chat: newChat(),              // активный чат (сохраняется при первом сообщении)
  slots: { A: { abort: null, busy: false, status: '' }, B: { abort: null, busy: false, status: '' } }
};
if (!PROVIDERS.some(p => p.id === state.settings.provider)) state.settings.provider = DEFAULT_SETTINGS.provider;
if (!PROVIDERS.some(p => p.id === state.settings.providerB)) state.settings.providerB = DEFAULT_SETTINGS.providerB;
if (!state.settings.models || typeof state.settings.models !== 'object') state.settings.models = {};
if (!state.settings.localOk || typeof state.settings.localOk !== 'object') state.settings.localOk = {};

let saveT;
export function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => store.set('settings', state.settings), 120); }
export function saveSettingsNow() { clearTimeout(saveT); store.set('settings', state.settings); }
export function saveKeys() { store.set('keys', state.keys); }
export const getKey = pid => (state.keys[pid] || '').trim();

export const slotPid = slot => (slot === 'B' ? state.settings.providerB : state.settings.provider);
export const slotProvider = slot => pById(slotPid(slot));
export function slotModel(slot) {
  const p = slotProvider(slot);
  if (slot === 'A') {
    if (p.custom && state.settings.customModel.trim()) return state.settings.customModel.trim();
    return state.settings.models[p.id] || '';
  }
  if (p.custom && !state.settings.modelB && state.settings.customModel.trim()) return state.settings.customModel.trim();
  return state.settings.modelB || '';
}
export function setSlotModel(slot, mid) {
  if (slot === 'A') state.settings.models[state.settings.provider] = mid; else state.settings.modelB = mid;
  saveSettings();
}
export const slotMsgs = slot => (slot === 'B' ? state.chat.msgsB : state.chat.msgs);
export const isBusy = () => state.slots.A.busy || state.slots.B.busy;

export function modelInfo(pid, mid) {
  const l = state.lists[pid];
  return (l && l.list.find(m => m.id === mid)) || null;
}
export function modelLabel(pid, mid) {
  const m = modelInfo(pid, mid);
  return (m && m.label) || mid || '';
}
