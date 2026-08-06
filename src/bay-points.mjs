// 東京湾沿岸の地点名から緯度経度を引くための表。
//
// 予報サイトが返すのは地点の「名前」だけだと思われるため、地図に置くには
// 座標の対応表がこちら側に要る。地図の実装（この HTML でも、あとで作る
// Streamlit でも）はピクセル座標ではなく緯度経度で扱えるようにしておく。
//
// **座標はおおよその値です。** 港域の代表点として置いたもので、測量値では
// ありません。地点が確定したら、海図なり公式の位置なりで確かめてください。

/** 代表点（緯度, 経度）。度の小数表記、測地系は WGS84 のつもり。 */
export const BAY_POINTS = [
  { id: 'tokyo', name: '東京', lat: 35.639, lon: 139.786, aliases: ['東京港', '晴海'] },
  { id: 'haneda', name: '羽田', lat: 35.549, lon: 139.78, aliases: ['羽田沖', '東京国際空港'] },
  { id: 'kawasaki', name: '川崎', lat: 35.5, lon: 139.752, aliases: ['川崎港'] },
  { id: 'yokohama', name: '横浜', lat: 35.452, lon: 139.664, aliases: ['横浜港'] },
  { id: 'yokosuka', name: '横須賀', lat: 35.288, lon: 139.672, aliases: ['横須賀港'] },
  { id: 'kurihama', name: '久里浜', lat: 35.228, lon: 139.717, aliases: [] },
  { id: 'uraga', name: '浦賀水道', lat: 35.233, lon: 139.742, aliases: ['浦賀水道航路', '浦賀'] },
  { id: 'kannonzaki', name: '観音崎', lat: 35.255, lon: 139.744, aliases: [] },
  { id: 'daini-kaiho', name: '第二海堡', lat: 35.29, lon: 139.745, aliases: ['海堡'] },
  { id: 'nakanose', name: '中ノ瀬', lat: 35.383, lon: 139.783, aliases: ['中ノ瀬航路'] },
  { id: 'futtsu', name: '富津', lat: 35.313, lon: 139.787, aliases: ['富津岬'] },
  { id: 'kisarazu', name: '木更津', lat: 35.383, lon: 139.917, aliases: ['木更津港'] },
  { id: 'ichihara', name: '市原', lat: 35.51, lon: 140.077, aliases: ['五井', '姉崎'] },
  { id: 'chiba', name: '千葉', lat: 35.573, lon: 140.055, aliases: ['千葉港'] },
  { id: 'funabashi', name: '船橋', lat: 35.677, lon: 139.996, aliases: ['船橋港'] },
  { id: 'tateyama', name: '館山', lat: 34.988, lon: 139.842, aliases: ['館山港', '館山湾'] },
  { id: 'sunosaki', name: '洲埼', lat: 34.987, lon: 139.756, aliases: ['洲崎'] },
  { id: 'tsurugisaki', name: '剱埼', lat: 35.146, lon: 139.681, aliases: ['剣崎', '剱崎'] },
];

/** 東京湾のだいたいの範囲。地図の初期表示と、座標の妥当性の確認に使う。 */
export const BAY_BOUNDS = { south: 34.9, north: 35.72, west: 139.6, east: 140.15 };

/**
 * 地点名から座標を引く。
 *
 * 上流の表記ゆれ（全角・空白・「港」「沖」などの接尾辞）を吸収する。
 * 見つからない場合は null を返し、呼び出し側で「座標不明」として扱う
 * （地図には出せないが一覧には出せる、という状態を作れるようにするため）。
 */
export function lookupPoint(rawName) {
  const name = normalizeName(rawName);
  if (!name) return null;

  for (const candidate of nameCandidates(name)) {
    for (const point of BAY_POINTS) {
      const known = [point.name, point.id, ...point.aliases].map(normalizeName);
      if (known.includes(candidate)) return point;
    }
  }
  return null;
}

/** 比較用に表記を揃える（全角→半角、空白と中黒を落とす） */
export function normalizeName(rawName) {
  return String(rawName ?? '')
    .normalize('NFKC')
    .replace(/[\s　・]/g, '')
    .trim();
}

/** 「横浜港沖」→「横浜港沖」「横浜港」「横浜」の順に試す */
function* nameCandidates(name) {
  yield name;
  let current = name;
  // 長い接尾辞から削る。1文字ずつ削ると「港」の前の「浜」まで消えてしまう。
  const suffixes = ['付近', '航路', '灯台', 'ブイ', '地区', '沖', '港', '沿岸', '湾'];
  let changed = true;
  while (changed && current.length > 1) {
    changed = false;
    for (const suffix of suffixes) {
      if (current.length > suffix.length && current.endsWith(suffix)) {
        current = current.slice(0, -suffix.length);
        yield current;
        changed = true;
        break;
      }
    }
  }
}

export function isInBay({ lat, lon }) {
  return (
    lat >= BAY_BOUNDS.south && lat <= BAY_BOUNDS.north && lon >= BAY_BOUNDS.west && lon <= BAY_BOUNDS.east
  );
}
