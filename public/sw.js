/*
 * マッスルモンスターズ 通知用 Service Worker
 *
 * サーバー不要のプッシュ通知。Periodic Background Sync（定期バックグラウンド同期）で
 * 端末が本アプリを閉じている間も定期的に起き、「超回復して鍛えどきになった部位モンスター」を
 * 検知してローカル通知を出す。状態はアプリ本体が IndexedDB に書き出したスナップショットを読む
 * （Service Worker は localStorage を読めないため）。
 *
 * 注意: 対応は主に Chrome / Edge（Android）。iOS/Safari・Firefox は Periodic Background Sync
 * 非対応で、閉じている間の通知は届かない。アプリを開いている/バックグラウンドにした間は
 * message イベント経由の前景チェックで補う。
 */

const DB_NAME = 'mm_notify';
const DB_VERSION = 1;
const PERIODIC_SYNC_TAG = 'mm-recovery-check';

// アプリ本体（App.tsx の openNotifyDb）と同じスキーマで開く。onupgradeneeded の内容は両者で一致させること。
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('notified')) db.createObjectStore('notified');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, store, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// アプリを表示中（フォーカス or 可視）のウィンドウがあるか。表示中はOS通知を出さずアプリ内表示に任せる。
async function anyClientVisible() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.some((c) => c.focused || c.visibilityState === 'visible');
}

// 鍛えどき（超回復＝回復時間を経過して回復完了）になった部位を検知し通知する。
// 同じトレーニング分（lastTrainedAt が同一）につき1回だけ通知する（notified ストアで重複防止）。
async function runCheck() {
  let db;
  try {
    db = await openDb();
  } catch {
    return;
  }

  const state = await idbGet(db, 'state', 'current');
  if (!state || !Array.isArray(state.muscles)) return;

  const now = Date.now();
  const ready = [];
  for (const m of state.muscles) {
    if (!m.lastTrainedAt) continue;
    if (now - m.lastTrainedAt < m.recoveryMs) continue; // まだ回復中
    const already = await idbGet(db, 'notified', m.id);
    if (already === m.lastTrainedAt) continue; // このトレ分は通知済み
    ready.push(m);
  }
  if (ready.length === 0) return;

  // アプリを見ている最中はOS通知を出さない（既存のアプリ内「狙い目」バッジで十分）。
  // ここで通知済みフラグは立てないので、バックグラウンドに回った次回チェックで改めて通知される。
  if (await anyClientVisible()) return;

  for (const m of ready) await idbPut(db, 'notified', m.id, m.lastTrainedAt);

  const names = ready.map((m) => m.name);
  const head = names.slice(0, 2).join('・');
  const more = names.length > 2 ? ` ほか${names.length - 2}体` : '';
  const title = '💪 鍛えどきだ！';
  const body = `${head}${more} が超回復して鍛えどきに！今トレーニングするとEXPボーナスのチャンス。`;

  await self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'mm-recovery',
    renotify: true,
    lang: 'ja',
    data: { url: '/' },
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('periodicsync', (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) event.waitUntil(runCheck());
});

// アプリ（前景）からの手動チェック要求。バックグラウンドタブに回ったときなどの補助。
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'check') event.waitUntil(runCheck());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })(),
  );
});
