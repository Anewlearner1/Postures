/**
 * 這個檔案做什麼：
 *   P2 上傳＋確認影片（網址：/upload）。
 *   互動內容在 src/components/upload/UploadForm.tsx；這裡只負責頁面外框與標題。
 *   目前只做前端的格式／大小檢查，不做分析（分析在 M3 實作）。
 */

import type { Metadata } from "next";
import { UploadForm } from "@/components/upload/UploadForm";
import { PageContainer } from "@/components/ui/PageContainer";

export const metadata: Metadata = { title: "上傳影片" };

export default function UploadPage() {
  return (
    <PageContainer>
      <UploadForm />
    </PageContainer>
  );
}
