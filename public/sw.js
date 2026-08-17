/*
 * マッスルモンスターズ 通知用 Service Worker
 *
 * サーバー不要のプッシュ通知。Periodic Background Sync（定期バックグラウンド同期）で
 * 端末が本アプリを閉じている間も定期的に起き、(1)「超回復して鍛えどきになった部位モンスター」と
 * (2)「超回復ピーク（狙い目）がもうすぐ終わる部位モンスター」を検知してローカル通知を出す。
 * 状態はアプリ本体が IndexedDB に書き出したスナップショットを読む
 * （Service Worker は localStorage を読めないため）。
 *
 * 注意: 対応は主に Chrome / Edge（Android）。iOS/Safari・Firefox は Periodic Background Sync
 * 非対応で、閉じている間の通知は届かない。アプリを開いている/バックグラウンドにした間は
 * message イベント経由の前景チェックで補う。
 */

const DB_NAME = 'mm_notify';
const DB_VERSION = 1;
const PERIODIC_SYNC_TAG = 'mm-recovery-check';
// 超回復ピーク（狙い目）窓の残りがこの割合以下になったら「もうすぐ終了」通知を出す（終盤25%）。
const PEAK_ENDING_FRACTION = 0.25;

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

// 配列からランダムに1件選ぶ（候補が無ければ null）。
function pickOne(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// 2種類の鍛えどき通知を検知して出す。いずれも同じトレ分（lastTrainedAt が同一）につき1回だけ。
//  1) 鍛えどき：回復完了（超回復に到達）した部位。notified ストアのキー m.id で重複防止。
//  2) 狙い目もうすぐ終了：超回復ピーク窓の終盤（残り PEAK_ENDING_FRACTION 以下）に入った部位。
//     こちらはキー `${m.id}:end` で別管理し、鍛えどき通知とは独立に1回だけ出す。
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
  const endingSoon = [];
  for (const m of state.muscles) {
    if (!m.lastTrainedAt) continue;
    const recoveryDoneAt = m.lastTrainedAt + m.recoveryMs;
    if (now < recoveryDoneAt) continue; // まだ回復中

    // 1) 鍛えどき（回復完了）
    const readyNotified = await idbGet(db, 'notified', m.id);
    if (readyNotified !== m.lastTrainedAt) ready.push(m);

    // 2) 狙い目ゲージ残りわずか（ピーク窓の終盤）。peakEndsAt は新しいスナップショットのみ持つ。
    if (typeof m.peakEndsAt === 'number') {
      const windowMs = m.peakEndsAt - recoveryDoneAt; // 狙い目窓の長さ
      const remainingMs = m.peakEndsAt - now; // 窓の残り
      if (windowMs > 0 && remainingMs > 0 && remainingMs <= windowMs * PEAK_ENDING_FRACTION) {
        const endNotified = await idbGet(db, 'notified', m.id + ':end');
        if (endNotified !== m.lastTrainedAt) endingSoon.push(m);
      }
    }
  }
  if (ready.length === 0 && endingSoon.length === 0) return;

  // アプリを見ている最中はOS通知を出さない（既存のアプリ内「狙い目」ゲージ／バッジで十分）。
  // ここで通知済みフラグは立てないので、バックグラウンドに回った次回チェックで改めて通知される。
  if (await anyClientVisible()) return;

  // 通知本文はそのキャラのセリフ。各モンスターが個別に話しかけるので、部位ごとに1通ずつ出す。
  // 旧スナップショット（セリフ無し）でも動くよう、セリフが無ければ従来の定型文にフォールバックする。
  for (const m of ready) {
    await idbPut(db, 'notified', m.id, m.lastTrainedAt);
    const line = pickOne(m.readyLines) || `${m.name} が超回復して鍛えどきに！今トレーニングするとEXPボーナスのチャンス。`;
    await self.registration.showNotification(`💪 ${m.name}が鍛えどき！`, {
      body: line,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: `mm-recovery-${m.id}`,
      renotify: true,
      lang: 'ja',
      data: { url: '/' },
    });
  }

  for (const m of endingSoon) {
    await idbPut(db, 'notified', m.id + ':end', m.lastTrainedAt);
    const line = pickOne(m.endingLines) || `${m.name} の超回復ピークがもうすぐ終了。今のうちに鍛えてEXPボーナスを逃さないで！`;
    await self.registration.showNotification(`⏰ ${m.name}の狙い目が終わりそう！`, {
      body: line,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: `mm-peak-ending-${m.id}`,
      renotify: true,
      lang: 'ja',
      data: { url: '/' },
    });
  }
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
