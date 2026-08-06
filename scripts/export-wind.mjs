#!/usr/bin/env node
// 風の予報を JSON / CSV で書き出す。
//
// サーバを立てずに中身を確認する用と、Streamlit 側にファイルで渡す用。
// Streamlit からは HTTP（/api/wind.csv）でも読めるので、常時動かすなら
// そちらのほうが手間が少ない。
//
//   node scripts/export-wind.mjs --sample              # JSON を標準出力へ
//   node scripts/export-wind.mjs --sample --csv        # CSV を標準出力へ
//   node scripts/export-wind.mjs --csv -o wind.csv     # ファイルへ
//
// --sample は作り物のデータ。実データには UMITEN_* の設定が要る。

import { writeFile } from 'node:fs/promises';

import { forecastToCsv } from '../src/forecast.mjs';
import { getWindForecast } from '../src/wind.mjs';

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const sample = args.includes('--sample');
const outIndex = Math.max(args.indexOf('-o'), args.indexOf('--out'));
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

let forecast;
try {
  forecast = await getWindForecast({ sample });
} catch (error) {
  console.error(`失敗: ${error?.message ?? error}`);
  process.exit(1);
}

const body = asCsv ? forecastToCsv(forecast) : `${JSON.stringify(forecast, null, 2)}\n`;

if (outPath) {
  await writeFile(outPath, body, 'utf8');
  console.error(
    `${outPath} に書き出しました（地点 ${forecast.stations.length} / 時刻 ${forecast.times.length}）`,
  );
} else {
  process.stdout.write(body);
}
