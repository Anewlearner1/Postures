/**
 * 這個檔案做什麼：端到端測試（在 Chromium 裡實際操作網站）：
 *   - 上傳不支援的格式、不是影片的檔案 → 顯示對應的錯誤畫面
 *   - 太短（< 6 秒）的影片 → 擋下並顯示秒數
 *   - 沒有影片直接打開 /analyze、/report → 回到 /upload
 *   - 示範報告頁 /report/sample 可以打開
 *   - （選用）設定 E2E_WALK_VIDEO 時，用真實走路影片跑完整流程：上傳 → 分析 → 報告或請重拍
 */

import path from "node:path";
import { expect, test } from "@playwright/test";

const FIXTURES = path.join(__dirname, "fixtures");

test.describe("上傳前檢查", () => {
  test("不支援的影片格式（AVI）→ 格式無法開啟", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles({
      name: "walk.avi",
      mimeType: "video/x-msvideo",
      buffer: Buffer.from("RIFF0000AVI LIST"),
    });
    await expect(page.getByRole("heading", { name: "這個影片格式無法開啟" })).toBeVisible();
    // 「重新選擇影片」回到選擇畫面
    await page.getByRole("button", { name: "重新選擇影片" }).click();
    await expect(page.getByRole("heading", { name: "選擇一段走路影片" })).toBeVisible();
  });

  test("不是影片的檔案 → 這不是影片檔", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByRole("heading", { name: "這不是影片檔" })).toBeVisible();
  });

  test("副檔名是 MP4 但內容壞掉 → 格式無法開啟或無法播放", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles({
      name: "broken.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("this is not really an mp4 file"),
    });
    await expect(page.getByRole("heading", { name: /這個影片格式無法開啟|這段影片無法播放/ })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("太短的影片（4 秒）→ 影片太短了，並顯示秒數", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").setInputFiles(path.join(FIXTURES, "too-short-4s.mp4"));
    await expect(page.getByRole("heading", { name: "影片太短了" })).toBeVisible();
    await expect(page.getByText("這段影片只有 4 秒")).toBeVisible();
  });
});

test.describe("沒有影片時的導向", () => {
  test("直接打開 /analyze → 回到 /upload", async ({ page }) => {
    await page.goto("/analyze");
    await expect(page).toHaveURL(/\/upload$/);
  });

  test("直接打開 /report → 回到 /upload", async ({ page }) => {
    await page.goto("/report");
    await expect(page).toHaveURL(/\/upload$/);
  });
});

test("示範報告頁可以打開", async ({ page }) => {
  await page.goto("/report/sample");
  await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("這是示範報告（假資料）")).toBeVisible();
  await expect(page.getByRole("heading", { name: "骨架回放" })).toBeVisible();
});

test("真實走路影片：上傳 → 分析 → 報告（需設定 E2E_WALK_VIDEO）", async ({ page }) => {
  const video = process.env.E2E_WALK_VIDEO;
  test.skip(!video, "沒有設定 E2E_WALK_VIDEO，略過");
  test.setTimeout(300_000);

  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.hostname !== "localhost") external.push(request.url());
  });

  await page.goto("/upload");
  await page.getByTestId("video-input").setInputFiles(video!);
  await page.getByLabel("我已年滿 18 歲（必勾）").check();
  await page.getByRole("button", { name: "開始分析" }).click();
  await expect(page).toHaveURL(/\/analyze$/);
  await expect(page.getByText(/找出身體關節位置（\d+\/\d+ 畫面）/)).toBeVisible({ timeout: 60_000 });
  await page.waitForURL(/\/(report|retake\/.+)$/, { timeout: 280_000 });

  if (page.url().endsWith("/report")) {
    await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible();
    await expect(page.getByTestId("replay-video")).toBeVisible();
  }
  // 隱私：分析過程不可以連到本網站以外的地方
  expect(external).toEqual([]);
});
