/**
 * 這個檔案做什麼：
 *   找不到頁面（404）時顯示的畫面。
 */

import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageContainer } from "@/components/ui/PageContainer";

export default function NotFound() {
  return (
    <PageContainer width="narrow" className="space-y-4 text-center">
      <h1 className="text-2xl font-bold">找不到這個頁面</h1>
      <p className="text-muted">網址可能打錯了，或這個頁面已經不存在。</p>
      <ButtonLink href="/">回到首頁</ButtonLink>
    </PageContainer>
  );
}
