#!/usr/bin/env node
/**
 * 這個檔案做什麼：
 *   把骨架偵測需要的兩樣東西放進 public/mediapipe/，讓網站「自己提供」這些檔案，
 *   使用者的瀏覽器不必在執行時連到 Google 的伺服器下載（隱私說法「影片只在你的裝置上分析」才成立）。
 *
 *   1. WASM 執行檔：從已安裝的 npm 套件 @mediapipe/tasks-vision 複製（版本與程式一致）。
 *   2. 姿態模型 pose_landmarker_full.task（約 9 MB）：從 Google 官方模型庫下載一次，並核對 SHA-256。
 *
 *   這兩樣檔案很大，不放進 Git（public/mediapipe/.gitignore）；執行 `npm run dev`、`npm run build`
 *   前會自動跑這支程式（package.json 的 predev／prebuild），已經存在且正確就直接跳過。
 *
 *   手動執行：npm run mediapipe:fetch
 *   強制重新下載：npm run mediapipe:fetch -- --force
 *   --soft：失敗時只警告、不中斷（npm run dev 使用；npm run build 失敗就中斷，避免上線的網站缺模型）。
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "mediapipe");
const WASM_SRC = path.join(ROOT, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const WASM_OUT = path.join(OUT_DIR, "wasm");

/**
 * 只複製一般版（非 ES 模組版）的 WASM：Next.js（Turbopack）打包出的 Web Worker 是傳統 worker，
 * MediaPipe 會用 importScripts 載入（見 src/lib/pose/pose.worker.ts）。
 * 這個版本使用 WASM SIMD；Next.js 16 支援的瀏覽器（Chrome 111+、Safari 16.4+）都支援，
 * 所以不複製給舊瀏覽器用的 nosimd 版本（省 11 MB）。
 */
const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

/** 姿態模型：full 版（gait-rules.md §1.1：不用 lite；heavy 在手機上太慢）。固定版本 1 並核對雜湊值。 */
const MODEL = {
  file: "pose_landmarker_full.task",
  url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
};

const force = process.argv.includes("--force");
const soft = process.argv.includes("--soft");

async function sha256Of(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  await mkdir(WASM_OUT, { recursive: true });
  for (const name of WASM_FILES) {
    const src = path.join(WASM_SRC, name);
    const dest = path.join(WASM_OUT, name);
    if (!(await exists(src))) {
      throw new Error(`找不到 ${src}。請先執行 npm install。`);
    }
    const same = !force && (await exists(dest)) && (await sha256Of(src)) === (await sha256Of(dest));
    if (!same) await copyFile(src, dest);
  }
  console.log(`[mediapipe] WASM 已就緒：public/mediapipe/wasm/（${WASM_FILES.length} 個檔案）`);
}

async function fetchModel() {
  const dest = path.join(OUT_DIR, MODEL.file);
  if (!force && (await exists(dest)) && (await sha256Of(dest)) === MODEL.sha256) {
    console.log(`[mediapipe] 模型已存在且雜湊值正確：public/mediapipe/${MODEL.file}`);
    return;
  }
  console.log(`[mediapipe] 下載模型：${MODEL.url}`);
  const response = await fetch(MODEL.url);
  if (!response.ok) throw new Error(`下載模型失敗（HTTP ${response.status}）`);
  const data = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== MODEL.sha256) {
    throw new Error(`模型雜湊值不符（預期 ${MODEL.sha256}，實際 ${hash}），已停止。`);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const tmp = `${dest}.download`;
  await writeFile(tmp, data);
  await rename(tmp, dest);
  console.log(`[mediapipe] 模型已下載：public/mediapipe/${MODEL.file}（${(data.length / 1024 / 1024).toFixed(1)} MB）`);
}

try {
  await copyWasm();
  await fetchModel();
} catch (error) {
  console.error(`[mediapipe] ${error instanceof Error ? error.message : error}`);
  console.error("[mediapipe] 沒有這些檔案時，「開始分析」會顯示「無法載入分析工具」。請確認網路後執行 npm run mediapipe:fetch。");
  process.exitCode = soft ? 0 : 1;
}
