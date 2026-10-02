/**
 * 這個檔案做什麼：端到端測試「上傳前檢查」的邊界情況（M5 品質驗證，補充 upload-flow.spec.ts）：
 *   - 0 位元組的檔案、超過 200 MB 的檔案（稀疏檔，不佔硬碟）
 *   - 剛好 6 秒以上可以分析；超過 30 秒只分析前 20 秒並提示
 *   - 副檔名大寫、瀏覽器不知道類型（部分 Android）的 MOV
 *   - 直式影片的預覽比例
 *   - 已知問題（test.fixme）：5.9 秒被擋下，文案卻寫「只有 6 秒」
 *
 * 測試影片都是 VP9 編碼（Playwright 內建的 Chromium 不支援 H.264），畫面是單色，只有長度、比例不同。
 */

import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("上傳前檢查：邊界情況", () => {
  test("0 位元組的 MP4 → 格式無法開啟（不會卡在檢查中）", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles({ name: "empty.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(0) });
    await expect(page.getByRole("heading", { name: /這個影片格式無法開啟|這段影片無法播放/ })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("超過 200 MB → 影片檔案太大了", async ({ page }) => {
    // 放在系統暫存資料夾（路徑含中文時 Chromium 讀大檔會失敗）
    const dir = await mkdtemp(path.join(tmpdir(), "postures-e2e-"));
    const file = path.join(dir, "huge.mp4");
    const handle = await open(file, "w");
    await handle.truncate(201 * 1024 * 1024); // 稀疏檔：大小 201 MB，不實際佔用硬碟
    await handle.close();
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(file);
    await expect(page.getByRole("heading", { name: "影片檔案太大了" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "重新選擇影片" }).click();
    await expect(page.getByRole("heading", { name: "選擇一段走路影片" })).toBeVisible();
    await rm(dir, { recursive: true, force: true });
  });

  test("超過 30 秒 → 可以分析，提示只分析前 20 秒", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "blank-31s-vp9.mp4"));
    await expect(page.getByRole("heading", { name: "確認影片" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("video-summary")).toContainText("31 秒");
    await expect(page.getByRole("note")).toContainText("只分析前 20 秒");
    // 必勾年滿 18 歲才能開始
    await expect(page.getByRole("button", { name: "開始分析" })).toBeDisabled();
    await page.getByLabel("我已年滿 18 歲（必勾）").check();
    await expect(page.getByRole("button", { name: "開始分析" })).toBeEnabled();
  });

  test("副檔名大寫、瀏覽器不知道類型的 .MOV → 照樣可以讀取", async ({ page }) => {
    await page.goto("/upload");
    const { readFile } = await import("node:fs/promises");
    await page.getByTestId("video-input").setInputFiles({
      name: "IMG_0001.MOV",
      mimeType: "application/octet-stream",
      buffer: await readFile(path.join(FIXTURES, "blank-16s-vp9.mp4")),
    });
    await expect(page.getByRole("heading", { name: "確認影片" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("video-summary")).toContainText("IMG_0001.MOV・16 秒");
  });

  test("直式影片 → 預覽保持直式比例、不超出畫面", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "blank-16s-portrait-vp9.mp4"));
    await expect(page.getByRole("heading", { name: "確認影片" })).toBeVisible({ timeout: 20_000 });
    const box = await page.locator("main video").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(box!.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("重新選擇影片：換一支影片後，摘要跟著更新", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "blank-16s-vp9.mp4"));
    await expect(page.getByTestId("video-summary")).toContainText("16 秒", { timeout: 20_000 });
    await page.getByRole("button", { name: "重新選擇", exact: true }).click();
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "blank-31s-vp9.mp4"));
    await expect(page.getByTestId("video-summary")).toContainText("31 秒", { timeout: 20_000 });
  });

  // F-07：5.9 秒四捨五入成「6 秒」，但下限就是 6 秒，使用者會看不懂為什麼被擋。
  test.fixme("F-07 5.9 秒的影片被擋下時，文案不應寫「只有 6 秒」", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "blank-5_9s-vp9.mp4"));
    await expect(page.getByRole("heading", { name: "影片太短了" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("這段影片只有 6 秒")).toHaveCount(0);
  });
});
