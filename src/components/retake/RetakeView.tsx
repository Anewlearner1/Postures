"use client";

/**
 * 這個檔案做什麼：
 *   「錯誤／請重拍」畫面（UX 文件 §2.7、§5）。所有錯誤共用同一個版型，只換文案。
 *   - 在 /retake/[代碼] 頁面使用（分析後發現的問題）
 *   - 也在上傳頁直接使用（選檔時就發現格式／大小不對）
 *   文案資料在 src/data/retake-messages.ts。
 */

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/ButtonLink";
import { AlertIcon } from "@/components/ui/icons";
import { externalBrowserUrl } from "@/lib/pose/browser-support";
import { RETAKE_MESSAGES, type RetakeAction, type RetakeCode, type RetakeVars } from "@/data/retake-messages";

interface RetakeViewProps {
  code: RetakeCode;
  /**
   * 若有提供，「重新選擇影片」按鈕會呼叫這個函式，而不是換頁
   * （在上傳頁內使用時，直接清除目前選的檔案即可）。
   */
  onReselect?: () => void;
  /** 文案中的變數（例如影片秒數）；有提供時顯示含數字的說明。 */
  vars?: RetakeVars;
}

export function RetakeView({ code, onReselect, vars }: RetakeViewProps) {
  const message = RETAKE_MESSAGES[code];
  const description = (vars && message.describe?.(vars)) ?? message.description;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
      {/* 插圖佔位（正式版依錯誤類型換示意圖或偵測失敗的畫面） */}
      <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-surface text-sev-mild-text">
        <AlertIcon className="h-16 w-16" />
      </div>

      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{message.title}</h1>
        <p className="text-muted">{description}</p>
        {message.solutions.length > 0 && (
          <div>
            <h2 className="font-semibold">怎麼解決：</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {message.solutions.map((solution) => (
                <li key={solution}>{solution}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col items-stretch gap-2 pt-2 sm:flex-row sm:items-center sm:gap-4">
          <ActionButton action={message.primary} variant="primary" onReselect={onReselect} />
          {message.secondary && (
            <ActionButton action={message.secondary} variant="ghost" onReselect={onReselect} />
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  action,
  variant,
  onReselect,
}: {
  action: RetakeAction;
  variant: "primary" | "ghost";
  onReselect?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const className = buttonClass(variant);

  if (action.kind === "link") {
    if (onReselect && action.href === "/upload") {
      return (
        <button type="button" className={className} onClick={onReselect}>
          {action.label}
        </button>
      );
    }
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  if (action.kind === "copy_url") {
    return (
      <button
        type="button"
        className={className}
        onClick={async () => {
          try {
            // LINE 認得 openExternalBrowser=1，貼回 LINE 也會用外部瀏覽器開啟（UX §5.8）
            await navigator.clipboard.writeText(externalBrowserUrl(`${window.location.origin}/`));
            setCopied(true);
          } catch {
            // 部分瀏覽器不允許寫入剪貼簿，這時就不顯示「已複製」
          }
        }}
      >
        {copied ? "已複製" : action.label}
      </button>
    );
  }

  return (
    <button type="button" className={className} onClick={() => window.location.reload()}>
      {action.label}
    </button>
  );
}
