// ブラウザへの保存。
//
// localStorage は「使えないことがある」だけでなく、**触っただけで例外になる**。
// プライベートブラウズ、サイトデータを拒否する設定、そして他サイトに埋め込まれて
// third-party 扱いになった場合（iPad の Safari が既定でこれ）。
// 素で呼ぶとモジュールの読み込みごと失敗して画面が真っ白になるので、
// 読み書きは必ずここを通す。保存できなくても表示は続けられる作りにしてある。

export function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えておけないだけで、今の操作は続けられる
  }
}

export function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 同上
  }
}
