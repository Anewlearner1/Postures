/**
 * 這個檔案做什麼：端到端測試「完整流程」（上傳 → 分析中 → 報告／請重拍），不需要真實走路影片。
 *
 *   骨架偵測改用假的背景工作（e2e/helpers/fake-pose-worker.ts）回傳合成走路骨架；
 *   其餘全部是網站的真實程式：讀影片、逐格取畫面、analyzeGait、POST /api/report、報告頁、列印版。
 *
 *   涵蓋：
 *   - 正常步態 → 報告（骨架回放、步數、全部在常見範圍內）
 *   - 有問題的步態 → 問題卡片、回放時間軸標記、列印版的「數據」
 *   - 報告 API 失敗（500、502、429 流量限制、斷線）→ 報告照樣出現，改用標準版說明（SPEC §3 降級方案）
 *   - 模型載入失敗、影片中沒有人 → 對應的請重拍頁
 *   - 分析中取消、分析中點頁首連結（確認視窗）、報告頁重新整理
 *   - 已知問題（test.fixme，見 docs/review/M5-qa.md）：API 沒有回應（逾時）、返回鍵離開報告頁
 */

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { emptyTrack, installFakePoseWorker, syntheticTrack, type FakePoseTrack } from "./helpers/fake-pose-worker";

const VIDEO = path.join(__dirname, "fixtures", "blank-16s-vp9.mp4");
const ANALYSIS_TIMEOUT = 120_000;

