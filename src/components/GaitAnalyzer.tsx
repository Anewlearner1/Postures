import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, Calendar, Film, History, Lightbulb, RefreshCw, Trash2, Upload, Video,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, Timestamp, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { extractFrames } from '../services/video';
import { analyzeGait, GaitAnalysis } from '../services/gait';

const LOCAL_KEY = 'gait_history';
const MAX_LOCAL_HISTORY = 3;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — an iPhone clip of a few seconds is far smaller

interface GaitHistoryItem {
  id: string;
  date: string;
  analysis: GaitAnalysis;
  poster: string;
}

interface GaitAnalyzerProps {
  user: FirebaseUser | null;
}

const metricLabels: Record<string, { label: string; unit: string }> = {
  cadence: { label: '步頻', unit: '步/分' },
  strideSymmetry: { label: '步幅對稱度', unit: '%' },
  trunkLeanAngle: { label: '軀幹傾斜', unit: '°' },
  kneeFlexionSwing: { label: '擺動期膝屈曲', unit: '°' },
  footProgressionAngle: { label: '足偏角', unit: '°' },
  armSwingSymmetry: { label: '手臂擺動對稱度', unit: '%' },
};

const breakdownLabels: Record<string, string> = {
  symmetry: '對稱性',
  rhythm: '節律性',
  stability: '穩定性',
  efficiency: '效率性',
};

