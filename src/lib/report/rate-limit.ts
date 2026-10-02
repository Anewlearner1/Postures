/**
 * 這個檔案做什麼：
 *   POST /api/report 的「流量限制」（防止有人用程式大量呼叫，產生 Claude API 費用或拖垮伺服器）。
 *   全部在伺服器記憶體中計數，不需要任何外部服務或帳號。
 *
 *   三道限制（數字見 REPORT_RATE_LIMITS，想調整改這裡就好）：
 *     1. 每個連線來源（IP）每分鐘最多 N 次 → 超過回 429「請稍後再試」
 *     2. 整台伺服器每分鐘最多 M 次 → 超過回 429
 *     3. 「請 Claude 撰寫」的次數另有每分鐘／每小時上限 → 超過時不回錯誤，改用模板文字（使用者照樣拿到報告）
 *
 *   限制與注意（詳見 docs/review/M5-security.md）：
 *   - 計數只存在「這一台」伺服器的記憶體。Vercel 會依流量同時開多台、也會隨時重開，
 *     所以實際上限是「每台」的上限 × 台數，重開後歸零。這是「減速丘」，不是保證；
 *     費用的最後防線是 Anthropic 後台的每月花費上限（SPEC H2）。
 *   - IP 只用來計數，最多留在記憶體一分鐘，不寫入任何紀錄或儲存（D18 精神）。
 *   - IP 取自 x-forwarded-for／x-real-ip：在 Vercel 上由平台覆寫、無法偽造；
 *     自行架設且前面沒有可信任的反向代理時，使用者可以偽造這個標頭，此時只剩「整台上限」有效。
 */

export interface RateLimits {
  perIpPerMinute: number;
  globalPerMinute: number;
  aiPerMinute: number;
  aiPerHour: number;
}

/** 流量限制的數字（每台伺服器）。 */
export const REPORT_RATE_LIMITS: Readonly<RateLimits> = {
  /** 每個 IP 每分鐘最多幾次請求。正常使用者一次分析只呼叫 1 次；同一網路（公司、學校、行動網路）可能共用 IP，所以留寬一些。 */
  perIpPerMinute: 10,
  /** 整台伺服器每分鐘最多幾次請求（含模板報告）。 */
  globalPerMinute: 120,
  /** 整台伺服器每分鐘最多請 Claude 寫幾份報告；超過改用模板。 */
  aiPerMinute: 20,
  /** 整台伺服器每小時最多請 Claude 寫幾份報告；超過改用模板。 */
  aiPerHour: 300,
};

/**
 * 固定時間窗計數器：每過 windowMs 就全部歸零。
 * 記憶體用量有上限：同一時間窗最多記住 maxKeys 個來源，超過時新的來源一律視為超量。
 */
export class FixedWindowCounter {
  private windowStart = 0;
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  private roll(): void {
    const current = this.now();
    if (current - this.windowStart >= this.windowMs) {
      this.windowStart = current;
      this.counts.clear();
    }
  }

  /** 還有沒有額度（不扣）。 */
  canTake(key = "*"): boolean {
    this.roll();
    const used = this.counts.get(key) ?? 0;
    if (used >= this.limit) return false;
    return used > 0 || this.counts.size < this.maxKeys;
  }

  /** 還有額度就扣一次並回傳 true；沒有額度回傳 false（不扣）。 */
  take(key = "*"): boolean {
    if (!this.canTake(key)) return false;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    return true;
  }

  /** 距離這個時間窗結束還有幾秒（給 Retry-After 標頭用，至少 1 秒）。 */
  secondsUntilReset(): number {
    return Math.max(1, Math.ceil((this.windowStart + this.windowMs - this.now()) / 1000));
  }

  reset(): void {
    this.windowStart = 0;
    this.counts.clear();
  }
}

/**
 * 從請求標頭取出連線來源，作為計數用的鍵。
 * IPv6 以前 64 位元（/64，通常是同一個家庭或裝置）為單位，避免換個位址就繞過限制。
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || headers.get("x-real-ip")?.trim() || "";
  return normalizeIp(raw) ?? "unknown";
}

export function normalizeIp(raw: string): string | null {
  let ip = raw.trim().toLowerCase();
  if (!ip) return null;
  // 去掉 [ ]、連接埠、IPv6 區域代號
  ip = ip.replace(/^\[([^\]]+)\](:\d+)?$/, "$1").replace(/%.*$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(ip)) return ip.replace(/:\d+$/, "");
  const mapped = ip.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!/^[0-9a-f:]+$/.test(ip) || !ip.includes(":")) return null;

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.some((group) => group.length === 0 || group.length > 4)) return null;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSec: number };

/** /api/report 用的限流器組合（每台伺服器一份）。 */
export class ReportRateLimiter {
  private readonly perIp: FixedWindowCounter;
  private readonly global: FixedWindowCounter;
  private readonly aiMinute: FixedWindowCounter;
  private readonly aiHour: FixedWindowCounter;

  constructor(limits: Readonly<RateLimits> = REPORT_RATE_LIMITS, now: () => number = Date.now) {
    this.perIp = new FixedWindowCounter(limits.perIpPerMinute, 60_000, 10_000, now);
    this.global = new FixedWindowCounter(limits.globalPerMinute, 60_000, 1, now);
    this.aiMinute = new FixedWindowCounter(limits.aiPerMinute, 60_000, 1, now);
    this.aiHour = new FixedWindowCounter(limits.aiPerHour, 3_600_000, 1, now);
  }

  /**
   * 收到請求時呼叫。
   * 先看這個 IP 是否已超量（超量的請求不佔用整台額度，避免單一來源拖累所有人），
   * 再扣整台額度，最後才記下這個 IP（所以記憶體中的 IP 數量不會超過整台上限）。
   */
  checkRequest(key: string): RateLimitDecision {
    if (!this.perIp.canTake(key)) return { ok: false, retryAfterSec: this.perIp.secondsUntilReset() };
    if (!this.global.take()) return { ok: false, retryAfterSec: this.global.secondsUntilReset() };
    this.perIp.take(key);
    return { ok: true };
  }

  /** 準備呼叫 Claude 前呼叫：每分鐘與每小時都還有額度才扣並回傳 true；否則回傳 false（改用模板）。 */
  reserveAiCall(): boolean {
    if (!this.aiMinute.canTake() || !this.aiHour.canTake()) return false;
    this.aiMinute.take();
    this.aiHour.take();
    return true;
  }

  reset(): void {
    this.perIp.reset();
    this.global.reset();
    this.aiMinute.reset();
    this.aiHour.reset();
  }
}

/** /api/report 使用的限流器（每台伺服器一份，只在記憶體中；測試可呼叫 reportRateLimiter.reset()）。 */
export const reportRateLimiter = new ReportRateLimiter();
