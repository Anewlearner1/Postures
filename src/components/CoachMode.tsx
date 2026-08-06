/**
 * Guided exercise runner. Carried over from the static-posture version; the
 * exercises it walks through are now prescribed from gait findings.
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Timer,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Exercise } from '../types/gait';

interface Props {
  exercises: Exercise[];
  onClose: () => void;
}

/** Pulls the first number out of "30 秒" / "10 次 x 3 組"; falls back to 30s. */
function parseDuration(text: string): number {
  const match = text.match(/\d+/);
  const value = match ? Number(match[0]) : 30;
  return value > 0 && value <= 600 ? value : 30;
}

export function CoachMode({ exercises, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [timer, setTimer] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning || timer <= 0) {
      if (timer <= 0) setIsRunning(false);
      return;
    }
    const id = window.setInterval(() => setTimer((prev) => prev - 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning, timer]);

  if (!exercises.length) return null;
  const exercise = exercises[Math.min(index, exercises.length - 1)];
  const isLast = index >= exercises.length - 1;

  const goTo = (next: number) => {
    setIndex(next);
    setIsRunning(false);
    setTimer(0);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/95 p-2 backdrop-blur-xl md:p-8"
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl md:max-h-[90vh] md:rounded-[2rem]">
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 md:h-10 md:w-10">
              <Activity size={16} className="md:h-5 md:w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 md:text-base">AI 步態教練</h2>
              <p className="text-[10px] text-zinc-500 md:text-xs">
                依本次步態分析結果安排的訓練
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:bg-zinc-200"
            aria-label="關閉教練模式"
          >
            <X size={20} className="text-zinc-400 md:h-6 md:w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 md:space-y-8"
            >
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center md:gap-4">
                <div className="space-y-1">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-600 md:text-[10px]">
                    練習 {index + 1} / {exercises.length}
                  </span>
                  <h3 className="text-xl font-black text-zinc-900 md:text-2xl">
                    {exercise.name}
                  </h3>
                </div>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-1.5 md:rounded-2xl md:px-4 md:py-2">
                    <Timer size={14} className="text-zinc-400 md:h-4 md:w-4" />
                    <span className="text-xs font-bold text-zinc-700 md:text-sm">
                      {exercise.duration}
                    </span>
                  </div>
                  {timer > 0 && (
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="animate-spin-slow relative flex h-10 w-10 items-center justify-center rounded-full border-4 border-emerald-500 border-t-transparent shadow-lg shadow-emerald-100 md:h-12 md:w-12"
                    >
                      <span className="absolute text-[10px] font-bold tabular-nums md:text-xs">
                        {timer}
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-2">
                <div className="space-y-4 md:space-y-6">
                  <div className="space-y-2 md:space-y-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 md:text-xs">
                      動作說明
                    </h4>
                    <p className="text-sm leading-relaxed text-zinc-600 md:text-base">
                      {exercise.description}
                    </p>
                  </div>
                  {exercise.steps.length > 0 && (
                    <div className="space-y-2 md:space-y-3">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 md:text-xs">
                        執行步驟
                      </h4>
                      <ul className="space-y-2 md:space-y-3">
                        {exercise.steps.map((step, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3 text-xs text-zinc-700 md:text-sm"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[8px] font-bold text-emerald-600 md:h-5 md:w-5 md:text-[10px]">
                              {i + 1}
                            </span>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="space-y-4 md:space-y-6">
                  {exercise.coachTip && (
                    <div className="space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 md:space-y-3 md:rounded-3xl md:p-6">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 md:text-sm">
                        <Lightbulb size={16} className="md:h-[18px] md:w-[18px]" />
                        教練小叮嚀
                      </div>
                      <p className="text-xs italic leading-relaxed text-emerald-600 md:text-sm">
                        “{exercise.coachTip}”
                      </p>
                    </div>
                  )}
                  {exercise.benefit && (
                    <div className="space-y-1 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 md:space-y-2 md:rounded-3xl md:p-6">
                      <h4 className="text-[8px] font-bold uppercase tracking-widest text-zinc-400 md:text-[10px]">
                        預期效益
                      </h4>
                      <p className="text-xs text-zinc-600 md:text-sm">{exercise.benefit}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50 p-4 md:p-6">
          <button
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
            className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition-all md:gap-2 md:rounded-2xl md:px-6 md:py-3 md:text-base ${
              index === 0
                ? 'cursor-not-allowed text-zinc-300'
                : 'text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <ChevronLeft size={16} className="md:h-5 md:w-5" />
            <span className="hidden sm:inline">上一個</span>
          </button>

          <div className="flex gap-2 md:gap-3">
            {isRunning && (
              <button
                onClick={() => (isLast ? onClose() : goTo(index + 1))}
                className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-500 transition-all hover:bg-zinc-200 md:rounded-2xl md:px-6 md:py-3 md:text-base"
              >
                跳過
              </button>
            )}

            {!isRunning && timer === 0 && (
              <button
                onClick={() => {
                  setTimer(parseDuration(exercise.duration));
                  setIsRunning(true);
                }}
                className="flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-95 md:gap-2 md:rounded-2xl md:px-8 md:py-3 md:text-base"
              >
                <Timer size={16} className="md:h-5 md:w-5" />
                計時
              </button>
            )}

            {isLast ? (
              <button
                onClick={onClose}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-95 md:rounded-2xl md:px-8 md:py-3 md:text-base"
              >
                完成
              </button>
            ) : (
              <button
                onClick={() => goTo(index + 1)}
                className="flex items-center gap-1 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-zinc-200 transition-all hover:bg-zinc-800 active:scale-95 md:gap-2 md:rounded-2xl md:px-8 md:py-3 md:text-base"
              >
                <span className="hidden sm:inline">下一個</span>
                <ChevronRight size={16} className="md:h-5 md:w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