export default function GaitAnalyzer({ user }: GaitAnalyzerProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [frames, setFrames] = useState<string[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [poster, setPoster] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<GaitAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GaitHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  // History: Firestore when signed in, localStorage otherwise.
  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'gaitHistory'),
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(20),
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setHistory(snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            date: data.timestamp instanceof Timestamp
              ? data.timestamp.toDate().toLocaleString('zh-TW')
              : String(data.timestamp ?? ''),
            analysis: data.analysis,
            poster: data.poster,
          };
        }));
      }, (err) => {
        console.error('Gait history sync failed', err);
      });
      return () => unsubscribe();
    }

    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      setHistory(saved ? JSON.parse(saved) : []);
    } catch (e) {
      console.error('Failed to parse gait history', e);
      setHistory([]);
    }
    return undefined;
  }, [user]);

  const saveLocalHistory = useCallback((items: GaitHistoryItem[]) => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(items.slice(0, MAX_LOCAL_HISTORY)));
    } catch (e) {
      console.error('Failed to persist gait history', e);
    }
  }, []);

  const resetVideo = () => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
    setVideoUrl(null);
    setVideoName('');
    setFrames([]);
    setTimestamps([]);
    setPoster(null);
    setDuration(0);
    setProgress(null);
    setAnalysis(null);
    setError(null);
  };

  const handleVideoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;

    if (file.size > MAX_VIDEO_BYTES) {
      setError('影片檔案過大（超過 200MB），請上傳 5-10 秒的短片。');
      return;
    }

    resetVideo();
    const url = URL.createObjectURL(file);
    videoUrlRef.current = url;
    setVideoUrl(url);
    setVideoName(file.name);
    setIsExtracting(true);

    try {
      const result = await extractFrames(file, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setFrames(result.frames);
      setTimestamps(result.timestamps);
      setPoster(result.poster);
      setDuration(result.duration);
    } catch (err: any) {
      setError(err.message || '無法讀取此影片，請改用其他格式。');
      setFrames([]);
    } finally {
      setIsExtracting(false);
      setProgress(null);
    }
  };

  const runAnalysis = async () => {
    if (frames.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeGait(frames, { duration, timestamps });
      setAnalysis(result);

      if (user) {
        try {
          await addDoc(collection(db, 'gaitHistory'), {
            userId: user.uid,
            timestamp: Timestamp.now(),
            analysis: result,
            poster: poster ?? '',
            score: result.score,
            riskLevel: result.riskLevel,
          });
        } catch (e) {
          console.error('Failed to save gait history', e);
        }
      } else {
        const item: GaitHistoryItem = {
          id: Date.now().toString(),
          date: new Date().toLocaleString('zh-TW'),
          analysis: result,
          poster: poster ?? '',
        };
        setHistory((prev) => {
          const next = [item, ...prev].slice(0, MAX_LOCAL_HISTORY);
          saveLocalHistory(next);
          return next;
        });
      }
    } catch (err: any) {
      setError(err.message || '步態分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    if (user) {
      try {
        await deleteDoc(doc(db, 'gaitHistory', id));
      } catch (e) {
        console.error('Failed to delete gait history item', e);
      }
      return;
    }
    setHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveLocalHistory(next);
      return next;
    });
  };

  const scoreColor = useMemo(() => {
    if (!analysis) return '';
    return analysis.score >= 80 ? 'text-emerald-600' : analysis.score >= 60 ? 'text-amber-600' : 'text-red-600';
  }, [analysis]);

  const busy = isExtracting || isAnalyzing;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8">
      {/* Upload column */}
      <div className="lg:col-span-7 space-y-4 md:space-y-6">
        <div className="glass-panel rounded-2xl md:rounded-3xl p-4 md:p-8 space-y-4 md:space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg md:text-xl font-bold text-zinc-900 flex items-center gap-2">
                <Video size={20} className="text-emerald-600" /> 上傳步態影片
              </h2>
              <p className="text-xs md:text-sm text-zinc-500 mt-1">
                用手機錄一段 5-10 秒的走路影片，直接上傳即可進行 AI 步態分析。
              </p>
            </div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`shrink-0 p-2 rounded-full transition-all flex items-center gap-2 text-xs font-medium
                ${showHistory ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'}`}
            >
              <History size={16} />
              <span className="hidden sm:inline">步態記錄</span>
              {history.length > 0 && (
                <span className="bg-emerald-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
                  {history.length}
                </span>
              )}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {showHistory ? (
              <motion.div
                key="gait-history"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-3"
              >
                {history.length === 0 ? (
                  <div className="p-10 text-center rounded-2xl border-2 border-dashed border-zinc-200 text-zinc-400">
                    <History size={40} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">目前尚無步態分析記錄</p>
                  </div>
                ) : history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => { setAnalysis(item.analysis); setShowHistory(false); }}
                    className="group p-3 rounded-2xl bg-white border border-zinc-200 hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer flex items-center gap-3"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-zinc-100 bg-zinc-100">
                      {item.poster
                        ? <img src={item.poster} alt="步態縮圖" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        : <Film size={20} className="text-zinc-300 m-auto mt-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 text-[10px] text-zinc-400 font-medium">
                        <Calendar size={12} /> {item.date}
                      </div>
                      <h3 className="text-sm font-bold text-zinc-900 truncate">{item.analysis.summary}</h3>
                      <span className={`text-xs font-black ${item.analysis.score >= 80 ? 'text-emerald-600' : item.analysis.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        分數: {item.analysis.score}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                      className="p-2 text-zinc-300 hover:text-red-500 transition-colors"
                      title="刪除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="gait-upload"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-4"
              >
                <div
                  onClick={() => !busy && fileInputRef.current?.click()}
                  className={`rounded-2xl border-2 border-dashed overflow-hidden transition-all
                    ${videoUrl ? 'border-emerald-500 bg-black' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-100/50 cursor-pointer'}`}
                >
                  {videoUrl ? (
                    <video
                      src={videoUrl}
                      controls
                      playsInline
                      muted
                      className="w-full max-h-[420px] bg-black"
                    />
                  ) : (
                    <div className="text-center py-12 md:py-16 px-4">
                      <div className="w-14 h-14 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4">
                        <Upload className="text-zinc-400" size={22} />
                      </div>
                      <p className="text-sm font-semibold text-zinc-700">點擊選擇或拍攝影片</p>
                      <p className="text-xs text-zinc-400 mt-1">支援 iPhone 相簿影片（MP4 / MOV）</p>
                    </div>
                  )}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleVideoSelected}
                  accept="video/*"
                  className="hidden"
                />

                {videoName && (
                  <p className="text-[11px] text-zinc-400 truncate">
                    已選擇：{videoName}
                    {duration > 0 && `（${duration.toFixed(1)} 秒）`}
                  </p>
                )}

                {isExtracting && (
                  <div className="p-4 rounded-xl bg-zinc-100 text-zinc-600 flex items-center gap-3">
                    <RefreshCw className="animate-spin shrink-0" size={18} />
                    <p className="text-sm font-medium">
                      正在擷取影片畫面
                      {progress ? `（${progress.done}/${progress.total}）` : '...'}
                    </p>
                  </div>
                )}

                {frames.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                      擷取畫面 ({frames.length})
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {frames.map((frame, i) => (
                        <img
                          key={i}
                          src={frame}
                          alt={`影格 ${i + 1}`}
                          className="h-20 rounded-lg border border-zinc-200 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={runAnalysis}
                    disabled={frames.length === 0 || busy}
                    className={`flex-1 py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-sm md:text-base
                      ${frames.length === 0 || busy
                        ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-lg shadow-zinc-200 active:scale-[0.98]'}`}
                  >
                    {isAnalyzing ? (
                      <><RefreshCw className="animate-spin" size={18} /> 正在分析步態...</>
                    ) : (
                      <><Activity size={18} /> 開始 AI 步態分析</>
                    )}
                  </button>

                  {videoUrl && !busy && (
                    <button
                      onClick={resetVideo}
                      className="px-6 py-3 md:py-4 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors text-sm md:text-base"
                    >
                      重新上傳
                    </button>
                  )}
                </div>

                {error && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-600 flex items-start gap-3">
                    <AlertCircle className="shrink-0 mt-0.5" size={18} />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 space-y-1">
                  <p className="text-xs font-bold flex items-center gap-2"><Lightbulb size={14} /> 拍攝建議</p>
                  <ul className="text-[11px] leading-relaxed list-disc pl-5 text-emerald-700">
                    <li>請他人於正面或側面固定手機拍攝，走 5-10 秒、約 3-5 步以上。</li>
                    <li>全身入鏡（含腳掌），背景單純、光線充足。</li>
                    <li>穿著貼身衣物、可赤腳或穿平底鞋，以利關節辨識。</li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Result column */}
      <div className="lg:col-span-5">
        <AnimatePresence mode="wait">
          {analysis ? (
            <motion.div
              key="gait-result"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass-panel rounded-2xl md:rounded-3xl p-4 md:p-8 sticky top-8 space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg md:text-xl font-bold text-zinc-900">步態分析結果</h2>
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">總體評分</span>
                    <span className={`text-2xl md:text-3xl font-black ${scoreColor}`}>{analysis.score}</span>
                  </div>
                  <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider
                    ${analysis.riskLevel === '低' ? 'bg-emerald-100 text-emerald-700'
                      : analysis.riskLevel === '中' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}
                  >
                    風險: {analysis.riskLevel}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:gap-4">
                {Object.entries(analysis.scoreBreakdown || {}).map(([key, value]) => (
                  <div key={key} className="space-y-1 md:space-y-2">
                    <div className="flex justify-between text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <span>{breakdownLabels[key] || key}</span>
                      <span>{value}/25</span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, ((value as number) / 25) * 100)}%` }}
                        className="h-full bg-emerald-500 rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-zinc-900 text-zinc-100 text-sm leading-relaxed">
                {analysis.summary}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {Object.entries(analysis.metrics || {}).map(([key, value]) => {
                  const meta = metricLabels[key];
                  if (!meta) return null;
                  return (
                    <div key={key} className="p-3 rounded-xl bg-white border border-zinc-200">
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{meta.label}</p>
                      <p className="text-lg font-black text-zinc-900 font-mono">
                        {typeof value === 'number' ? value : '—'}
                        <span className="text-[10px] font-medium text-zinc-400 ml-1">{meta.unit}</span>
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">分段觀察</h3>
                {Object.entries(analysis.observations || {}).map(([key, value]) => {
                  const labels: Record<string, string> = {
                    head: '頭頸', trunk: '軀幹', pelvis: '骨盆', knees: '膝關節', feet: '足踝著地', armSwing: '手臂擺動',
                  };
                  return (
                    <div key={key} className="p-3 rounded-xl bg-white border border-zinc-200">
                      <p className="text-xs font-bold text-zinc-900 mb-1">{labels[key] || key}</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">{String(value)}</p>
                    </div>
                  );
                })}
              </div>

              {analysis.abnormalPatterns?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">異常步態型態</h3>
                  {analysis.abnormalPatterns.map((pattern, i) => (
                    <div key={i} className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs font-bold text-amber-900">{pattern.name}</p>
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          {pattern.severity}
                        </span>
                      </div>
                      <p className="text-xs text-amber-700 leading-relaxed">{pattern.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {analysis.recommendations?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">專業建議</h3>
                  <ul className="space-y-2">
                    {analysis.recommendations.map((rec, i) => (
                      <li key={i} className="text-xs text-zinc-600 leading-relaxed flex gap-2">
                        <span className="text-emerald-500 font-black">·</span>{rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.exercises?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">建議訓練</h3>
                  {analysis.exercises.map((exercise, i) => (
                    <div key={i} className="p-3 rounded-xl bg-white border border-zinc-200 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-zinc-900">{exercise.name}</p>
                        <span className="text-[9px] font-bold text-zinc-400">{exercise.duration}</span>
                      </div>
                      <p className="text-xs text-zinc-500 leading-relaxed">{exercise.description}</p>
                      {exercise.steps?.length > 0 && (
                        <ol className="text-[11px] text-zinc-500 list-decimal pl-4 space-y-0.5 pt-1">
                          {exercise.steps.map((step, s) => <li key={s}>{step}</li>)}
                        </ol>
                      )}
                      {exercise.coachTip && (
                        <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-lg p-2 mt-1">
                          💡 {exercise.coachTip}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="gait-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-2xl md:rounded-3xl border-2 border-dashed border-zinc-200 p-10 text-center text-zinc-400 sticky top-8"
            >
              <Film size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm">上傳走路影片後，這裡會顯示完整的步態分析報告。</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
