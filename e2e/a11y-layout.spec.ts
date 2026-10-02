/**
 * 這個檔案做什麼：端到端測試「基本無障礙與版面」（M5 品質驗證），所有頁面在手機與電腦版各跑一次：
 *   - <html lang="zh-Hant">、每頁有標題與唯一一個看得到的 h1
 *   - 沒有橫向捲動（中文長句、按鈕列在窄螢幕不溢出；另外測 320px 的小手機）
 *   - 按鈕與連結都有名稱（螢幕閱讀器念得出來）
 *   - 不認得的錯誤代碼 /retake/xxx → 404「找不到這個頁面」
 *   - 鍵盤：上傳頁可以用 Tab 走到「選擇影片」並用空白鍵打開檔案選擇
 *   - M5 QA 已修正：選擇影片的焦點框（F-10）、橘色文字對比（F-11）
 */

import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/",
  "/guide",
  "/upload",
  "/privacy",
  "/disclaimer",
  "/report/sample",
  "/retake/no_person",
  "/retake/not_side_view",
  "/retake/low_fps_reject",
  "/retake/browser_unsupported",
];

async function ready(page: Page, url: string) {
  await page.goto(url);
  if (url === "/report/sample") {
    await expect(page.getByRole("heading", { name: "你的走路分析報告" })).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.locator("main h1").first()).toBeVisible();
  }
}

test.describe("基本無障礙與版面", () => {
  for (const url of PAGES) {
    test(`${url}：語言、標題、h1、按鈕名稱、沒有橫向捲動`, async ({ page }) => {
      await ready(page, url);
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
      expect((await page.title()).length).toBeGreaterThan(0);
      await expect(page.locator("h1").filter({ visible: true })).toHaveCount(1);

      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) out.push(`橫向溢出 ${de.scrollWidth}>${de.clientWidth}`);
        for (const el of document.querySelectorAll("button, a[href]")) {
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("title") ?? "").trim();
          if (!name && !el.getAttribute("aria-labelledby")) out.push(`沒有名稱：${el.outerHTML.slice(0, 80)}`);
        }
        for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push(`圖片沒有 alt：${img.src}`);
        return out;
      });
      expect(problems).toEqual([]);
    });
  }

  test("320px 小手機：主要頁面都沒有橫向捲動", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "只在手機版");
    await page.setViewportSize({ width: 320, height: 640 });
    for (const url of PAGES) {
      await ready(page, url);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
  });

  test("不認得的錯誤代碼 → 404 找不到這個頁面", async ({ page }) => {
    const response = await page.goto("/retake/unknown_code");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "找不到這個頁面" })).toBeVisible();
    const upper = await page.goto("/retake/NO_PERSON");
    expect(upper?.status()).toBe(404);
  });

  test("鍵盤：Tab 走得到「選擇影片」，空白鍵打開檔案選擇", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "鍵盤操作只在電腦版");
    await page.goto("/upload");
    const input = page.getByTestId("video-input");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await input.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(input).toBeFocused();
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Space");
    await chooser;
  });

  // F-10：檔案輸入框是 sr-only（1×1 像素），框線畫在看不到的元素上；外面的大框（label）沒有 focus 樣式，
  // 鍵盤使用者 Tab 到這裡時畫面上看不出焦點在哪。
  test("F-10 Tab 到「選擇影片」時，畫面上看得到焦點框", async ({ page }) => {
    await page.goto("/upload");
    await page.getByTestId("video-input").focus();
    const visibleRing = await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (!label) return false;
      const s = getComputedStyle(label);
      return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    });
    expect(visibleRing).toBe(true);
  });

  // F-11：輕度的橘色（sev-mild，#B7791F）在白底上對比 3.6:1，低於 WCAG AA 的 4.5:1
  // （示範報告標語、嚴重度「輕度：可以留意」、「僅供參考」）。
  test("F-11 示範報告的「這是示範報告（假資料）」文字對比 ≥ 4.5:1", async ({ page }) => {
    await page.goto("/report/sample");
    const banner = page.getByText("這是示範報告（假資料）").filter({ visible: true }).first();
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const ratio = await banner.evaluate((el) => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
      const fg = lum(parse(getComputedStyle(el).color));
      return (1 + 0.05) / (fg + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
