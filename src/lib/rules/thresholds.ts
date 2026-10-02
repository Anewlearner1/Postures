/**
 * 這個檔案做什麼：
 *   步態分析用到的「所有」閾值與參數（docs/spec/gait-rules.md §8 閾值總表的 TypeScript 版，
 *   另外收錄 §1、§2、§6、§7 的前處理／品質參數）。日後 M5 校正時只需要改這個檔案。
 *
 * 閱讀提示：
 *   - 角度單位一律是「度」；長度若寫「L」表示以腿長為單位（§2.2）。
 *   - 每個數值旁邊都註明對應的規則文件章節，以及它是【文獻】還是【推估】。
 *   - 「在範圍內」的判斷方式寫在 grading.ts／confidence.ts，這裡只放數字。
 */

export const RULES_VERSION = "gait-rules-v0.2";
/** D22：第一版報告標示「測試版標準」。 */
export const STANDARD_LABEL = "beta" as const;

// ---------------------------------------------------------------------------
// §1 前處理
// ---------------------------------------------------------------------------
export const PREPROCESS = {
  /** §1.2：visibility < 0.5 視為缺值【文獻：MediaPipe 預設】 */
  minVisibility: 0.5,
  /** §1.2：缺口 ≤ 0.12 秒才線性內插（換算格數四捨五入：30 fps = 4 格）【文獻：Stenum 2024】 */
  maxGapSec: 0.12,
  /** §1.2：零相位 4 階 Butterworth 截止頻率（Hz）【推估：5–6 Hz】 */
  lowpassHz: 6,
  /** 截止頻率不得超過 Nyquist 的這個比例（低影格率時自動降低截止頻率）【推估】 */
  lowpassMaxNyquistFraction: 0.8,
  /**
   * §1.3 左右錯置修正（Viterbi 一般化）：每一格「交換」狀態的先驗代價 = 腿長 × 0.05。
   * 規格的「位移 > 0.25 L 且交換後變小」是它的特例：短暫錯置的前後邊界跳動遠大於這個代價，
   * 所以會被修正；兩腳交會時兩種標籤代價相近，先驗讓它維持不交換【推估】
   */
  swapPriorLeg: 0.05,
} as const;

// ---------------------------------------------------------------------------
// §1.5 鏡頭水平（roll）校正
// ---------------------------------------------------------------------------
export const ROLL = {
  /** |α| ≤ 3° 不處理（可信度高）；3–8° 校正、可信度中；> 8° 校正、可信度低【推估】 */
  noCorrectionMaxDeg: 3,
  mediumMaxDeg: 8,
} as const;

// ---------------------------------------------------------------------------
// §2.2 直線行走段與轉身
// ---------------------------------------------------------------------------
export const SEGMENTATION = {
  /** 骨盆水平位置平滑視窗（秒） */
  pelvisSmoothSec: 0.5,
  /** 腿長取近側「髖→膝」＋「膝→踝」的第 90 百分位數 */
  legLengthPercentile: 90,
  /** 直線段：|v̂| ≥ 0.4 L/s【推估】 */
  minSpeedLegPerSec: 0.4,
  /** 直線段至少持續 1.5 秒【推估】 */
  minPassSec: 1.5,
  /** 方向改變點前後各排除 0.5 秒 */
  signChangeMarginSec: 0.5,
  /**
   * 肩寬比 > 此值視為轉身（面向／背向鏡頭），前後各延伸 0.3 秒【推估】。
   * 規格 §2.2 寫 0.35；但合成資料的幾何顯示：依 §7.4 建議拍法（距走道 3–4 m、走道 4–5 m），
   * 人走到畫面兩端時視線斜角約 30°，純側面行走的肩寬比就有 0.36–0.41，0.35 會把每趟兩端誤判成轉身。
   * 真正轉身時肩寬比約 0.8，因此改用 0.5（M5 以真人影片校正）。
   */
  turnShoulderRatio: 0.5,
  turnMarginSec: 0.3,
  /** 每趟起點與終點 0.5 秒內的週期為「加減速週期」【推估】 */
  accelMarginSec: 0.5,
} as const;

