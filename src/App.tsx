import React, { useState, useRef, useCallback, useEffect, ErrorInfo, ReactNode } from 'react';
import { Camera, Upload, RefreshCw, CheckCircle2, AlertCircle, ChevronRight, User, Activity, Info, History, Trash2, Calendar, Play, X, ChevronLeft, Timer, Lightbulb, LogIn, LogOut, ShieldCheck, Footprints } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzePosture, PostureAnalysis, Exercise } from './services/gemini';
import GaitAnalyzer from './components/GaitAnalyzer';
import { auth, db, googleProvider, appleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, where, getDocs, onSnapshot, deleteDoc, doc, orderBy, limit, getDocFromServer, Timestamp } from 'firebase/firestore';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-50">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-red-100 text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-zinc-900">應用程式發生錯誤</h2>
            <p className="text-zinc-500 text-sm">
              很抱歉，系統發生了預期外的錯誤。請嘗試重新整理頁面。
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all"
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

type ViewType = 'front' | 'side';

interface HistoryItem {
  id: string;
  date: string;
  analysis: PostureAnalysis;
  frontImage: string;
  sideImage: string;
  userId?: string;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

type AnalysisMode = 'posture' | 'gait';

function AppContent() {
  const [mode, setMode] = useState<AnalysisMode>('posture');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [sideImage, setSideImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isCoachMode, setIsCoachMode] = useState(false);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [timer, setTimer] = useState(0);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<ViewType | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Timer logic
  useEffect(() => {
    let interval: any;
    if (isTimerActive && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      setIsTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timer]);

  const startExerciseTimer = (durationStr: string) => {
    const seconds = parseInt(durationStr) || 30;
    setTimer(seconds);
    setIsTimerActive(true);
  };

  // Load history logic
  useEffect(() => {
    if (!isAuthReady) return;

    if (user) {
      // Sync from Firestore
      setIsSyncing(true);
      const q = query(
        collection(db, 'history'),
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(20)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items: HistoryItem[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            date: data.timestamp instanceof Timestamp ? data.timestamp.toDate().toLocaleString('zh-TW') : data.timestamp,
            analysis: data.analysis || data, // Handle different data structures if any
            frontImage: data.frontImage,
            sideImage: data.sideImage,
            userId: data.userId
          };
        });
        setHistory(items);
        setIsSyncing(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'history');
      });

      // Migrate local history to Firestore
      const localHistory = localStorage.getItem('posture_history');
      if (localHistory) {
        try {
          const items: HistoryItem[] = JSON.parse(localHistory);
          if (items.length > 0) {
            items.forEach(async (item) => {
              try {
                await addDoc(collection(db, 'history'), {
                  userId: user.uid,
                  timestamp: Timestamp.now(),
                  analysis: item.analysis,
                  frontImage: item.frontImage,
                  sideImage: item.sideImage,
                  score: item.analysis.score,
                  riskLevel: item.analysis.riskLevel
                });
              } catch (e) {
                console.error("Migration failed for item", item.id, e);
              }
            });
            localStorage.removeItem('posture_history');
          }
        } catch (e) {
          console.error("Failed to parse local history for migration", e);
        }
      }

      return () => unsubscribe();
    } else {
      // Load from localStorage if not logged in
      const savedHistory = localStorage.getItem('posture_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error("Failed to parse history", e);
        }
      }
    }
  }, [user, isAuthReady]);

  // Save history to localStorage (only if NOT logged in)
  useEffect(() => {
    if (user) return; // Don't save to localStorage if logged in

    const saveToLocalStorage = (items: HistoryItem[]) => {
      try {
        localStorage.setItem('posture_history', JSON.stringify(items));
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          if (items.length > 1) {
            const reducedItems = items.slice(0, -1);
            saveToLocalStorage(reducedItems);
            setHistory(reducedItems);
          } else {
            setError("儲存空間不足，無法儲存此次分析記錄。建議登入以同步至雲端。");
          }
        }
      }
    };

    if (history.length > 0) {
      const MAX_HISTORY = 5;
      if (history.length > MAX_HISTORY) {
        setHistory(prev => prev.slice(0, MAX_HISTORY));
      } else {
        saveToLocalStorage(history);
      }
    } else {
      localStorage.setItem('posture_history', JSON.stringify([]));
    }
  }, [history, user]);

  const login = async (provider: 'google' | 'apple') => {
    try {
      const authProvider = provider === 'google' ? googleProvider : appleProvider;
      await signInWithPopup(auth, authProvider);
    } catch (e: any) {
      console.error("Login failed", e);
      setError("登入失敗，請稍後再試。");
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setHistory([]);
      reset();
    } catch (e: any) {
      console.error("Logout failed", e);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeView) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          // Resize image to max 800px width/height to save space
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const resizedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          if (activeView === 'front') setFrontImage(resizedBase64);
          else setSideImage(resizedBase64);
          setActiveView(null);
        };
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = (view: ViewType) => {
    setActiveView(view);
    fileInputRef.current?.click();
  };

  const runAnalysis = async () => {
    if (!frontImage || !sideImage) return;
    
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzePosture(frontImage, sideImage);
      setAnalysis(result);
      
      // Save to history
      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        date: new Date().toLocaleString('zh-TW'),
        analysis: result,
        frontImage,
        sideImage,
        userId: user?.uid
      };

      if (user) {
        try {
          await addDoc(collection(db, 'history'), {
            userId: user.uid,
            timestamp: Timestamp.now(),
            analysis: result,
            frontImage,
            sideImage,
            score: result.score,
            riskLevel: result.riskLevel
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, 'history');
        }
      } else {
        setHistory(prev => [newHistoryItem, ...prev]);
      }
    } catch (err: any) {
      setError(err.message || "分析過程中發生錯誤，請稍後再試。");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (user) {
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `history/${id}`);
      }
    } else {
      setHistory(prev => prev.filter(item => item.id !== id));
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setAnalysis(item.analysis);
    setFrontImage(item.frontImage);
    setSideImage(item.sideImage);
    setShowHistory(false);
  };

  const reset = () => {
    setFrontImage(null);
    setSideImage(null);
    setAnalysis(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-3 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-6 md:mb-12 text-center relative pt-12 md:pt-0">
          <div className="absolute left-0 top-0 flex items-center gap-2">
            {!user ? (
              <div className="flex gap-2">
                <button 
                  onClick={() => login('google')}
                  className="p-2 md:p-3 bg-white border border-zinc-200 rounded-full text-zinc-600 hover:bg-zinc-50 transition-all flex items-center gap-2 text-xs md:text-sm font-medium shadow-sm"
                  title="Google 登入"
                >
                  <LogIn size={16} className="text-emerald-600" />
                  <span className="hidden sm:inline">Google 登入</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-full p-1 pr-3 shadow-sm">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 md:w-8 md:h-8 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                      <User size={14} />
                    </div>
                  )}
                  <span className="text-[10px] md:text-xs font-bold text-zinc-700 hidden sm:inline truncate max-w-[80px]">
                    {user.displayName || '使用者'}
                  </span>
                  <button 
                    onClick={logout}
                    className="ml-2 p-1 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                    title="登出"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={`absolute right-0 top-0 md:top-0 ${mode === 'gait' ? 'hidden' : ''}`}>
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 md:p-3 rounded-full transition-all flex items-center gap-2 text-xs md:text-sm font-medium
                ${showHistory ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'}`}
            >
              <History size={16} className="md:w-[18px] md:h-[18px]" />
              <span className="hidden sm:inline">歷史記錄</span>
              {isSyncing ? (
                <RefreshCw size={12} className="animate-spin text-emerald-500" />
              ) : history.length > 0 && (
                <span className="bg-emerald-500 text-white text-[10px] w-4 h-4 md:w-5 md:h-5 flex items-center justify-center rounded-full">
                  {history.length}
                </span>
              )}
            </button>
          </div>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] md:text-xs font-semibold mb-3 md:mb-4"
          >
            <Activity size={12} className="md:w-[14px] md:h-[14px]" />
            {mode === 'gait' ? 'AI 步態檢測系統' : 'AI 姿勢檢測系統'}
          </motion.div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900 mb-3 md:mb-4">
            {mode === 'gait' ? '步態動作分析' : '體態排列分析'}
          </h1>
          <p className="text-zinc-500 text-sm md:text-base max-w-2xl mx-auto px-4 md:px-0">
            {mode === 'gait'
              ? '直接上傳一段手機拍攝的走路影片，AI 會擷取連續畫面並分析您的步態週期、對稱性與代償問題。'
              : '透過正面與側面的照片，利用 AI 深度分析您的身體排列，檢測潛在的姿勢異常並提供專業建議。'}
          </p>
        </header>

        {/* Mode Tabs */}
        <div className="flex justify-center mb-6 md:mb-8">
          <div className="inline-flex p-1 bg-white border border-zinc-200 rounded-full shadow-sm">
            <button
              onClick={() => setMode('posture')}
              className={`px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold flex items-center gap-2 transition-all
                ${mode === 'posture' ? 'bg-zinc-900 text-white shadow' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              <User size={16} /> 體態分析
            </button>
            <button
              onClick={() => setMode('gait')}
              className={`px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold flex items-center gap-2 transition-all
                ${mode === 'gait' ? 'bg-zinc-900 text-white shadow' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              <Footprints size={16} /> 步態分析
            </button>
          </div>
        </div>

        {mode === 'gait' ? (
          <GaitAnalyzer user={user} />
        ) : (
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8">
          {/* Left Section: Upload or History */}
          <div className="lg:col-span-7 space-y-6">
            <AnimatePresence mode="wait">
              {showHistory ? (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                      <History size={20} /> 歷史分析記錄
                    </h2>
                    <div className="flex items-center gap-4">
                      {history.length > 0 && (
                        <button 
                          onClick={() => {
                            if (window.confirm("確定要清除所有歷史記錄嗎？")) {
                              setHistory([]);
                            }
                          }}
                          className="text-xs text-red-500 font-semibold hover:underline flex items-center gap-1"
                        >
                          <Trash2 size={14} />
                          清除全部
                        </button>
                      )}
                      <button 
                        onClick={() => setShowHistory(false)}
                        className="text-sm text-emerald-600 font-semibold hover:underline"
                      >
                        返回分析
                      </button>
                    </div>
                  </div>

                  {history.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-zinc-200 text-zinc-400">
                      <History size={48} className="mx-auto mb-4 opacity-20" />
                      <p>目前尚無歷史記錄</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {history.map((item) => (
                        <motion.div
                          key={item.id}
                          layout
                          onClick={() => loadHistoryItem(item)}
                          className="group p-4 rounded-2xl bg-white border border-zinc-200 hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer flex items-center gap-4"
                        >
                          <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-zinc-100">
                            <img src={item.frontImage} alt="Thumbnail" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Calendar size={12} className="text-zinc-400" />
                              <span className="text-xs font-medium text-zinc-400">{item.date}</span>
                            </div>
                            <h3 className="text-sm font-bold text-zinc-900 truncate">
                              {item.analysis.summary}
                            </h3>
                            <div className="flex items-center gap-3 mt-1">
                              <span className={`text-xs font-black ${item.analysis.score >= 80 ? 'text-emerald-600' : item.analysis.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                分數: {item.analysis.score}
                              </span>
                              <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
                                風險: {item.analysis.riskLevel}
                              </span>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-2 text-zinc-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                          <ChevronRight size={20} className="text-zinc-300 group-hover:text-emerald-500 transition-colors" />
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-2 md:grid-cols-2 gap-4 md:gap-6">
                    {/* Front View */}
                    <div className="space-y-2 md:space-y-3">
                      <label className="text-xs md:text-sm font-medium text-zinc-700 flex items-center gap-2">
                        <User size={14} className="md:w-[16px] md:h-[16px]" /> 正面照片
                      </label>
                      <div 
                        onClick={() => triggerUpload('front')}
                        className={`aspect-[3/4] rounded-xl md:rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative
                          ${frontImage ? 'border-emerald-500 bg-white' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-100/50'}`}
                      >
                        {frontImage ? (
                          <>
                            <img src={frontImage} alt="Front view" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
                              <RefreshCw className="text-white" />
                            </div>
                          </>
                        ) : (
                          <div className="text-center p-2 md:p-6">
                            <div className="w-8 h-8 md:w-12 md:h-12 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-2 md:mb-4">
                              <Camera className="text-zinc-400" size={18} />
                            </div>
                            <p className="text-[10px] md:text-sm text-zinc-500 font-medium">點擊上傳</p>
                            <p className="hidden md:block text-xs text-zinc-400 mt-1">請確保全身入鏡</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Side View */}
                    <div className="space-y-2 md:space-y-3">
                      <label className="text-xs md:text-sm font-medium text-zinc-700 flex items-center gap-2">
                        <User size={14} className="md:w-[16px] md:h-[16px] rotate-90" /> 側面照片
                      </label>
                      <div 
                        onClick={() => triggerUpload('side')}
                        className={`aspect-[3/4] rounded-xl md:rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative
                          ${sideImage ? 'border-emerald-500 bg-white' : 'border-zinc-300 hover:border-zinc-400 bg-zinc-100/50'}`}
                      >
                        {sideImage ? (
                          <>
                            <img src={sideImage} alt="Side view" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
                              <RefreshCw className="text-white" />
                            </div>
                          </>
                        ) : (
                          <div className="text-center p-2 md:p-6">
                            <div className="w-8 h-8 md:w-12 md:h-12 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-2 md:mb-4">
                              <Camera className="text-zinc-400" size={18} />
                            </div>
                            <p className="text-[10px] md:text-sm text-zinc-500 font-medium">點擊上傳</p>
                            <p className="hidden md:block text-xs text-zinc-400 mt-1">請保持自然站姿</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />

                  <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                    <button
                      onClick={runAnalysis}
                      disabled={!frontImage || !sideImage || isAnalyzing}
                      className={`flex-1 py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-sm md:text-base
                        ${!frontImage || !sideImage || isAnalyzing 
                          ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' 
                          : 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-lg shadow-zinc-200 active:scale-[0.98]'}`}
                    >
                      {isAnalyzing ? (
                        <>
                          <RefreshCw className="animate-spin" size={18} />
                          正在分析中...
                        </>
                      ) : (
                        <>
                          <Activity size={18} />
                          開始 AI 姿勢分析
                        </>
                      )}
                    </button>
                    
                    {(frontImage || sideImage) && !isAnalyzing && (
                      <button 
                        onClick={reset}
                        className="px-6 py-3 md:py-4 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors text-sm md:text-base"
                      >
                        重置
                      </button>
                    )}
                  </div>

                  {error && (
                    <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-600 flex items-start gap-3">
                      <AlertCircle className="shrink-0 mt-0.5" size={18} />
                      <p className="text-sm font-medium">{error}</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-5">
            <AnimatePresence mode="wait">
              {analysis ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="glass-panel rounded-2xl md:rounded-3xl p-4 md:p-8 sticky top-8"
                >
                  <div className="flex items-center justify-between mb-6 md:mb-8">
                    <h2 className="text-lg md:text-xl font-bold text-zinc-900">分析結果</h2>
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="flex flex-col items-end">
                        <span className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">總體評分</span>
                        <span className={`text-2xl md:text-3xl font-black ${analysis.score >= 80 ? 'text-emerald-600' : analysis.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                          {analysis.score}
                        </span>
                      </div>
                      <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider
                        ${analysis.riskLevel === '低' ? 'bg-emerald-100 text-emerald-700' : 
                          analysis.riskLevel === '中' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}
                      >
                        風險: {analysis.riskLevel}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 md:space-y-8">
                    {/* Score Breakdown */}
                    <div className="grid grid-cols-2 gap-3 md:gap-4">
                      {Object.entries(analysis.scoreBreakdown || {}).map(([key, value]) => {
                        const labels: Record<string, string> = {
                          symmetry: '對稱性',
                          alignment: '排列性',
                          balance: '平衡感',
                          stability: '穩定性'
                        };
                        const percentage = ((value as number) / 25) * 100;
                        return (
                          <div key={key} className="space-y-1 md:space-y-2">
                            <div className="flex justify-between text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                              <span>{labels[key]}</span>
                              <span>{value}/25</span>
                            </div>
                            <div className="h-1 w-full bg-zinc-100 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${percentage}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={`h-full rounded-full ${percentage >= 80 ? 'bg-emerald-500' : percentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Summary */}
                    <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-100">
                      <p className="text-sm text-zinc-600 leading-relaxed italic">
                        "{analysis.summary}"
                      </p>
                    </div>

                    {/* Metrics Section */}
                    <div className="space-y-3 md:space-y-4">
                      <h3 className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <Activity size={12} className="md:w-[14px] md:h-[14px]" /> 關鍵指標數據
                      </h3>
                      <div className="grid grid-cols-2 gap-2 md:gap-3">
                        {Object.entries(analysis.metrics || {}).map(([key, value]) => {
                          const labels: Record<string, string> = {
                            headTiltAngle: '頭部傾斜',
                            shoulderLevelDiff: '肩膀高低差',
                            pelvicTiltAngle: '骨盆傾斜',
                            kneeAlignmentAngle: '膝蓋對齊',
                            forwardHeadDistance: '頭部前傾'
                          };
                          const unit = key.includes('Angle') ? '°' : ' cm/級';
                          return (
                            <div key={key} className="p-2 md:p-3 rounded-xl bg-white border border-zinc-100 shadow-sm">
                              <p className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase">{labels[key] || key}</p>
                              <p className="text-sm md:text-lg font-bold text-zinc-800">{value}{unit}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Alignment Details */}
                    <div className="space-y-3 md:space-y-4">
                      <h3 className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <Info size={12} className="md:w-[14px] md:h-[14px]" /> 部位詳細分析
                      </h3>
                      <div className="grid gap-2 md:gap-3">
                        {Object.entries(analysis.alignment || {}).map(([key, value]) => {
                          const labels: Record<string, string> = {
                            head: '頭部',
                            shoulders: '肩膀',
                            pelvis: '骨盆',
                            knees: '膝蓋',
                            ankles: '腳踝'
                          };
                          return (
                            <div key={key} className="flex items-start gap-3 md:gap-4 p-2 md:p-3 rounded-xl hover:bg-zinc-50 transition-colors">
                              <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg bg-white shadow-sm border border-zinc-100 flex items-center justify-center shrink-0">
                                <div className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-zinc-400" />
                              </div>
                              <div>
                                <p className="text-[8px] md:text-xs font-bold text-zinc-500 uppercase">{labels[key] || key}</p>
                                <p className="text-xs md:text-sm text-zinc-800">{value}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recommendations */}
                    <div className="space-y-3 md:space-y-4 pt-4 border-t border-zinc-100">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <h3 className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest">改善建議</h3>
                        {analysis.exercises && analysis.exercises.length > 0 && (
                          <button 
                            onClick={() => setIsCoachMode(true)}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-full text-[10px] md:text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm w-full sm:w-auto"
                          >
                            <Play size={12} fill="currentColor" className="md:w-[14px] md:h-[14px]" />
                            進入教練模式
                          </button>
                        )}
                      </div>
                      <ul className="space-y-2 md:space-y-3">
                        {(analysis.recommendations || []).map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 md:gap-3 text-xs md:text-sm text-zinc-700">
                            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5 md:w-[16px] md:h-[16px]" size={14} />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full min-h-[400px] rounded-3xl border-2 border-dashed border-zinc-200 flex flex-col items-center justify-center p-8 text-center text-zinc-400">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-6">
                    <Activity size={32} />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-900 mb-2">等待分析</h3>
                  <p className="text-sm max-w-[240px]">
                    請上傳正面與側面照片後，點擊「開始分析」以獲取您的體態報告。
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </main>
        )}

        {/* Coach Mode Overlay */}
        <AnimatePresence>
          {isCoachMode && analysis && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-zinc-900/95 backdrop-blur-xl flex items-center justify-center p-2 md:p-8"
            >
              <div className="max-w-3xl w-full bg-white rounded-3xl md:rounded-[2rem] overflow-hidden shadow-2xl flex flex-col h-full md:max-h-[90vh]">
                {/* Header */}
                <div className="p-4 md:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <Activity size={16} className="md:w-[20px] md:h-[20px]" />
                    </div>
                    <div>
                      <h2 className="text-sm md:text-base font-bold text-zinc-900">AI 姿勢教練</h2>
                      <p className="text-[10px] md:text-xs text-zinc-500">正在進行個人化復健引導</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setIsCoachMode(false);
                      setIsTimerActive(false);
                    }}
                    className="p-2 hover:bg-zinc-200 rounded-full transition-colors"
                  >
                    <X size={20} className="text-zinc-400 md:w-[24px] md:h-[24px]" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-10">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentExerciseIndex}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6 md:space-y-8"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4">
                        <div className="space-y-1">
                          <span className="text-[8px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-widest">練習 {currentExerciseIndex + 1} / {analysis.exercises.length}</span>
                          <h3 className="text-xl md:text-2xl font-black text-zinc-900">{analysis.exercises[currentExerciseIndex].name}</h3>
                        </div>
                        <div className="flex items-center justify-between md:justify-end gap-4">
                          <div className="px-3 py-1.5 md:px-4 md:py-2 bg-zinc-100 rounded-xl md:rounded-2xl flex items-center gap-2">
                            <Timer size={14} className="text-zinc-400 md:w-[16px] md:h-[16px]" />
                            <span className="text-xs md:text-sm font-bold text-zinc-700">{analysis.exercises[currentExerciseIndex].duration}</span>
                          </div>
                          {timer > 0 && (
                            <motion.div 
                              animate={{ scale: [1, 1.1, 1] }}
                              transition={{ duration: 1, repeat: Infinity }}
                              className="w-10 h-10 md:w-12 md:h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin-slow flex items-center justify-center relative shadow-lg shadow-emerald-100"
                            >
                              <span className="text-[10px] md:text-xs font-bold absolute">{timer}</span>
                            </motion.div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
                        <div className="space-y-4 md:space-y-6">
                          <div className="space-y-2 md:space-y-3">
                            <h4 className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest">動作說明</h4>
                            <p className="text-sm md:text-base text-zinc-600 leading-relaxed">{analysis.exercises[currentExerciseIndex].description}</p>
                          </div>
                          <div className="space-y-2 md:space-y-3">
                            <h4 className="text-[10px] md:text-xs font-bold text-zinc-400 uppercase tracking-widest">執行步驟</h4>
                            <ul className="space-y-2 md:space-y-3">
                              {(analysis.exercises[currentExerciseIndex]?.steps || []).map((step, i) => (
                                <li key={i} className="flex items-start gap-3 text-xs md:text-sm text-zinc-700">
                                  <span className="w-4 h-4 md:w-5 md:h-5 rounded-full bg-emerald-100 text-emerald-600 text-[8px] md:text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                                  {step}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="space-y-4 md:space-y-6">
                          <div className="p-4 md:p-6 rounded-2xl md:rounded-3xl bg-emerald-50 border border-emerald-100 space-y-2 md:space-y-3">
                            <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs md:text-sm">
                              <Lightbulb size={16} className="md:w-[18px] md:h-[18px]" />
                              教練小叮嚀
                            </div>
                            <p className="text-xs md:text-sm text-emerald-600 leading-relaxed italic">
                              "{analysis.exercises[currentExerciseIndex].coachTip}"
                            </p>
                          </div>
                          <div className="p-4 md:p-6 rounded-2xl md:rounded-3xl bg-zinc-50 border border-zinc-100 space-y-1 md:space-y-2">
                            <h4 className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">預期效益</h4>
                            <p className="text-xs md:text-sm text-zinc-600">{analysis.exercises[currentExerciseIndex].benefit}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Footer Controls */}
                <div className="p-4 md:p-6 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between gap-2">
                  <button
                    disabled={currentExerciseIndex === 0}
                    onClick={() => {
                      setCurrentExerciseIndex(prev => prev - 1);
                      setIsTimerActive(false);
                      setTimer(0);
                    }}
                    className={`flex items-center gap-1 md:gap-2 px-3 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl font-bold transition-all text-xs md:text-base
                      ${currentExerciseIndex === 0 ? 'text-zinc-300 cursor-not-allowed' : 'text-zinc-600 hover:bg-zinc-200'}`}
                  >
                    <ChevronLeft size={16} className="md:w-[20px] md:h-[20px]" />
                    <span className="hidden xs:inline">上一個</span>
                  </button>

                  <div className="flex gap-2 md:gap-3">
                    {isTimerActive && (
                      <button
                        onClick={() => {
                          setIsTimerActive(false);
                          setTimer(0);
                          if (currentExerciseIndex < analysis.exercises.length - 1) {
                            setCurrentExerciseIndex(prev => prev + 1);
                          } else {
                            setIsCoachMode(false);
                          }
                        }}
                        className="px-3 py-2 md:px-6 md:py-3 bg-zinc-100 text-zinc-500 rounded-xl md:rounded-2xl font-bold hover:bg-zinc-200 transition-all flex items-center gap-1 md:gap-2 text-xs md:text-base"
                      >
                        跳過
                      </button>
                    )}

                    {!isTimerActive && timer === 0 && (
                      <button
                        onClick={() => startExerciseTimer(analysis.exercises[currentExerciseIndex].duration)}
                        className="px-4 py-2 md:px-8 md:py-3 bg-emerald-600 text-white rounded-xl md:rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all active:scale-95 flex items-center gap-1 md:gap-2 text-xs md:text-base"
                      >
                        <Timer size={16} className="md:w-[20px] md:h-[20px]" />
                        計時
                      </button>
                    )}
                    
                    {currentExerciseIndex < analysis.exercises.length - 1 ? (
                      <button
                        onClick={() => {
                          setCurrentExerciseIndex(prev => prev + 1);
                          setIsTimerActive(false);
                          setTimer(0);
                        }}
                        className="px-4 py-2 md:px-8 md:py-3 bg-zinc-900 text-white rounded-xl md:rounded-2xl font-bold hover:bg-zinc-800 shadow-lg shadow-zinc-200 transition-all active:scale-95 flex items-center gap-1 md:gap-2 text-xs md:text-base"
                      >
                        <span className="hidden xs:inline">下一個</span>
                        <ChevronRight size={16} className="md:w-[20px] md:h-[20px]" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setIsCoachMode(false);
                          setIsTimerActive(false);
                        }}
                        className="px-4 py-2 md:px-8 md:py-3 bg-emerald-600 text-white rounded-xl md:rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all active:scale-95 text-xs md:text-base"
                      >
                        完成
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Info */}
        <footer className="mt-8 md:mt-16 pt-6 md:pt-8 border-t border-zinc-200 text-center">
          <div className="flex flex-wrap justify-center gap-4 md:gap-8 text-[10px] md:text-xs text-zinc-400 font-medium uppercase tracking-widest">
            <div className="flex items-center gap-1.5 md:gap-2">
              <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-zinc-300" />
              AI 驅動分析
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-zinc-300" />
              專業姿勢評估
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-zinc-300" />
              隱私安全保護
            </div>
          </div>
          <p className="mt-6 md:mt-8 text-[10px] md:text-xs text-zinc-400 px-4">
            * 本工具僅供參考，不具備醫療診斷功能。如有嚴重不適請諮詢專業醫師。
          </p>
        </footer>
      </div>
    </div>
  );
}
