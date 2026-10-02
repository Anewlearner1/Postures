import { describe, expect, it } from "vitest";
import { BANNED_WORDS, findTextProblem, numberVariants } from "./content-filter";

const rules = { maxLength: 200 };

describe("AI 文字檢查", () => {
  it("一般白話句子可以通過", () => {
    expect(findTextProblem("走路時，後腳往後推的幅度比一般人少一些，可以透過練習慢慢改善。", rules)).toBeNull();
  });

  it.each(BANNED_WORDS)("含禁用詞「%s」時不通過（UX §8.5）", (word) => {
    expect(findTextProblem(`這是${word}的說明。`, rules)).toBe("banned_word");
  });

  it.each(["你的左腳推得比較少。", "右膝彎得比較少。", "左右腳不太一樣。", "兩側都有這個情況。", "另一側比較好。", "The left knee."])(
    "提到左右側時不通過（D26）：%s",
    (text) => {
      expect(findTextProblem(text, rules)).toBe("side");
    },
  );

  it("描述頭部或頸部時不通過（D25）", () => {
    expect(findTextProblem("你的頭部有點往前。", rules)).toBe("head");
    expect(findTextProblem("可以改善脖子前伸。", rules)).toBe("head");
  });

  it("數字必須是程式提供的值", () => {
    const allowed = { maxLength: 200, allowedNumbers: new Set(["4", "14"]), allowedTimestamps: ["0:03", "0:08"] };
    expect(findTextProblem("出現了 4 次（例如 0:03、0:08），平均約前傾 14 度。", allowed)).toBeNull();
    expect(findTextProblem("平均約前傾 15 度。", allowed)).toBe("number");
    expect(findTextProblem("每天做 30 秒。", allowed)).toBe("number");
    expect(findTextProblem("出現了 ５ 次。", allowed)).toBe("number"); // 全形數字也會檢查
    expect(findTextProblem("例如 0:09。", allowed)).toBe("number");
  });

  it("沒有允許任何數字時，出現數字就不通過（練習連結句不可改劑量）", () => {
    expect(findTextProblem("每組做 10 下就好。", rules)).toBe("number");
  });

  it("空白、太長、網址或 Markdown 不通過", () => {
    expect(findTextProblem("   ", rules)).toBe("empty");
    expect(findTextProblem("好".repeat(201), rules)).toBe("too_long");
    expect(findTextProblem("請看 https://example.com", rules)).toBe("format");
    expect(findTextProblem("**重點**", rules)).toBe("format");
  });

  it("numberVariants 提供整數與一位小數兩種寫法", () => {
    expect(numberVariants(14.26)).toEqual(["14", "14.3"]);
    expect(numberVariants(3)).toEqual(["3"]);
  });
});
