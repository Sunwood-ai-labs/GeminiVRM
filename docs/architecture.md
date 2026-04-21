# GeminiVRM Architecture

## Goals

GeminiVRM keeps the original browser-first avatar experience from ChatVRM while replacing the response stack with Gemini Live native audio.

The current architecture optimizes for:

- low-latency playback from streamed PCM chunks
- simple local-first setup with no required backend
- compatibility with VRM lip sync and expression playback
- an optional YouTube Live relay that feeds broadcast comments into the existing chat flow

## Runtime Flow

1. The user sends a prompt from the main page, either as typed text, a push-to-talk microphone turn, a hands-free character chat session, or a hands-free podcast listener interruption.
2. `src/pages/index.tsx` starts streaming playback mode on the active model.
3. Text turns use `src/features/chat/geminiLiveChat.ts`, push-to-talk turns use `src/features/chat/geminiLiveMicChat.ts`, and hands-free sessions use `src/features/chat/geminiLiveHandsFreeChat.ts` plus `src/features/chat/microphoneCapture.ts`.
4. The active Gemini Live session forwards transcript updates plus PCM audio chunks.
5. `src/features/lipSync/lipSync.ts` validates PCM metadata, queues chunk playback, and keeps the analyser fed for mouth movement.
6. `src/features/vrmViewer/model.ts` bridges the audio stream into the VRM runtime.
7. `src/features/emoteController/*` updates expression, eye, blink, and lip sync state each frame.

## Optional YouTube Relay Flow

1. The user opens `Settings`, then enters the optional `Streaming` subpage and the `YouTube relay` panel.
2. `src/features/youtube/googleOAuth.ts` restores or refreshes browser-side Google auth for YouTube access.
3. `src/features/youtube/youTubeLiveClient.ts` lists broadcasts, resolves live chat metadata, and polls incoming comments.
4. `src/pages/index.tsx` pushes queued YouTube comments into the same chat flow that Gemini uses for normal turns, with optional auto-reply.

## Key Files

- `src/pages/index.tsx`
  - user input, streaming state, and chat flow
- `src/features/chat/geminiLiveChat.ts`
  - Gemini Live connection lifecycle, realtime text input formatting for `gemini-3.1-flash-live-preview`, chunk forwarding, and transcript assembly
- `src/features/chat/geminiLiveMicChat.ts`
  - direct microphone-to-Gemini Live turn orchestration, history priming, input transcription, and streamed response audio
- `src/features/chat/geminiLiveHandsFreeChat.ts`
  - long-lived automatic-VAD Gemini Live session orchestration for hands-free chat and podcast listener interruption capture
- `src/features/chat/microphoneCapture.ts`
  - browser microphone capture and PCM chunk extraction for live audio turns
- `src/features/chat/geminiLiveConfig.ts`
  - default model and voice preset configuration
- `src/features/lipSync/lipSync.ts`
  - audio scheduling, PCM validation, analyser updates, and autoplay safety handling
- `src/features/vrmViewer/model.ts`
  - VRM model audio bridge and streaming hooks
- `src/features/youtube/googleOAuth.ts`
  - browser-side Google OAuth client bootstrapping and saved session restore
- `src/features/youtube/youTubeLiveClient.ts`
  - broadcast discovery, live chat polling, and relay API helpers
- `src/components/*`
  - UI for the viewer, settings, chat input, and assistant status
- `src/components/settings.tsx`
  - Settings modal navigation including the optional `Streaming` subpage entry
- `src/components/youtubeLiveControlDeck.tsx`
  - YouTube relay panel, broadcast selection, relay controls, and comment preview

## Streaming Notes

Earlier revisions waited for a full turn to complete, converted the whole response into WAV, decoded it, and only then started playback. The current path instead plays PCM chunks as they arrive, which reduces perceived latency and better matches the Gemini Live model.

Safety guards now cover:

- `onmessage` callback failures
- unsupported or missing PCM metadata
- partial PCM frames at chunk boundaries
- browser autoplay failures when `AudioContext.resume()` is blocked

## Asset Model

- `public/Kiyoka.vrm`
  - bundled default avatar
- `public/bg-d.png`
  - default background
- `public/idle_loop.vrma`
  - idle animation asset

## Limitations

- The Gemini API key is currently provided directly in the browser.
- Playback is low-latency, but still depends on browser audio scheduling and network conditions.
- The default preview model alias may not be enabled for every Gemini account.
- The optional YouTube relay depends on a Google OAuth web client ID and the selected broadcast exposing a live chat.

## Documentation Surface

The public docs are served with VitePress under `/docs/`, while the main application remains a Next.js static export.

- local authoring uses `npm run dev:all`
- Pages builds bundle the exported app plus VitePress output into `.next-pages/`
- the app exposes a `Docs` shortcut so the runtime and docs stay connected
