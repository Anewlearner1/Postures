/**
 * 這個檔案做什麼：
 *   P8 隱私權說明（網址：/privacy）。目前是佔位頁，只放已確定的隱私說法
 *   （docs/spec/ux-flow-and-copy.md §2.0「隱私標語」、SPEC D12、D18、D19）。
 *   正式條文【需法律審閱】後再補上。
 */

import type { Metadata } from "next";
import { PageContainer } from "@/components/ui/PageContainer";
import { PRIVACY_COPY } from "@/data/site";

export const metadata: Metadata = { title: "隱私權說明" };

export default function PrivacyPage() {
  return (
    <PageContainer width="narrow" className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">隱私權說明</h1>
      <p className="rounded-lg border-2 border-dashed border-line px-3 py-2 text-sm text-muted">
        草稿：完整的隱私權說明將在法律審閱後補上。
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">你的影片不會上傳</h2>
        <p>{PRIVACY_COPY.long}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">我們會送出什麼</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>只有計算出來的角度數字與判斷結果（不含任何影像），用來把結果寫成白話報告。</li>
          <li>
            這些數字會送到我們的伺服器，再交給美國 Anthropic 公司的人工智慧服務（Claude）寫成白話。我們的伺服器處理完不會保存；Anthropic 依其資料政策處理，可能會在一段期間內保留。
          </li>
          <li>和一般網站一樣，網站主機服務商會記錄連線的基本資訊（例如 IP 位址、瀏覽的網址與時間）；為了防止濫用，我們的伺服器也會在記憶體中暫記 IP 位址最多 1 分鐘。</li>
          <li>不需要註冊，也不會收集你的姓名、電話或 Email。</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">資料捐贈（之後才會開放）</h2>
        <p>
          看完報告後，你可以自己決定要不要匿名捐贈骨架數據與分析結果，幫助我們改善準確度。我們不會收集你的影片。不捐也完全不影響使用。
        </p>
      </section>
    </PageContainer>
  );
}
