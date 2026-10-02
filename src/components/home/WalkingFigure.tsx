/**
 * 這個檔案做什麼：
 *   首頁的示意圖佔位：一個側面走路的骨架線條人（UX 文件 §3.2 圖 10）。
 *   正式插畫完成後，換成設計師的圖即可。
 */

export function WalkingFigure({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-brand-50 ${className}`}>
      <svg viewBox="0 0 320 240" className="h-full w-full" role="img" aria-label="示意圖：側面走路的人，身上疊著骨架線條">
        {/* 地面 */}
        <line x1="20" y1="214" x2="300" y2="214" stroke="#9fb3c8" strokeWidth="2" strokeDasharray="6 6" />
        {/* 骨架線條 */}
        <g stroke="#17796b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M168 78 L160 132" />
          <path d="M160 132 L190 170 L200 212" />
          <path d="M160 132 L136 172 L112 206" />
          <path d="M200 212 L216 212" />
          <path d="M112 206 L104 214" />
          <path d="M166 88 L148 116 L156 138" />
          <path d="M166 88 L186 112 L198 128" />
        </g>
        {/* 關節點 */}
        <g fill="#ffffff" stroke="#0d4a42" strokeWidth="3">
          <circle cx="170" cy="58" r="16" />
          <circle cx="166" cy="88" r="5" />
          <circle cx="160" cy="132" r="5" />
          <circle cx="190" cy="170" r="5" />
          <circle cx="136" cy="172" r="5" />
          <circle cx="200" cy="212" r="5" />
          <circle cx="112" cy="206" r="5" />
        </g>
        {/* 角度弧線示意 */}
        <path d="M160 152 A20 20 0 0 1 172 148" stroke="#c05621" strokeWidth="3" fill="none" />
      </svg>
      <span className="absolute bottom-2 right-3 text-xs text-muted">示意圖</span>
    </div>
  );
}
