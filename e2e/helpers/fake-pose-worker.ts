/**
 * 這個檔案做什麼：
 *   端到端測試用的「假骨架偵測器」：還沒有真實的側面走路影片時，用合成骨架跑完整流程
 *   （上傳 → 分析中 → 報告／請重拍）。
 *
 *   做法：
 *   - 用 src/lib/gait/testing/synthetic.ts 產生一段合成走路的逐格骨架（正規化座標）。
 *   - 攔截瀏覽器載入「骨架偵測背景工作」（Turbopack 的 turbopack-worker-*.js）的請求，
 *     換成一段小程式：收到 init 就回 ready；收到 detect 就依時間戳回傳對應那一格的合成骨架。
 *   - 其餘流程（讀影片、逐格取畫面、analyzeGait、POST /api/report、報告頁）都是網站的真實程式。
 *
 *   搭配的影片只要長度足夠（例如 e2e/fixtures/blank-16s-vp9.mp4，16 秒、30 fps 的單色畫面），
 *   畫面內容不重要。
 */

import type { BrowserContext, Page } from "@playwright/test";
import type { Landmark } from "../../src/lib/gait/types";
import { generateWalk, type SyntheticOptions } from "../../src/lib/gait/testing/synthetic";

/** 合成骨架：每一格的關鍵點（沒有人時為 null），以 fps 取樣。 */
export interface FakePoseTrack {
  fps: number;
  frames: Array<Landmark[] | null>;
}

/** 產生一段合成走路（預設：3 趟、30 fps、輕微雜訊，約 15.5 秒）。 */
export function syntheticTrack(options: SyntheticOptions = {}): FakePoseTrack {
  const sim = generateWalk({ passes: 3, noisePx: 1.5, fps: 30, ...options });
  const fps = sim.meta.fps;
  const frames: Array<Landmark[] | null> = [];
  for (const frame of sim.frames) frames[frame.frameIndex] = frame.landmarks;
  return { fps, frames: Array.from(frames, (landmarks) => landmarks ?? null) };
}

/** 完全沒有人的骨架（每格都回 null）。 */
export function emptyTrack(seconds = 20, fps = 30): FakePoseTrack {
  return { fps, frames: Array.from({ length: Math.ceil(seconds * fps) + 1 }, () => null) };
}

function round(landmarks: Landmark[] | null) {
  if (!landmarks) return null;
  return landmarks.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(4), +p.visibility.toFixed(3)]);
}

/** 假背景工作的程式碼（在瀏覽器的 Worker 裡執行）。 */
function workerSource(track: FakePoseTrack, options: { failInit?: boolean; delayMs?: number }): string {
  const data = JSON.stringify(track.frames.map(round));
  return `
const FPS = ${track.fps};
const FRAMES = ${data};
const FAIL_INIT = ${options.failInit ? "true" : "false"};
const DELAY_MS = ${options.delayMs ?? 0};
self.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "init") {
    if (FAIL_INIT) { self.postMessage({ type: "init-error", stage: "model", message: "fake model failure" }); return; }
    self.postMessage({ type: "model-progress", loadedBytes: 1, totalBytes: 1 });
    self.postMessage({ type: "ready", delegate: "CPU", loadMs: 1 });
  } else if (m.type === "detect") {
    try { m.bitmap && m.bitmap.close && m.bitmap.close(); } catch (e) {}
    const row = FRAMES[Math.round((m.timestampMs / 1000) * FPS)];
    const landmarks = row ? row.map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] })) : null;
    const reply = () => self.postMessage({ type: "result", id: m.id, landmarks, inferenceMs: 1 });
    if (DELAY_MS > 0) setTimeout(reply, DELAY_MS); else reply();
  } else if (m.type === "close") {
    self.close();
  }
});
`;
}

/**
 * 讓這個分頁（或整個瀏覽器環境）的骨架偵測改用假的背景工作。
 * failInit：模擬模型載入失敗；delayMs：每格偵測延遲（模擬慢手機，方便測取消）。
 */
export async function installFakePoseWorker(
  target: Page | BrowserContext,
  track: FakePoseTrack,
  options: { failInit?: boolean; delayMs?: number } = {},
): Promise<void> {
  const body = workerSource(track, options);
  const context = "context" in target ? target.context() : target;
  await context.route(/\/_next\/static\/chunks\/turbopack-worker-[^/]*\.js/, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body }),
  );
}
