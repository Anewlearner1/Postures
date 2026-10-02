/**
 * 這個檔案做什麼：
 *   Vitest（單元測試工具）的設定。執行 `npm test` 時會找出所有 `*.test.ts` 檔案並執行。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 讓測試也看得懂 "@/..." 這種路徑（設定在 tsconfig.json）
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
