import { describe, expect, it } from "vitest";
import { clientKey, FixedWindowCounter, normalizeIp, ReportRateLimiter } from "./rate-limit";

const LIMITS = { perIpPerMinute: 3, globalPerMinute: 5, aiPerMinute: 2, aiPerHour: 3 } as const;

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("FixedWindowCounter", () => {
  it("同一時間窗內超過上限就拒絕，時間窗過了再歸零", () => {
    const time = clock();
    const counter = new FixedWindowCounter(2, 60_000, 100, time.now);
    expect(counter.take("a")).toBe(true);
    expect(counter.take("a")).toBe(true);
    expect(counter.take("a")).toBe(false);
    expect(counter.take("b")).toBe(true);
    time.advance(60_000);
    expect(counter.take("a")).toBe(true);
  });

  it("記住的來源數量有上限（記憶體不會無限增加）", () => {
    const counter = new FixedWindowCounter(5, 60_000, 2, clock().now);
    expect(counter.take("a")).toBe(true);
    expect(counter.take("b")).toBe(true);
    expect(counter.take("c")).toBe(false);
    expect(counter.take("a")).toBe(true);
  });

  it("Retry-After 秒數至少 1 秒", () => {
    const time = clock();
    const counter = new FixedWindowCounter(1, 60_000, 10, time.now);
    counter.take();
    time.advance(59_900);
    expect(counter.secondsUntilReset()).toBe(1);
  });
});

describe("ReportRateLimiter", () => {
  it("每個 IP 每分鐘有上限", () => {
    const limiter = new ReportRateLimiter(LIMITS, clock().now);
    for (let i = 0; i < 3; i++) expect(limiter.checkRequest("1.1.1.1").ok).toBe(true);
    const blocked = limiter.checkRequest("1.1.1.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.ok ? 0 : blocked.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.checkRequest("2.2.2.2").ok).toBe(true);
  });

  it("整台伺服器每分鐘有上限；被擋下的 IP 不會用掉整台額度", () => {
    const limiter = new ReportRateLimiter(LIMITS, clock().now);
    for (let i = 0; i < 10; i++) limiter.checkRequest("1.1.1.1"); // 只有 3 次算數
    expect(limiter.checkRequest("2.2.2.2").ok).toBe(true);
    expect(limiter.checkRequest("3.3.3.3").ok).toBe(true);
    expect(limiter.checkRequest("4.4.4.4").ok).toBe(false); // 3 + 2 = 5 已滿
  });

  it("Claude 呼叫次數：每分鐘、每小時都有上限", () => {
    const time = clock();
    const limiter = new ReportRateLimiter(LIMITS, time.now);
    expect(limiter.reserveAiCall()).toBe(true);
    expect(limiter.reserveAiCall()).toBe(true);
    expect(limiter.reserveAiCall()).toBe(false); // 每分鐘 2 次
    time.advance(60_000);
    expect(limiter.reserveAiCall()).toBe(true);
    expect(limiter.reserveAiCall()).toBe(false); // 每小時 3 次
    time.advance(3_600_000);
    expect(limiter.reserveAiCall()).toBe(true);
  });
});

describe("clientKey／normalizeIp", () => {
  it("取 x-forwarded-for 的第一個位址，沒有時用 x-real-ip", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers())).toBe("unknown");
  });

  it("IPv6 以 /64 為單位，避免換位址繞過限制", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
  });

  it("IPv4、IPv4 對應位址、帶連接埠", () => {
    expect(normalizeIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeIp("198.51.100.7:1234")).toBe("198.51.100.7");
  });

  it("看不懂的值回傳 null", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("1:2:3")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });
});