async function startAnalysis(page: Page, track: FakePoseTrack, options: { delayMs?: number; failInit?: boolean } = {}) {
  await installFakePoseWorker(page, track, options);
  await page.goto("/upload");
  await page.getByTestId("video-input").setInputFiles(VIDEO);
  await page.getByLabel("我已年滿 18 歲（必勾）").check();
  await page.getByRole("button", { name: "開始分析" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
}

async function waitForOutcome(page: Page) {
  await page.waitForURL(/\/(report|retake\/.+)$/, { timeout: ANALYSIS_TIMEOUT });
}

/** 只在電腦版跑（和畫面寬度無關的流程，避免重複花時間）。 */
function desktopOnly() {
  test.skip(test.info().project.name !== "desktop", "流程與畫面寬度無關，只在電腦版跑");
}

test.describe("完整流程（合成骨架）", () => {
  test.setTimeout(150_000);

  test("正常步態 → 報告：骨架回放、分析步數、全部在常見範圍內、沒有對外連線、沒有 CSP 阻擋", async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
    });
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.hostname !== "localhost") external.push(request.url());
    });
    await startAnalysis(page, syntheticTrack());
    await expect(page.getByText(/找出身體關節位置（\d+\/\d+ 畫面）/)).toBeVisible({ timeout: 30_000 });
    await waitForOutcome(page);

    await expect(page).toHaveURL(/\/report$/);
    await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible();
    await expect(page.getByTestId("replay-video")).toBeAttached();
    await expect(page.getByRole("heading", { name: "骨架回放" })).toBeVisible();
    await expect(page.getByText(/分析了 \d+ 步/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("在常見範圍內").filter({ visible: true }).first()).toBeVisible();
    // 沒有設定 Claude 金鑰時，報告用標準版說明（模板），並告知使用者
    await expect(page.getByText("白話說明目前暫時無法產生").filter({ visible: true }).first()).toBeVisible();
    expect(external).toEqual([]);
    expect(cspViolations).toEqual([]);
  });

  test("有問題的步態 → 問題卡片、時間軸標記、列印版含數據", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, syntheticTrack({ gait: { thighExtDeg: 7, pkfDeg: 42 } }));
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/report$/);

    await expect(page.getByRole("heading", { name: /後腳推蹬不足/ }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /膝蓋彎得較少/ }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("明顯：建議優先練習").filter({ visible: true }).first()).toBeVisible();
    // 回放時間軸上有可以按的問題標記
    await expect(page.getByRole("button", { name: /後腳推蹬不足（\d+:\d{2}）/ }).first()).toBeVisible();

    await page.emulateMedia({ media: "print" });
    const printReport = page.getByTestId("print-report");
    await expect(printReport).toBeVisible();
    await expect(printReport.getByText(/髖部最大後伸：約 -?\d+ 度/)).toBeVisible();
    await expect(printReport.getByText(/產生日期：/).first()).toBeVisible();
  });

  for (const [name, fulfil] of [
    ["伺服器錯誤 500", { status: 500, body: '{"error":"internal_error"}' }],
    ["閘道錯誤 502", { status: 502, body: "bad gateway" }],
  ] as const) {
    test(`報告 API ${name} → 報告照樣出現（標準版說明）`, async ({ page }) => {
      desktopOnly();
      await page.route("**/api/report", (route) =>
        route.fulfill({ status: fulfil.status, body: fulfil.body, contentType: "application/json" }),
      );
      await startAnalysis(page, syntheticTrack());
      await waitForOutcome(page);
      await expect(page).toHaveURL(/\/report$/);
      await expect(page.getByText("白話說明目前暫時無法產生").filter({ visible: true }).first()).toBeVisible();
    });
  }

  test("報告 API 連不上（斷線）→ 瀏覽器自己用模板組報告", async ({ page }) => {
    desktopOnly();
    await page.route("**/api/report", (route) => route.abort("connectionreset"));
    await startAnalysis(page, syntheticTrack());
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/report$/);
    await expect(page.getByText("白話說明目前暫時無法產生").filter({ visible: true }).first()).toBeVisible();
  });

  // M5 資安加上流量限制後，429 改為降級成模板報告（不可以變成「分析中斷了」，否則使用者會失去整份分析結果）
  test("報告 API 回 429（流量限制）→ 報告照樣出現（標準版說明）", async ({ page }) => {
    desktopOnly();
    await page.route("**/api/report", (route) =>
      route.fulfill({ status: 429, body: '{"error":"rate_limited"}', contentType: "application/json", headers: { "Retry-After": "30" } }),
    );
    await startAnalysis(page, syntheticTrack());
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/report$/);
    await expect(page.getByText("白話說明目前暫時無法產生").filter({ visible: true }).first()).toBeVisible();
  });

  // F-02：fetchReport 沒有逾時；手機網路卡住時，畫面永遠停在「撰寫你的報告」。
  test.fixme("F-02 報告 API 沒有回應 → 約 35 秒內應降級為模板報告", async ({ page }) => {
    test.setTimeout(180_000);
    await page.route("**/api/report", () => undefined);
    await startAnalysis(page, syntheticTrack());
    await page.waitForURL(/\/report$/, { timeout: 90_000 });
  });

  test("模型載入失敗 → 無法載入分析工具", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, syntheticTrack(), { failInit: true });
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/retake\/model_load_failed$/);
    await expect(page.getByRole("heading", { name: "無法載入分析工具" })).toBeVisible();
  });

  test("影片中沒有人 → 我們在影片中找不到人", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, emptyTrack());
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/retake\/no_person$/);
    await expect(page.getByRole("heading", { name: "我們在影片中找不到人" })).toBeVisible();
  });

  test("分析中取消 → 先確認，選「繼續分析」留在原頁；確定取消回到上傳頁", async ({ page }) => {
    await startAnalysis(page, syntheticTrack(), { delayMs: 60 });
    await expect(page.getByText(/找出身體關節位置（\d+\/\d+ 畫面）/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "取消分析" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "繼續分析" }).click();
    await expect(page).toHaveURL(/\/analyze$/);

    await page.getByRole("button", { name: "取消分析" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByRole("heading", { name: "選擇一段走路影片" })).toBeVisible();
  });

  test("分析中點頁首連結 → 跳出確認；按取消就留在分析頁", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, syntheticTrack(), { delayMs: 60 });
    await expect(page.getByText(/找出身體關節位置（\d+\/\d+ 畫面）/)).toBeVisible({ timeout: 30_000 });
    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("banner").getByRole("link", { name: "拍攝教學" }).click();
    await expect.poll(() => message).toContain("要取消分析嗎");
    await expect(page).toHaveURL(/\/analyze$/);
  });

  test("報告頁重新整理 → 先跳出離開確認；確定後報告消失、回到上傳頁", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, syntheticTrack());
    await waitForOutcome(page);
    await expect(page).toHaveURL(/\/report$/);
    let type = "";
    page.once("dialog", (dialog) => {
      type = dialog.type();
      void dialog.accept();
    });
    await page.reload();
    await expect(page).toHaveURL(/\/upload$/);
    expect(type).toBe("beforeunload");
  });

  test("報告頁點網站內連結再按返回 → 報告還在", async ({ page }) => {
    desktopOnly();
    await startAnalysis(page, syntheticTrack());
    await waitForOutcome(page);
    await page.getByRole("banner").getByRole("link", { name: "拍攝教學" }).click();
    await expect(page).toHaveURL(/\/guide$/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible();
  });

  // F-03：瀏覽器「返回」會回到 /upload，上傳頁一進來就清掉報告，沒有任何確認（Android 返回鍵很常按到）。
  test.fixme("F-03 報告頁按瀏覽器返回鍵 → 應先確認，或返回後報告仍在", async ({ page }) => {
    await startAnalysis(page, syntheticTrack());
    await waitForOutcome(page);
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible();
  });
});
