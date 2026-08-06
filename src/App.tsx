import React, { ErrorInfo, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Archive,
  Calendar,
  ChevronRight,
  Footprints,
  History,
  LogIn,
  LogOut,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';

import { auth, db, googleProvider } from './firebase';
import { analyzeGaitVideo, toStorableAnalysis, type AnalysisProgress } from './services/analyzeGait';
import { GaitUploader } from './components/GaitUploader';
import { GaitReport } from './components/GaitReport';
import { CoachMode } from './components/CoachMode';
import { LegacyPostureReport } from './components/LegacyPostureReport';
import { STATUS, statusForScore } from './components/charts/tokens';
import type { GaitAnalysis, GaitHistoryItem, HistoryItem } from './types/gait';

const LOCAL_GAIT_KEY = 'gait_history';
const LOCAL_LEGACY_KEY = 'posture_history';
const LOCAL_HEIGHT_KEY = 'gait_user_height_cm';
const MAX_LOCAL_HISTORY = 3;

// --- Error handling --------------------------------------------------------

enum OperationType {
  CREATE = 'create',
  DELETE = 'delete',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Logs a Firestore failure with the auth context needed to tell a rules
 * rejection apart from an offline client, then returns a message for the user.
 */
function describeFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): string {
  const user = auth.currentUser;
  console.error(
    'Firestore Error:',
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path,
      authInfo: {
        userId: user?.uid,
        email: user?.email,
        emailVerified: user?.emailVerified,
        isAnonymous: user?.isAnonymous,
        tenantId: user?.tenantId,
        providerInfo:
          user?.providerData.map((p) => ({
            providerId: p.providerId,
            displayName: p.displayName,
            email: p.email,
            photoUrl: p.photoURL,
          })) ?? [],
      },
    }),
  );
  return '雲端同步發生問題,本次結果仍可在此頁檢視。';
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-red-100 bg-white p-8 text-center shadow-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-zinc-900">應用程式發生錯誤</h2>
            <p className="text-sm text-zinc-500">
              很抱歉,系統發生了預期外的錯誤。請嘗試重新整理頁面。
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-zinc-900 py-3 font-bold text-white transition-all hover:bg-zinc-800"
            >
              重新整理
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

// --- History mapping -------------------------------------------------------

/** Records written before the gait rewrite carry no `type`; they are posture. */
function mapHistoryDoc(id: string, data: Record<string, any>): HistoryItem {
  const date =
    data.timestamp instanceof Timestamp
      ? data.timestamp.toDate().toLocaleString('zh-TW')
      : typeof data.timestamp === 'string'
        ? data.timestamp
        : '';

  if (data.type === 'gait') {
    return {
      id,
      type: 'gait',
      date,
      analysis: data.analysis,
      keyFrames: data.keyFrames ?? [],
      userId: data.userId,
    };
  }

  return {
    id,
    type: 'posture',
    date,
    analysis: data.analysis ?? data,
    frontImage: data.frontImage,
    sideImage: data.sideImage,
    userId: data.userId,
  };
}

function readLocalHistory(): HistoryItem[] {
  const parse = (key: string): HistoryItem[] => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const gait = parse(LOCAL_GAIT_KEY).map((i) => ({ ...i, type: 'gait' as const }));
  // Legacy local records predate the `type` field entirely.
  const legacy = parse(LOCAL_LEGACY_KEY).map((i) => ({ ...i, type: 'posture' as const }));
  return [...gait, ...legacy] as HistoryItem[];
}

