import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, Download, Square, Video } from 'lucide-react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  CONFIDENCE_THRESHOLD,
  type PoseFrame,
  SKELETON_CONNECTIONS,
  detectPoseFrame,
  getPoseLandmarker,
} from '../services/poseEstimation';

// App 整合 Agent 的即時姿態偵測畫面。這裡只負責：啟動攝影機、把每一幀交給
// CV/Pose Agent（poseEstimation.ts）拿到關鍵點、畫骨架、顯示實測 FPS/延遲。
// 不在這裡做任何角度計算或步態判斷 — 那是步態演算法 Agent 尚未開始的範圍。

type CaptureStatus = 'idle' | 'starting' | 'streaming' | 'error';

const FPS_WINDOW_MS = 1000;
const LATENCY_SAMPLE_SIZE = 30;

export default function LiveGaitCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameTimestampsRef = useRef<number[]>([]);
  const latencySamplesRef = useRef<number[]>([]);
  const lastFrameRef = useRef<PoseFrame | null>(null);

  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fpsActual, setFpsActual] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [poseDetected, setPoseDetected] = useState(false);
  const [unreliableCount, setUnreliableCount] = useState(0);
  const [trackedCount, setTrackedCount] = useState(0);
  const [canExport, setCanExport] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    frameTimestampsRef.current = [];
    latencySamplesRef.current = [];
    setStatus('idle');
    setPoseDetected(false);
    setFpsActual(0);
    setLatencyMs(0);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const now = performance.now();
    const detection = detectPoseFrame(landmarker, video, now);

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    frameTimestampsRef.current.push(now);
    while (
      frameTimestampsRef.current.length &&
      now - frameTimestampsRef.current[0] > FPS_WINDOW_MS
    ) {
      frameTimestampsRef.current.shift();
    }
    setFpsActual(frameTimestampsRef.current.length);

    if (detection) {
      latencySamplesRef.current.push(detection.inferenceLatencyMs);
      if (latencySamplesRef.current.length > LATENCY_SAMPLE_SIZE) {
        latencySamplesRef.current.shift();
      }
      const avgLatency =
        latencySamplesRef.current.reduce((a, b) => a + b, 0) /
        latencySamplesRef.current.length;
      setLatencyMs(avgLatency);
      setPoseDetected(true);

      const entries = Object.entries(detection.keypoints);
      setTrackedCount(entries.length);
      setUnreliableCount(entries.filter(([, kp]) => kp.unreliable).length);

      // 畫骨架連線
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
      for (const [a, b] of SKELETON_CONNECTIONS) {
        const kpA = detection.keypoints[a];
        const kpB = detection.keypoints[b];
        if (!kpA || !kpB) continue;
        ctx.beginPath();
        ctx.moveTo(kpA.x * canvas.width, kpA.y * canvas.height);
        ctx.lineTo(kpB.x * canvas.width, kpB.y * canvas.height);
        ctx.stroke();
      }
      // 畫關鍵點：信心不足標紅，可靠標綠
      for (const kp of Object.values(detection.keypoints)) {
        ctx.beginPath();
        ctx.arc(kp.x * canvas.width, kp.y * canvas.height, 6, 0, 2 * Math.PI);
        ctx.fillStyle = kp.unreliable ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)';
        ctx.fill();
      }

      lastFrameRef.current = {
        timestamp: now,
        keypoints: detection.keypoints,
        fps_actual: frameTimestampsRef.current.length,
        inference_latency_ms: Math.round(detection.inferenceLatencyMs * 100) / 100,
      };
      setCanExport(true);
    } else {
      setPoseDetected(false);
    }

    rafRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMessage(null);
    setStatus('starting');

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('此瀏覽器不支援攝影機存取（getUserMedia）。');
      setStatus('error');
      return;
    }

    try {
      // allSettled (not all): 若模型載入失敗但攝影機權限已核准，仍需拿到
      // stream 以便立即釋放，避免鏡頭指示燈留在開啟狀態卻無從關閉。
      const [landmarkerResult, streamResult] = await Promise.allSettled([
        getPoseLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
      ]);

      if (streamResult.status === 'fulfilled' && landmarkerResult.status !== 'fulfilled') {
        streamResult.value.getTracks().forEach((track) => track.stop());
      }
      if (landmarkerResult.status !== 'fulfilled') throw landmarkerResult.reason;
      if (streamResult.status !== 'fulfilled') throw streamResult.reason;

      landmarkerRef.current = landmarkerResult.value;
      streamRef.current = streamResult.value;
      const stream = streamResult.value;

      const video = videoRef.current;
      if (!video) throw new Error('視訊元素尚未就緒。');
      video.srcObject = stream;
      await video.play();

      setStatus('streaming');
      rafRef.current = requestAnimationFrame(renderLoop);
    } catch (err: any) {
      console.error('Camera/pose init failed', err);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setErrorMessage(
        err?.name === 'NotAllowedError'
          ? '攝影機權限被拒絕，請在瀏覽器設定中允許存取後重試。'
          : err?.message || '無法啟動攝影機或姿態偵測模型。',
      );
      setStatus('error');
    }
  }, [renderLoop]);

  const exportCurrentFrame = useCallback(() => {
    const frame = lastFrameRef.current;
    if (!frame) return;
    const blob = new Blob([JSON.stringify(frame, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pose-frame-${Math.round(frame.timestamp)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-800 text-xs md:text-sm flex items-start gap-3">
        <AlertCircle className="shrink-0 mt-0.5" size={18} />
        <p>
          技術驗證階段（CV/Pose Agent，消費級定位）：本畫面僅輸出關鍵點座標與信心分數，
          不含步態語意判斷或臨床結論，僅供參考。
        </p>
      </div>

      <div className="relative rounded-2xl md:rounded-3xl overflow-hidden bg-zinc-900 aspect-video">
        <video ref={videoRef} playsInline muted className="absolute w-px h-px opacity-0" />
        <canvas ref={canvasRef} className="w-full h-full object-contain" />

        {status !== 'streaming' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-300 p-6 text-center">
            {status === 'error' ? (
              <>
                <AlertCircle size={40} className="text-red-400" />
                <p className="text-sm max-w-xs">{errorMessage}</p>
              </>
            ) : (
              <>
                <Video size={40} className="opacity-50" />
                <p className="text-sm">
                  {status === 'starting' ? '正在啟動攝影機與姿態偵測模型...' : '按下方按鈕開始即時姿態偵測'}
                </p>
              </>
            )}
          </div>
        )}

        {status === 'streaming' && (
          <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2 font-mono text-[10px] md:text-xs">
            <span className="px-2 py-1 rounded-lg bg-black/60 text-emerald-400">FPS: {fpsActual}</span>
            <span className="px-2 py-1 rounded-lg bg-black/60 text-emerald-400">
              延遲: {latencyMs.toFixed(1)} ms
            </span>
            <span className={`px-2 py-1 rounded-lg bg-black/60 ${poseDetected ? 'text-emerald-400' : 'text-red-400'}`}>
              {poseDetected ? '偵測到姿態' : '未偵測到姿態'}
            </span>
            {poseDetected && (
              <span className={`px-2 py-1 rounded-lg bg-black/60 ${unreliableCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                低信心關鍵點: {unreliableCount}/{trackedCount} (閾值 {CONFIDENCE_THRESHOLD})
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {status !== 'streaming' ? (
          <button
            onClick={startCamera}
            disabled={status === 'starting'}
            className="flex-1 py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-sm md:text-base bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera size={18} />
            {status === 'starting' ? '啟動中...' : '開始即時偵測'}
          </button>
        ) : (
          <button
            onClick={stopCamera}
            className="flex-1 py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-sm md:text-base bg-red-600 text-white hover:bg-red-700"
          >
            <Square size={18} />
            停止
          </button>
        )}
        <button
          onClick={exportCurrentFrame}
          disabled={!canExport}
          className="px-6 py-3 md:py-4 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors text-sm md:text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={16} />
          匯出目前幀 JSON
        </button>
      </div>
    </div>
  );
}
