# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

"Posture Alignment Detector" (體態排列分析) — a single-page React app, originally scaffolded in Google AI Studio, that lets a user upload front and side profile photos and get an AI-generated posture/alignment analysis (score, risk level, per-joint alignment notes, metrics, recommendations, and a guided exercise "coach mode"). All analysis text is in Traditional Chinese. Optional Google/Apple sign-in syncs analysis history to Firestore; anonymous users get local history via `localStorage`.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start Vite dev server on port 3000 (`--host=0.0.0.0`)
- `npm run build` — production build (`vite build`)
- `npm run preview` — preview the production build
- `npm run lint` — type-check only, no emit (`tsc --noEmit`); there is no separate build-time linter (no ESLint config)
- `npm run clean` — remove `dist/`

There is no test suite/framework configured in this repo (no test script, no test files).

## Environment / secrets

- `GEMINI_API_KEY` is read via `process.env.GEMINI_API_KEY`, injected by Vite's `define` in `vite.config.ts` from a `.env` file (or by AI Studio's Secrets panel at runtime). Copy `.env.example` to `.env` for local dev.
- Firebase config is **not** environment-based — it's checked into `firebase-applet-config.json` and imported directly by `src/firebase.ts`. This is the standard AI Studio pattern for this project type (the Firebase web API key is safe to expose client-side by design; access is enforced by `firestore.rules`).
- `firebase-blueprint.json` documents the intended Firestore schema (the `PostureAnalysis` entity / `history` collection) — keep it in sync with `firestore.rules` and the `PostureAnalysis` interface in `src/services/gemini.ts` when changing the data shape.

## Architecture

This is an intentionally flat, single-page app — most logic lives in one file:

- **`src/main.tsx`** — React entry point, mounts `<App />`.
- **`src/App.tsx`** — the entire UI and app state machine: image upload/resize, calling the analysis service, auth (Google/Apple via Firebase), history (Firestore when signed in, `localStorage` when not, with one-way migration from local → Firestore on first sign-in), and the "coach mode" exercise walkthrough with a countdown timer. Contains an `ErrorBoundary` and a `handleFirestoreError` helper that packages Firestore errors with auth context for debugging.
- **`src/services/gemini.ts`** — the only integration point with the Gemini API (`@google/genai`). `analyzePosture(frontImageBase64, sideImageBase64)` sends both images plus a detailed Traditional-Chinese clinical prompt to model `gemini-3.1-pro-preview`, requests `application/json` output, strips markdown code fences defensively, and parses the result into the `PostureAnalysis` type. All scoring/analysis logic is defined by the prompt, not by client-side code — if analysis fields need to change, both the prompt's JSON schema description and the `PostureAnalysis`/`Exercise` TypeScript interfaces must be updated together.
- **`src/firebase.ts`** — initializes the Firebase app/Auth/Firestore from `firebase-applet-config.json`, exports `db`, `auth`, `googleProvider`, `appleProvider`. Firestore uses a named database (`firestoreDatabaseId`), not the default one — pass it explicitly if adding new Firestore access elsewhere.
- **`firestore.rules`** — security rules for the `history` and `users` collections. `history` docs are owned by `userId` (must match `request.auth.uid`); reads/deletes are also allowed for an admin (Firestore `users/{uid}.role == 'admin'`, or a hardcoded fallback admin email). Writes are validated with `isValidAnalysis()` (requires `userId`, `timestamp`, `score`, `riskLevel` in `["低", "中", "高"]`). When adding new Firestore fields or collections, update this file, not just the client code.
- **`firebase-blueprint.json`** — declarative schema doc for the `PostureAnalysis` entity and the `/history/{analysisId}` collection; treat as documentation, not enforced code.
- **`metadata.json`** — AI Studio applet metadata (name, description, requested permissions — currently `camera`).

### Data flow for a single analysis

1. User uploads two photos → `handleImageUpload` in `App.tsx` resizes them client-side to max 800px via a `<canvas>`, producing base64 `image/jpeg` data URLs.
2. `runAnalysis()` calls `analyzePosture()` in `services/gemini.ts`, which sends both images + the scoring prompt to Gemini and parses the JSON response into a `PostureAnalysis` object.
3. Result is rendered in the results panel (score, breakdown bars, metrics, per-part alignment, recommendations) and saved either to Firestore (`history` collection, signed-in) or to component state + `localStorage` (`posture_history` key, max 5 items, anonymous).
4. If the result includes `exercises`, the user can enter "coach mode," a full-screen step-through of exercises with a per-exercise countdown timer (`startExerciseTimer`).

### Styling

Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js` — v4 uses CSS-based config in `src/index.css`'s `@theme` block). Fonts are Inter (sans) and JetBrains Mono (mono), loaded from Google Fonts in `index.css`. Icons from `lucide-react`; animations from `motion/react` (Framer Motion's successor).

### Path aliases

`@/*` resolves to the repo root (configured in both `tsconfig.json` and `vite.config.ts`), e.g. `@/src/services/gemini`.