// ---------------------------------------------------------------------------
// §2.3 事件偵測（Zeni 座標法）
// ---------------------------------------------------------------------------
export const EVENTS = {
  /** 同側兩個 HS（或 TO）至少相隔 0.6 秒【推估】 */
  minEventIntervalSec: 0.6,
  /** 峰值突出度 ≥ 0.15 L【推估】 */
  minProminenceLeg: 0.15,
  /** 腳跟／腳尖在該趟的有效比例低於此值時，改用腳踝點（§2.1 備援）【推估】 */
  footPointMinValidFraction: 0.8,
} as const;

// ---------------------------------------------------------------------------
// §2.4 週期合理性檢查
// ---------------------------------------------------------------------------
export const CYCLE_CHECK = {
  /** 週期時間 0.8–1.8 秒【推估】 */
  minCycleSec: 0.8,
  maxCycleSec: 1.8,
  /** 支撐期比例 50–75%【推估；正常約 60%，Perry & Burnfield】 */
  minStanceFraction: 0.5,
  maxStanceFraction: 0.75,
  /** 近側必要關鍵點（未內插）缺值比例 < 20%【推估】 */
  maxMissingFraction: 0.2,
  /** 骨盆不得進入畫面左右 5% 邊緣【推估】 */
  frameEdgeFraction: 0.05,
} as const;

// ---------------------------------------------------------------------------
// §2.5 時相窗
// ---------------------------------------------------------------------------
export const PHASE = {
  /** 承重期 = HS → HS + 15% 週期；支撐中後期從 HS + 15% 開始 */
  loadingResponseFraction: 0.15,
  /**
   * KIC（M5 修正 A-1）：在 HS ± 40 毫秒（至少 ±1 格）內找膝角局部最小值＋拋物線次幀內插。
   * 原規格為「HS ±1 幀平均」，會系統性高估（30 fps +3°、15 fps +5–9°）。
   */
  kicSearchSec: 0.04,
} as const;

// ---------------------------------------------------------------------------
// §3.3、§4.3、§5.3 分級閾值（§8 閾值總表）
// ---------------------------------------------------------------------------

/**
 * 「越小越不好」的指標（PHE、PKF_sw）：value ≥ normalMin → 正常；≥ markedBelow → 輕度；其餘明顯。
 * 「越大越不好」的指標（KIC、TRK、ΔPKF）：見各自欄位說明。
 */
export const HIP_EXTENSION = {
  /** §3.3：PHE ≥ 12 正常；8 ≤ PHE < 12 輕度；< 8 明顯【推估】 */
  normalMin: 12,
  markedBelow: 8,
  /** §3.2／§8 guard（D23、D31）：TE ≥ 12 且 TRK ≥ 7 時不判髖伸展不足，歸因於軀幹前傾【推估】 */
  attributionMinTE: 12,
  attributionMinTRK: 7,
} as const;

export const KNEE_SWING = {
  /** §4.3：PKF_sw ≥ 52 正常；45 ≤ PKF_sw < 52 輕度；< 45 明顯（貼齊 Lee 2024 的 44.3）【推估／文獻】 */
  normalMin: 52,
  markedBelow: 45,
  /** §4.3 左右差 ΔPKF（內部輔助）：≤ 10 正常；(10, 17] 輕度；> 17 明顯【推估／文獻 Lee 2024】 */
  asymmetryNormalMax: 10,
  asymmetryMildMax: 17,
  /** ΔPKF 只在兩側皆有 ≥ 2 個有效週期時使用 */
  asymmetryMinCyclesPerSide: 2,
} as const;

export const KNEE_STANCE = {
  /** §4.3：KIC ≤ 12 正常；12 < KIC < 20 輕度；≥ 20 明顯【推估】 */
  normalMax: 12,
  markedMin: 20,
} as const;

export const TRUNK = {
  /** §5.3：TRK < 7 正常；7 ≤ TRK < 12 輕度；≥ 12 明顯【推估】 */
  mildMin: 7,
  markedMin: 12,
} as const;

/**
 * 整段持續前傾（gait-rules.md §5.3、§8 `trunk_lean_persistent`，M4 新增）【推估】：
 * 軀幹前傾為輕度以上，且 ≥ 80% 的有效週期本身 TRK ≥ 7°，且每一個有有效週期的直線段，
 * 其 TRK 中位數也 ≥ 7°；有效週期至少 2 個。給回放時間軸畫「整段」長條，而不是零散的點。
 */
