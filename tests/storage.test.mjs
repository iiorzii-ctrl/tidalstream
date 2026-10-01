// ブラウザへの保存。触っただけで例外になる環境（埋め込み先・プライベート
// ブラウズなど）でも、呼び出し側が落ちないことを確かめる。
import assert from 'node:assert/strict';
import test from 'node:test';

const { readStored, writeStored, removeStored } = await import('../public/storage.js');

/** localStorage を差し替える。null を渡すと「触ると例外」にする。 */
function withStorage(store) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (store === null) {
        const error = new Error('The operation is insecure.');
        error.name = 'SecurityError';
        throw error;
      }
      return store;
    },
  });
}

function fakeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}

test('使える環境では普通に読み書きできる', () => {
  const store = fakeStore();
  withStorage(store);
  writeStored('a', '1');
  assert.equal(readStored('a'), '1');
  removeStored('a');
  assert.equal(readStored('a'), null);
  assert.equal(store.size(), 0);
});

test('触ると例外になる環境でも落ちない', () => {
  withStorage(null);
  // 読みは null を返す（＝既定値で動く）
  assert.equal(readStored('a'), null);
  // 書きと削除は黙って諦める
  assert.doesNotThrow(() => writeStored('a', '1'));
  assert.doesNotThrow(() => removeStored('a'));
});

test('書き込みだけ拒否される環境でも落ちない', () => {
  // 容量超過やプライベートブラウズで setItem だけ失敗する場合
  withStorage({
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('QuotaExceededError');
    },
  });
  assert.doesNotThrow(() => writeStored('a', '1'));
  assert.doesNotThrow(() => removeStored('a'));
  assert.equal(readStored('a'), null);
});
