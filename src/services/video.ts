// Utilities for turning a user-supplied gait video (e.g. a clip shot on an
// iPhone) into a small set of JPEG frames that can be sent to the AI model.

export interface ExtractedFrames {
  frames: string[]; // data URLs, ordered by time
  timestamps: number[]; // seconds, aligned with `frames`
  poster: string; // small thumbnail used for history cards
  duration: number;
  width: number;
  height: number;
}

export interface ExtractOptions {
  maxFrames?: number;
  maxSize?: number;
  quality?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_MAX_FRAMES = 12;
const DEFAULT_MAX_SIZE = 640;
const DEFAULT_QUALITY = 0.72;
const MAX_WINDOW_SECONDS = 8; // a few gait cycles is plenty

function drawToDataUrl(video: HTMLVideoElement, maxSize: number, quality: number) {
  let width = video.videoWidth;
  let height = video.videoHeight;

  if (width > height) {
    if (width > maxSize) {
      height *= maxSize / width;
      width = maxSize;
    }
  } else {
    if (height > maxSize) {
      width *= maxSize / height;
      height = maxSize;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援 Canvas，無法讀取影片畫面。');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function once(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`影片處理逾時（${event}），請改用較短或較小的影片。`));
    }, timeoutMs);

    const onDone = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('無法讀取此影片格式，請改用 MP4 / MOV（H.264）影片。'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onDone);
      el.removeEventListener('error', onError);
    };

    el.addEventListener(event, onDone, { once: true });
    el.addEventListener('error', onError, { once: true });
  });
}

// Videos recorded on iOS sometimes report `Infinity` until they have been
// seeked once. Nudge the element to force the real duration to appear.
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  await new Promise<void>((resolve) => {
    const onTimeUpdate = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.removeEventListener('timeupdate', onTimeUpdate);
        resolve();
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.currentTime = 1e101;
    setTimeout(() => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      resolve();
    }, 3000);
  });

  video.currentTime = 0;
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
}

export async function extractFrames(file: File, options: ExtractOptions = {}): Promise<ExtractedFrames> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  (video as any).webkitPlaysinline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  try {
    await once(video, 'loadedmetadata', 30000);
    const duration = await resolveDuration(video);
    if (!duration) {
      throw new Error('無法取得影片長度，請改用其他影片。');
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('無法讀取影片畫面尺寸，請改用 MP4 / MOV（H.264）影片。');
    }

    // Use a window in the middle of the clip: the person is usually already
    // walking there, and the very first/last frames are often blurred.
    const window = Math.min(duration, MAX_WINDOW_SECONDS);
    const start = Math.max(0, (duration - window) / 2);
    const end = Math.min(duration - 0.05, start + window);
    const count = Math.max(2, Math.min(maxFrames, Math.round(window * 2))); // ~2 fps
    const step = (end - start) / (count - 1);

    const frames: string[] = [];
    const timestamps: number[] = [];

    for (let i = 0; i < count; i++) {
      const time = Math.min(end, start + step * i);
      video.currentTime = time;
      await once(video, 'seeked', 15000);
      frames.push(drawToDataUrl(video, maxSize, quality));
      timestamps.push(Number(time.toFixed(2)));
      options.onProgress?.(i + 1, count);
    }

    // Small still for history cards / previews.
    video.currentTime = Math.min(end, start + window / 2);
    await once(video, 'seeked', 15000);
    const poster = drawToDataUrl(video, 320, 0.7);

    return {
      frames,
      timestamps,
      poster,
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