export const TRUNK_PERSISTENT = {
  minCycleFraction: 0.8,
  minCycles: 2,
} as const;

/** §3.3「接近臨界」：任一分級界線 ±1.5° 以內【推估】 */
export const NEAR_THRESHOLD_BAND_DEG = 1.5;

/**
 * M5：「接近臨界」帶寬改為依量測不確定度調整（不改分級閾值）【推估】。
 * 帶寬 = 中位數的 95% 信賴區間半寬 = 1.96 × 1.2533 × 週期間標準差 ÷ √n，
 * 下限 1.5°（原規格值）、上限 3°（約 1 個 2D MAE）；只有 1 個週期（無法估標準差）時用上限 3°。
 * 用意：數值和界線的差距在量測誤差範圍內時，報告一律用「參考就好」的保守說法。
 */
export const NEAR_THRESHOLD_ADAPTIVE = {
  minDeg: NEAR_THRESHOLD_BAND_DEG,
  maxDeg: 3,
  z: 1.96,
  /** 中位數的標準誤約為平均數的 1.2533 倍（常態分布） */
  medianSeFactor: 1.2533,
} as const;

/** D29：該側有效週期 < 2 時嚴重度最多「輕度」 */
export const CYCLE_GUARD_MIN_CYCLES = 2;

/** §2.7：v̂ < 1.0 L/s 標記 slow_speed（D27：只附註，不調整嚴重度）【推估：由 Andrews 2023 換算】 */
export const SLOW_SPEED_LEG_PER_SEC = 1.0;

/** D38：每個 finding 最多輸出幾個時間點（API 上限 20）【PM 決議範圍內的實作選擇】 */
export const MAX_TIMESTAMPS = 10;

// ---------------------------------------------------------------------------
// §6.3 可信度因子（全部【推估】）
// ---------------------------------------------------------------------------
export const CONFIDENCE = {
  angleOff: {
    /** (a) 髖寬比 |X_LH − X_RH| ÷ 軀幹長：< 0.15 高；0.15–0.30 中；> 0.30 低 */
    hipRatioHigh: 0.15,
    hipRatioMedium: 0.3,
    /**
     * (b)（M5 修正 A-4）改用「走道偏轉角 ψ」：≤ 15° 高；15–25° 中；> 25° 低。
     * 依 §6.1 的投影公式 θ' = atan(tan θ · cos ψ)：ψ = 15° 時 60° 的膝屈曲只少約 0.9°、20° 的髖伸展少約 0.6°（< 1°）；
     * ψ = 25° 時分別少約 2.5°、1.6°（接近 1 個 2D MAE）；30° 以上超過 2D MAE。
     * 原本的「腿長像素變化 > 20% 即低」受走道長度與距離影響，偏 10° 時就幾乎一律判低（QA 合成測試 100%）。
     */
    yawHighDeg: 15,
    yawMediumDeg: 25,
    /** 推估焦距（像素）= 影像長邊 × 0.73（一般手機主鏡頭 1×，長邊視角約 69°）【推估】 */
    assumedFocalFraction: 0.73,
  },
  occlusion: {
    /** 近側必要關鍵點平均 visibility：≥ 0.80 高；0.65–0.80 中；< 0.65 低 */
    visHigh: 0.8,
    visMedium: 0.65,
    /** 內插影格比例：< 5% 高；5–15% 中；> 15% 低 */
    interpHigh: 0.05,
    interpMedium: 0.15,
  },
  fewCycles: {
    /** 兩側皆 ≥ 2 且合計 ≥ 5 → 高；合計 ≤ 2 → 低；其餘 → 中 */
    perSideHigh: 2,
    totalHigh: 5,
    totalLowMax: 2,
  },
  highVariability: {
    /** 主要指標跨週期標準差：≤ 4° 高；4–7° 中；> 7° 低 */
    sdHigh: 4,
    sdMedium: 7,
  },
  subjectSmall: {
    /** 人體高度佔畫面高度：≥ 50% 高；30–50% 中；< 30% 低 */
    high: 0.5,
    medium: 0.3,
    /** 由「鼻子到腳」換算全身高度的比例（鼻子約在身高 91% 處）【推估：人體測量比例】 */
    noseHeightFraction: 0.91,
  },
  partialOutOfFrame: {
    /** 直線段中任一必要關鍵點超出畫面的影格比例：< 2% 高；2–10% 中；> 10% 低 */
    high: 0.02,
    medium: 0.1,
  },
  cameraTilt: {
    /** 同 §1.5：≤ 3° 高；3–8° 中；> 8° 低 */
    high: ROLL.noCorrectionMaxDeg,
    medium: ROLL.mediumMaxDeg,
  },
  cameraMotion: {
    /** 沒有背景特徵點，以「各趟 roll 估計的差異（最大−最小）」代替：≤ 2° 穩定；2–5° 輕微；> 5° 明顯【推估】 */
    high: 2,
    medium: 5,
  },
  lowFps: {
    /** ≥ 30 fps 高（29.97 視為 30）；24–29 中；15–23 低（< 15 拒絕） */
    high: 29.5,
    medium: 23.5,
  },
  lrSwap: {
    /** 被修正的影格比例：< 5% 高；5–15% 中；> 15% 低 */
    high: 0.05,
    medium: 0.15,
  },
  lensDistortion: {
    /** 有效週期中骨盆位於畫面左右 10% 邊緣內的比例：< 10% 高；10–30% 中；> 30% 低 */
    edgeFraction: 0.1,
    high: 0.1,
    medium: 0.3,
  },
  lowLight: {
    /**
     * 沒有影像亮度資料，以「關鍵點跳動」代替：原始座標與濾波後座標差的均方根 ÷ 腿長。
     * < 0.012 正常；0.012–0.024 偏暗；> 0.024 很暗／明顯模糊【推估】
     */
    high: 0.012,
    medium: 0.024,
  },
  irregularPace: {
    /** 週期時間變異係數：< 8% 高；8–15% 中；> 15% 低 */
    high: 0.08,
    medium: 0.15,
  },
  /** §6.4：「中」的因子 ≥ 3 個時整體為「低」 */
  mediumCountForLow: 3,
  /** §6.4：最多列 2 個主要原因 */
  maxReasons: 2,
} as const;

