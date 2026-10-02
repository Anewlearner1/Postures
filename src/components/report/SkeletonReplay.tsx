"use client";

/**
 * 這個檔案做什麼：
 *   報告頁的「骨架回放」（UX 文件 §4.6）：播放使用者自己的影片（只用本機的 blob: 網址，不上傳），
 *   並在影片上用 canvas 疊畫分析時找到的骨架。
 *   - 控制列：播放／暫停、時間、播放速度（0.25x／0.5x／1x，預設 0.5x）、逐格、骨架開關、全螢幕
 *   - 時間軸：問題出現的時間點（◆＋編號，不只靠顏色）、偵測較不穩定的片段（灰色斜線）
 *   - 點標記或卡片的「在影片中查看」：跳到該時間點前 1 秒、0.5x 播放、到點自動暫停，
 *     對應關節畫脈動圓圈，角落顯示小標籤 3 秒
 *   - 骨架顏色：近側實線、遠側淡色虛線；偵測信心低的關節半透明
 *   手機與電腦都可以用（按鈕至少 44×44 像素）。
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { REPLAY_CONTROLS, trimmedReplayNotice } from "@/data/analysis-copy";
import { REPLAY_COPY } from "@/data/report-copy";
import type { PoseSequence } from "@/lib/gait/types";
import { formatClock } from "@/lib/pose/preflight";
import { unstableRanges, type ReplayMarker } from "@/lib/pose/replay-markers";
import { containRect, drawSkeleton, frameIndexAt, highlightJoints, nearSides } from "@/lib/pose/skeleton";

export interface SkeletonReplayHandle {
  /** 跳到某張卡片的第一個問題時間點（卡片「在影片中查看」用）。 */
  focusCard(cardId: string): void;
}

interface SkeletonReplayProps {
  ref?: Ref<SkeletonReplayHandle>;
  videoUrl: string;
  poses: PoseSequence;
  /** 整段影片長度（秒）。 */
  durationSec: number;
  /** 影片原始影格率（逐格按鈕用）。 */
  sourceFps: number;
  /** 只分析了前段時，分析到第幾秒。 */
  analyzedUntilSec: number;
  trimmed: boolean;
  markers: ReplayMarker[];
}

const SPEEDS = [0.25, 0.5, 1] as const;
const DEFAULT_SPEED = 0.5;
/** 卡片編號的顏色（UX §4.6：顏色＋編號，不能只靠顏色；不用紅色）。 */
const MARKER_COLORS = ["#17796b", "#b7791f", "#3b5bdb", "#6b46c1"];
const LABEL_MS = 3000;
/** 跳到問題時間點後，脈動圓圈顯示多久（前 1 秒以 0.5x 播放約 2 秒＋停住後 3 秒）。 */
const PULSE_MS = 5000;

function markerColor(markerNumber: number): string {
  return MARKER_COLORS[(markerNumber - 1) % MARKER_COLORS.length];
}

const ICON_BUTTON =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-white px-2 text-sm font-semibold text-ink hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40";