// --- App -------------------------------------------------------------------

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<GaitAnalysis | null>(null);
  const [keyFrames, setKeyFrames] = useState<string[]>([]);
  const [viewingLegacy, setViewingLegacy] = useState<HistoryItem | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isCoachMode, setIsCoachMode] = useState(false);

  // Auth
  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
  }, []);

  // Remembering height across sessions removes the one bit of friction that
  // stands between the user and every subsequent analysis.
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_HEIGHT_KEY);
    if (saved) {
      const parsed = Number(saved);
      if (parsed >= 100 && parsed <= 230) setHeightCm(parsed);
    }
  }, []);

  useEffect(() => {
    if (heightCm !== null && heightCm >= 100 && heightCm <= 230) {
      localStorage.setItem(LOCAL_HEIGHT_KEY, String(heightCm));
    }
  }, [heightCm]);

  // Connection probe, so a misconfigured Firebase project is visible in the
  // console rather than showing up later as an empty history list.
  useEffect(() => {
    getDocFromServer(doc(db, 'test', 'connection')).catch((e) => {
      if (e instanceof Error && e.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
      }
    });
  }, []);

  // History
  useEffect(() => {
    if (!isAuthReady) return;

    if (!user) {
      setHistory(readLocalHistory());
      return;
    }

    setIsSyncing(true);
    const q = query(
      collection(db, 'history'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(20),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setHistory(snapshot.docs.map((d) => mapHistoryDoc(d.id, d.data())));
        setIsSyncing(false);
      },
      (e) => {
        setIsSyncing(false);
        setError(describeFirestoreError(e, OperationType.GET, 'history'));
      },
    );

    // Push anything recorded while signed out up to the account, once.
    const local = localStorage.getItem(LOCAL_GAIT_KEY);
    if (local) {
      try {
        const items: GaitHistoryItem[] = JSON.parse(local);
        Promise.all(
          items.map((item) =>
            addDoc(collection(db, 'history'), {
              userId: user.uid,
              type: 'gait',
              timestamp: Timestamp.now(),
              score: item.analysis?.metrics?.score ?? 0,
              riskLevel: item.analysis?.metrics?.riskLevel ?? '中',
              analysis: item.analysis,
              keyFrames: item.keyFrames ?? [],
            }),
          ),
        )
          .then(() => localStorage.removeItem(LOCAL_GAIT_KEY))
          .catch((e) => console.error('Migration to Firestore failed', e));
      } catch (e) {
        console.error('Failed to parse local gait history for migration', e);
      }
    }

    return () => unsubscribe();
  }, [user, isAuthReady]);

  /**
   * Writes local history, shedding the oldest records when the browser refuses
   * the write. Gait records carry joint curves and thumbnails, so a handful of
   * them is enough to hit the quota on a tight browser.
   */
  const saveLocalGaitHistory = useCallback((items: GaitHistoryItem[]) => {
    let candidate = items.slice(0, MAX_LOCAL_HISTORY);
    while (candidate.length > 0) {
      try {
        localStorage.setItem(LOCAL_GAIT_KEY, JSON.stringify(candidate));
        return candidate;
      } catch (e) {
        if (
          e instanceof DOMException &&
          (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
        ) {
          candidate = candidate.slice(0, -1);
          continue;
        }
        throw e;
      }
    }
    setError('瀏覽器儲存空間不足,本次記錄未能保存。建議登入以同步至雲端。');
    return [];
  }, []);

  const runAnalysis = async (file: File, frontalFile?: File) => {
    if (heightCm === null) return;

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setViewingLegacy(null);
    setProgress({ stage: 'preparing', message: '準備中…', percent: 0 });

    try {
      const result = await analyzeGaitVideo(file, heightCm, setProgress, frontalFile);
      setAnalysis(result.analysis);
      setKeyFrames(result.keyFrames);

      const storable = toStorableAnalysis(result.analysis, result.keyFrames);

      if (user) {
        try {
          await addDoc(collection(db, 'history'), {
            userId: user.uid,
            type: 'gait',
            timestamp: Timestamp.now(),
            score: result.analysis.metrics.score,
            riskLevel: result.analysis.metrics.riskLevel,
            ...storable,
          });
        } catch (e) {
          setError(describeFirestoreError(e, OperationType.WRITE, 'history'));
        }
      } else {
        const item: GaitHistoryItem = {
          id: Date.now().toString(),
          type: 'gait',
          date: new Date().toLocaleString('zh-TW'),
          analysis: storable.analysis,
          keyFrames: storable.keyFrames,
        };
        setHistory((prev) => {
          const gait = [item, ...prev.filter((h): h is GaitHistoryItem => h.type === 'gait')];
          const saved = saveLocalGaitHistory(gait);
          return [...saved, ...prev.filter((h) => h.type !== 'gait')];
        });
      }
    } catch (e: any) {
      setError(e?.message || '分析過程中發生錯誤,請稍後再試。');
      console.error(e);
    } finally {
      setIsAnalyzing(false);
      setProgress(null);
    }
  };

  const deleteHistoryItem = async (item: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (user) {
      try {
        await deleteDoc(doc(db, 'history', item.id));
      } catch (err) {
        setError(describeFirestoreError(err, OperationType.DELETE, `history/${item.id}`));
      }
      return;
    }

    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== item.id);
      if (item.type === 'gait') {
        saveLocalGaitHistory(next.filter((h): h is GaitHistoryItem => h.type === 'gait'));
      } else {
        localStorage.setItem(
          LOCAL_LEGACY_KEY,
          JSON.stringify(next.filter((h) => h.type === 'posture')),
        );
      }
      return next;
    });
  };

  const openHistoryItem = (item: HistoryItem) => {
    if (item.type === 'gait') {
      setAnalysis(item.analysis);
      setKeyFrames(item.keyFrames ?? []);
      setViewingLegacy(null);
    } else {
      setAnalysis(null);
      setViewingLegacy(item);
    }
    setShowHistory(false);
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error('Login failed', e);
      setError('登入失敗,請稍後再試。');
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setHistory(readLocalHistory());
      setAnalysis(null);
      setViewingLegacy(null);
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  const reset = () => {
    setAnalysis(null);
    setViewingLegacy(null);
    setError(null);
  };

  const showingResult = analysis !== null || viewingLegacy !== null;

  return (
    <div className="min-h-screen bg-zinc-50 p-3 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header className="relative mb-6 pt-12 text-center md:mb-12 md:pt-0">
          <div className="absolute left-0 top-0 flex items-center gap-2">
            {!user ? (
              <button
                onClick={login}
                className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white p-2 text-xs font-medium text-zinc-600 shadow-sm transition-all hover:bg-zinc-50 md:p-3 md:text-sm"
                title="Google 登入"
              >
                <LogIn size={16} className="text-emerald-600" />
                <span className="hidden sm:inline">Google 登入</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white p-1 pr-3 shadow-sm">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || ''}
                    className="h-6 w-6 rounded-full md:h-8 md:w-8"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 md:h-8 md:w-8">
                    <User size={14} />
                  </div>
                )}
                <span className="hidden max-w-[80px] truncate text-[10px] font-bold text-zinc-700 sm:inline md:text-xs">
                  {user.displayName || '使用者'}
                </span>
                <button
                  onClick={logout}
                  className="ml-2 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100"
                  title="登出"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="absolute right-0 top-0">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`flex items-center gap-2 rounded-full p-2 text-xs font-medium transition-all md:p-3 md:text-sm ${
                showHistory
                  ? 'bg-zinc-900 text-white'
                  : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              <History size={16} className="md:h-[18px] md:w-[18px]" />
              <span className="hidden sm:inline">歷史記錄</span>
              {isSyncing ? (
                <RefreshCw size={12} className="animate-spin text-emerald-500" />
              ) : (
                history.length > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white md:h-5 md:w-5">
                    {history.length}
                  </span>
                )
              )}
            </button>
          </div>

          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-semibold text-emerald-700 md:mb-4 md:text-xs"
          >
            <Footprints size={12} className="md:h-3.5 md:w-3.5" />
            AI 動態步態分析系統
          </motion.div>
          <h1 className="mb-3 text-3xl font-bold tracking-tight text-zinc-900 md:mb-4 md:text-5xl">
            步態分析
          </h1>
          <p className="mx-auto max-w-2xl px-4 text-sm text-zinc-500 md:px-0 md:text-base">
            上傳一段走路影片,系統以骨架追蹤逐幀量測你的步頻、步長、關節活動度與左右對稱性,
            並由 AI 影像判讀獨立交叉驗證後,提供臨床解讀與運動處方。
          </p>
        </header>

        <main className="grid grid-cols-1 gap-4 md:gap-8 lg:grid-cols-12">
          {/* Left: input or history */}
          <div className="space-y-6 lg:col-span-5">
            <AnimatePresence mode="wait">
              {showHistory ? (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
                      <History size={20} /> 歷史記錄
                    </h2>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-sm font-semibold text-emerald-600 hover:underline"
                    >
                      返回分析
                    </button>
                  </div>

                  {history.length === 0 ? (
                    <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center text-zinc-400">
                      <History size={48} className="mx-auto mb-4 opacity-20" />
                      <p>目前尚無歷史記錄</p>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {history.map((item) => {
                        const isGait = item.type === 'gait';
                        const score = isGait
                          ? item.analysis?.metrics?.score
                          : item.analysis?.score;
                        const summary = isGait
                          ? item.analysis?.interpretation?.summary
                          : item.analysis?.summary;
                        const thumb = isGait ? item.keyFrames?.[0] : item.frontImage;

                        return (
                          <motion.div
                            key={item.id}
                            layout
                            onClick={() => openHistoryItem(item)}
                            className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 transition-all hover:border-emerald-500 hover:shadow-md"
                          >
                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-zinc-300">
                                  <Activity size={20} />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-center gap-2">
                                {isGait ? (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                    <Footprints size={9} /> 步態
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">
                                    <Archive size={9} /> 舊版體態
                                  </span>
                                )}
                                <Calendar size={10} className="text-zinc-400" />
                                <span className="truncate text-[10px] font-medium text-zinc-400">
                                  {item.date}
                                </span>
                              </div>
                              <h3 className="truncate text-xs font-bold text-zinc-900">
                                {summary || '分析記錄'}
                              </h3>
                              {typeof score === 'number' && (
                                <span
                                  className="text-[11px] font-black"
                                  style={{ color: STATUS[statusForScore(score)] }}
                                >
                                  分數 {score}
                                </span>
                              )}
                            </div>

                            <button
                              onClick={(e) => deleteHistoryItem(item, e)}
                              className="p-1.5 text-zinc-300 transition-colors hover:text-red-500"
                              aria-label="刪除這筆記錄"
                            >
                              <Trash2 size={16} />
                            </button>
                            <ChevronRight
                              size={18}
                              className="text-zinc-300 transition-colors group-hover:text-emerald-500"
                            />
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <GaitUploader
                    heightCm={heightCm}
                    onHeightChange={setHeightCm}
                    onAnalyze={runAnalysis}
                    isAnalyzing={isAnalyzing}
                    progress={progress}
                    error={error}
                  />
                  {showingResult && !isAnalyzing && (
                    <button
                      onClick={reset}
                      className="mt-4 w-full rounded-xl border border-zinc-200 py-3 text-sm text-zinc-600 transition-colors hover:bg-zinc-100"
                    >
                      清除目前結果
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right: results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {analysis ? (
                <GaitReport
                  key="gait"
                  analysis={analysis}
                  keyFrames={keyFrames}
                  onStartCoach={() => setIsCoachMode(true)}
                />
              ) : viewingLegacy && viewingLegacy.type === 'posture' ? (
                <LegacyPostureReport key="legacy" item={viewingLegacy} />
              ) : (
                <div
                  key="empty"
                  className="flex min-h-[400px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-zinc-200 p-8 text-center text-zinc-400"
                >
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100">
                    <Footprints size={32} />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-zinc-900">等待分析</h3>
                  <p className="max-w-[260px] text-sm">
                    輸入身高並上傳一段側面走路影片,即可取得完整的步態量測報告。
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </main>

        <AnimatePresence>
          {isCoachMode && analysis && (
            <CoachMode
              exercises={analysis.interpretation.exercises}
              onClose={() => setIsCoachMode(false)}
            />
          )}
        </AnimatePresence>

        <footer className="mt-8 border-t border-zinc-200 pt-6 text-center md:mt-16 md:pt-8">
          <div className="flex flex-wrap justify-center gap-4 text-[10px] font-medium uppercase tracking-widest text-zinc-400 md:gap-8 md:text-xs">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 md:h-2 md:w-2" />
              骨架追蹤實際量測
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 md:h-2 md:w-2" />
              雙軌交叉驗證
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 md:h-2 md:w-2" />
              影片不離開裝置
            </span>
          </div>
          <p className="mx-auto mt-6 max-w-2xl px-4 text-[10px] leading-relaxed text-zinc-400 md:mt-8 md:text-xs">
            * 本工具以單一鏡頭進行 2D 步態量測,絕對長度類指標(步長、步幅、速度)存在約
            10–15% 誤差,對稱性與關節角度指標可靠度較高。本工具僅供健康參考,
            <b className="text-zinc-500">不具備醫療診斷功能</b>,不可取代專業臨床評估。
            如有疼痛、跌倒風險或神經肌肉症狀,請諮詢專業醫師或物理治療師。
          </p>
        </footer>
      </div>
    </div>
  );
}
