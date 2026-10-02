/**
 * 這個檔案做什麼：
 *   全站統一的按鈕樣式。
 *   - ButtonLink：看起來像按鈕的連結（換頁用）
 *   - buttonClass()：給一般 <button> 套用同樣外觀
 *   手機上按鈕高度至少 44 像素，方便手指點按。
 */

import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-line disabled:text-muted disabled:cursor-not-allowed",
  secondary:
    "border border-brand-600 text-brand-700 bg-white hover:bg-brand-50 disabled:border-line disabled:text-muted disabled:cursor-not-allowed",
  ghost: "text-brand-700 underline underline-offset-4 hover:text-brand-800",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  extra = "",
  size: "md" | "sm" = "md",
): string {
  const shape =
    variant === "ghost"
      ? "inline-flex min-h-11 items-center justify-center gap-1 px-2"
      : size === "sm"
        ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"
        : "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold";
  return `${shape} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${VARIANT_CLASS[variant]} ${extra}`;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

export function ButtonLink({ variant = "primary", className = "", ...props }: ButtonLinkProps) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}