// ---------------------------------------------------------------------------
// §7.1 拒絕並請重拍
// ---------------------------------------------------------------------------
export const REJECT = {
  /** 偵測到人的影格 < 50% → no_person */
  minDetectedFraction: 0.5,
  /** 全身完整影格 < 60% → body_incomplete */
  minCompleteBodyFraction: 0.6,
  /** 影片 < 6 秒 → too_short（沿用 UX §5.4） */
  minDurationSec: 6,
  /** 影格率 < 15 fps → low_fps_reject */
  minFps: 15,
  /** 所有直線段的髖寬比 > 0.5 → not_side_view */
  notSideViewHipRatio: 0.5,
  /**
   * M5（A-6）：沒有任何有效週期、且每一趟的走道偏轉角估計 > 30°（angle_off 已是「低」的範圍）時，
   * 拒絕代碼改為 not_side_view（原本報 no_gait_cycle，使用者會以為是走不夠）【推估】
   */
  noCycleNotSideViewYawDeg: 30,
  /** 沒有直線段時，身體寬度比（肩、髖）中位數 > 此值 → 判定為正面／背面朝鏡頭（not_side_view）【推估】 */
  noPassFrontalRatio: 0.35,
  /** multi_person：有 poseCount 時，≥ 2 人的影格佔偵測影格 ≥ 50%【推估】 */
  multiPersonFrameFraction: 0.5,
  /**
   * multi_person：沒有 poseCount 時，比較候選換人點前、後各約 0.17 秒（30 fps = 5 格，至少 3 格）的中位數，
   * 扣掉正常走路的位移後骨盆偏離 > 0.5 L、或軀幹長度變化 > 35% 算一次跳動，次數 ≥ 4 判定【推估】。
   * 用前後視窗中位數（而非逐格比較）避免人很小、雜訊大的影片被誤判（M4 修正背影誤判）；
   * 換人需持續約半個視窗以上才會被看到。
   */
  identityJumpLeg: 0.5,
  identityScaleJump: 0.35,
  identityJumpCount: 4,
  identityWindowSec: 0.17,
} as const;