export function SkeletonReplay({
  ref,
  videoUrl,
  poses,
  durationSec,
  sourceFps,
  analyzedUntilSec,
  trimmed,
  markers,
}: SkeletonReplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const highlightRef = useRef<{ problem: string; untilMs: number } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [label, setLabel] = useState<{ text: string; color: string; key: number } | null>(null);
  const [pulsing, setPulsing] = useState(false);

  const frames = poses.frames;
  const sides = useMemo(() => nearSides(frames), [frames]);
  const unstable = useMemo(() => unstableRanges(frames, poses.fps), [frames, poses.fps]);
  const legend = useMemo(
    () => markers.filter((marker, index) => markers.findIndex((m) => m.markerNumber === marker.markerNumber) === index),
    [markers],
  );
  const toleranceSec = 1.5 / Math.max(1, poses.fps);

  // ---- 畫骨架 ----
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!showSkeleton) return;

    const index = frameIndexAt(frames, video.currentTime, toleranceSec);
    const landmarks = index >= 0 ? frames[index].landmarks : null;
    if (!landmarks) return;
    const nearSide = sides[index];
    const highlight = highlightRef.current;
    const now = performance.now();
    const content = containRect(width, height, poses.videoWidth, poses.videoHeight);
    drawSkeleton(ctx, landmarks, {
      rect: content,
      nearSide,
      scale: Math.min(2.2, Math.max(0.7, content.width / 640)),
      highlight:
        highlight && now < highlight.untilMs
          ? { joints: highlightJoints(highlight.problem, nearSide), pulse: (Math.sin(now / 160) + 1) / 2 }
          : null,
    });
  }, [frames, sides, showSkeleton, toleranceSec, poses.videoWidth, poses.videoHeight]);

  // 播放中（或正在顯示脈動圓圈）時，每個畫面更新一次；到了自動暫停的時間點就暫停
  useEffect(() => {
    if (!playing && !pulsing) return;
    let frameId = 0;
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      const stopAt = stopAtRef.current;
      if (stopAt !== null && video.currentTime >= stopAt) {
        video.pause();
        stopAtRef.current = null;
      }
      draw();
      setCurrentTime(video.currentTime);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, pulsing, draw]);

  useEffect(() => {
    if (!pulsing) return;
    const timer = window.setTimeout(() => setPulsing(false), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulsing]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === containerRef.current);
      requestAnimationFrame(() => draw());
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    setCanFullscreen(Boolean(document.fullscreenEnabled && containerRef.current?.requestFullscreen));
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [draw]);

  useEffect(() => {
    if (!label) return;
    const timer = window.setTimeout(() => setLabel(null), LABEL_MS);
    return () => window.clearTimeout(timer);
  }, [label]);

  // ---- 操作 ----
  function applySpeed(value: number) {
    setSpeed(value);
    const video = videoRef.current;
    if (video) {
      video.playbackRate = value;
      video.defaultPlaybackRate = value;
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      stopAtRef.current = null;
      video.playbackRate = speed;
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  function seekTo(timeSec: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, timeSec), duration);
    setCurrentTime(video.currentTime);
  }

  function stepFrame(direction: 1 | -1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    stopAtRef.current = null;
    seekTo(video.currentTime + direction / Math.max(1, sourceFps));
  }

  const jumpToMarker = useCallback(
    (marker: ReplayMarker) => {
      const video = videoRef.current;
      if (!video) return;
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      video.pause();
      video.currentTime = Math.max(0, marker.timeSec - 1);
      video.playbackRate = 0.5;
      video.defaultPlaybackRate = 0.5;
      setSpeed(0.5);
      stopAtRef.current = marker.timeSec;
      highlightRef.current = { problem: marker.problem, untilMs: performance.now() + PULSE_MS };
      setLabel({ text: `${marker.markerNumber} ${marker.label}`, color: markerColor(marker.markerNumber), key: Date.now() });
      setPulsing(true);
      void video.play().catch(() => undefined);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusCard(cardId: string) {
        const marker = markers.find((item) => item.cardId === cardId);
        if (marker) jumpToMarker(marker);
        else containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      },
    }),
    [markers, jumpToMarker],
  );

  async function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
        // 手機全螢幕時轉為橫向（不支援就算了）
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await orientation.lock?.("landscape").catch(() => undefined);
      }
    } catch {
      // 不支援全螢幕時忽略
    }
  }

  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(duration, 0.001)) * 100))}%`;

  return (
    <section id="replay" className="scroll-mt-20 rounded-2xl border border-line p-4" aria-labelledby="replay-title">
      <h2 id="replay-title" className="text-lg font-bold">
        {REPLAY_COPY.title}
      </h2>
      <p className="text-sm text-muted">{REPLAY_COPY.subtitle}</p>

      <div
        ref={containerRef}
        className={`relative mx-auto mt-3 overflow-hidden bg-black ${fullscreen ? "h-full w-full" : "rounded-xl"}`}
        style={
          fullscreen
            ? undefined
            : {
                aspectRatio: `${poses.videoWidth} / ${poses.videoHeight}`,
                width: `min(100%, calc(70vh * ${poses.videoWidth} / ${poses.videoHeight}))`,
              }
        }
      >
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
          onClick={togglePlay}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (Number.isFinite(video.duration)) setDuration(video.duration);
            video.playbackRate = speed;
            video.defaultPlaybackRate = speed;
            draw();
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            draw();
          }}
          onSeeked={() => {
            draw();
            setCurrentTime(videoRef.current?.currentTime ?? 0);
          }}
          onLoadedData={() => draw()}
          data-testid="replay-video"
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
        {label && (
          <p
            key={label.key}
            className="pointer-events-none absolute left-2 top-2 rounded-lg bg-ink/85 px-3 py-1 text-sm font-semibold text-white"
            style={{ borderLeft: `4px solid ${label.color}` }}
            role="status"
          >
            {label.text}
          </p>
        )}
      </div>

      {/* 控制列 */}
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="回放控制">
        <button type="button" className={ICON_BUTTON} onClick={togglePlay} aria-label={playing ? REPLAY_CONTROLS.pause : REPLAY_CONTROLS.play}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" className={ICON_BUTTON} onClick={() => stepFrame(-1)} aria-label={REPLAY_CONTROLS.prevFrame}>
          ◀|
        </button>
        <button type="button" className={ICON_BUTTON} onClick={() => stepFrame(1)} aria-label={REPLAY_CONTROLS.nextFrame}>
          |▶
        </button>
        <span className="min-w-[5.5rem] text-sm tabular-nums text-muted" aria-live="off">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
        <div className="flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label={REPLAY_CONTROLS.speed}>
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={speed === value}
              className={`h-11 min-w-11 px-2 text-sm font-semibold ${speed === value ? "bg-brand-600 text-white" : "bg-white text-ink"}`}
              onClick={() => applySpeed(value)}
            >
              {value}x
            </button>
          ))}
        </div>
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            className="h-5 w-5 accent-brand-600"
            checked={showSkeleton}
            onChange={(event) => setShowSkeleton(event.target.checked)}
          />
          {REPLAY_CONTROLS.skeleton}
        </label>
        {canFullscreen && (
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? REPLAY_CONTROLS.exitFullscreen : REPLAY_CONTROLS.fullscreen}
          >
            ⛶
          </button>
        )}
      </div>

      {/* 時間軸 */}
      <div className="relative mt-4 h-11">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-line">
          {unstable.map((range) => (
            <span
              key={range.startSec}
              className="absolute inset-y-0"
              style={{
                left: pct(range.startSec),
                width: `calc(${pct(range.endSec)} - ${pct(range.startSec)})`,
                backgroundImage: "repeating-linear-gradient(45deg, #9aa5b1 0 3px, transparent 3px 6px)",
              }}
            />
          ))}
          {trimmed && (
            <span
              className="absolute inset-y-0 right-0 bg-ink/20"
              style={{ left: pct(analyzedUntilSec) }}
              title={trimmedReplayNotice(analyzedUntilSec)}
            />
          )}
          <span className="absolute inset-y-0 left-0 bg-brand-600/60" style={{ width: pct(currentTime) }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(currentTime, duration)}
          onChange={(event) => {
            stopAtRef.current = null;
            seekTo(Number(event.target.value));
          }}
          aria-label={REPLAY_CONTROLS.timeline}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        {markers.map((marker, index) => (
          <button
            key={`${marker.cardId}-${index}`}
            type="button"
            onClick={() => jumpToMarker(marker)}
            className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: pct(marker.timeSec) }}
            aria-label={`${marker.markerNumber} ${marker.label}（${formatClock(marker.timeSec)}）`}
            data-testid="replay-marker"
          >
            <span
              className="absolute h-5 w-5 rotate-45 rounded-sm border-2 border-white shadow"
              style={{ backgroundColor: markerColor(marker.markerNumber) }}
              aria-hidden
            />
            <span className="relative text-xs font-bold text-white" aria-hidden>
              {marker.markerNumber}
            </span>
          </button>
        ))}
      </div>

      {/* 圖例 */}
      {(legend.length > 0 || unstable.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {legend.map((marker) => (
            <li key={marker.markerNumber} className="flex items-center gap-1">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-xs font-bold text-white"
                style={{ backgroundColor: markerColor(marker.markerNumber) }}
              >
                {marker.markerNumber}
              </span>
              {marker.label}
            </li>
          ))}
          {unstable.length > 0 && (
            <li className="flex items-center gap-1 text-muted">
              <span
                className="inline-block h-3 w-5 rounded-sm"
                style={{ backgroundImage: "repeating-linear-gradient(45deg, #9aa5b1 0 3px, transparent 3px 6px)" }}
              />
              這段偵測較不穩定
            </li>
          )}
        </ul>
      )}
      {trimmed && <p className="mt-2 text-sm text-muted">{trimmedReplayNotice(analyzedUntilSec)}</p>}

      <details className="mt-3 text-sm">
        <summary className="min-h-11 py-2 font-semibold text-brand-700">{REPLAY_CONTROLS.help.title}</summary>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {REPLAY_CONTROLS.help.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
      <p className="mt-2 text-xs text-muted">{REPLAY_COPY.privacy}</p>
    </section>
  );
}
