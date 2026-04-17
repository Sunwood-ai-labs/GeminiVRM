<div align="center">
  <img src="./public/ogp.jpg" alt="GeminiVRM hero" width="960" />
  <h1>GeminiVRM</h1>
  <p>Browser-first VRM chat and podcast staging powered by Gemini Live native audio.</p>
  <p>
    <a href="https://github.com/Sunwood-ai-labs/GeminiVRM/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Sunwood-ai-labs/GeminiVRM/ci.yml?branch=main&label=ci" /></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/Sunwood-ai-labs/GeminiVRM" /></a>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black" />
    <img alt="Gemini Live" src="https://img.shields.io/badge/Gemini-Live-2F7CF6" />
    <img alt="VRM" src="https://img.shields.io/badge/VRM-Avatar-00B894" />
  </p>
  <p>
    <strong>Languages</strong><br />
    <a href="./README.md">English</a> |
    <a href="./README.ja.md">Japanese</a>
  </p>
</div>

## Overview

GeminiVRM is a polished fork of [`pixiv/ChatVRM`](https://github.com/pixiv/ChatVRM) that replaces the old OpenAI + Koeiromap response path with Gemini Live native audio while keeping the browser-first VRM experience intact.

The current build focuses on:

- browser-first single-avatar chat with streamed Gemini Live transcript and audio
- capped dual-host podcast mode where `Yukito` and `Kiyoka` alternate short native-audio turns from one topic
- bundled `public/Kiyoka.vrm` and `public/Yukito.vrm` avatars, per-mode voice controls, and Mixamo-backed motion presets
- a local-first workflow with optional YouTube relay and browser automation hooks

## Features

- Stream Gemini Live transcript and audio in the browser for character chat
- Send microphone audio directly into Gemini Live for character chat push-to-talk turns
- Switch between `Character chat` and `Podcast mode` from `Settings`
- Start with bundled `Kiyoka.vrm` and `Yukito.vrm`, or load your own local `.vrm`
- Tune the live model, single-chat voice, system prompt, podcast turn cap, and per-host podcast voices from the UI
- Reuse the VRM lip-sync pipeline with bundled Mixamo idle and talking motion rotation
- Configure an optional YouTube Live relay from `Settings` -> `Streaming` and receive inbound live chat comments inside GeminiVRM
- Drive the app from `window.geminiVrmControl` or `postMessage` for local automation and orchestration
- Run a lightweight smoke E2E check with Playwright
- Publish the static app and docs to GitHub Pages

## Tech Stack

- Next.js 15
- React 18
- `@google/genai`
- `@pixiv/three-vrm`
- TypeScript
- Tailwind CSS
- Playwright

## Quick Start

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3100
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100), paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey), and press `Start`.

To run the app and docs together, use:

```bash
npm run dev:all
```

This starts the app at `http://127.0.0.1:3100` and the docs at `http://127.0.0.1:4173`.

## Environment Variables

See [.env.example](./.env.example).

- `NEXT_PUBLIC_GEMINI_API_KEY`
  - Optional local default key for browser use
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  - Optional Google OAuth web client ID for the YouTube Live relay settings
- `BASE_PATH`
  - Optional prefix for GitHub Pages or subpath deployments
- `NEXT_PUBLIC_GEMINI_LIVE_MODEL`
  - Optional default model shown in the UI
- `NEXT_PUBLIC_GEMINI_LIVE_VOICE`
  - Optional default Gemini prebuilt voice name

This app is tuned for `gemini-3.1-flash-live-preview` and no longer auto-falls
back to older Gemini Live preview models.

## How To Use

1. Launch the app and enter a Gemini API key.
2. Open `Settings` and choose `Character chat` or `Podcast mode`.
3. In character chat, keep the default `Kiyoka.vrm` avatar or load another VRM, then send a text prompt or click the microphone button to stream your voice directly into Gemini Live.
4. In podcast mode, enter one topic and let Yukito and Kiyoka alternate short audio turns until the configured turn cap is reached.
5. Open `Settings` -> `Podcast settings` if you want to change the max loop count or podcast-only voice routing.
6. Use `Settings` to tune the live model, single-chat voice, system prompt, idle motion, and other core runtime settings.
7. If you want live streaming support, open `Settings` -> `Streaming` -> `YouTube relay`, use `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or paste a Google OAuth client ID into the page, sign in with Google, pick an active or upcoming broadcast, turn relay on, and toggle auto-reply separately if you want Gemini to answer incoming comments automatically while streaming this app window through YouTube Live Control Room or OBS.

## Project Structure

```text
public/                       Static VRM, images, and social assets
scripts/                      Release, Pages, and smoke-test helpers
src/components/               UI components
src/features/chat/            Gemini Live transport and config
src/features/externalControl/ Browser automation and postMessage control hooks
src/features/lipSync/         Audio playback and analysis
src/features/podcast/         Dual-host podcast orchestration
src/features/vrmViewer/       Viewer and model runtime
src/lib/fbxAnimation/         Mixamo retargeting helpers for bundled motions
docs/                         Architecture, deployment, release, and QA notes
```

## Documentation

- Live docs (English): [https://sunwood-ai-labs.github.io/GeminiVRM/docs/](https://sunwood-ai-labs.github.io/GeminiVRM/docs/)
- Live docs (Japanese): [https://sunwood-ai-labs.github.io/GeminiVRM/docs/ja/](https://sunwood-ai-labs.github.io/GeminiVRM/docs/ja/)
- [Getting Started](./docs/getting-started.md)
- [Usage Guide](./docs/usage.md)
- [Podcast Benchmark Report](./docs/podcast-benchmark.md)
- [YouTube Relay Guide](./docs/youtube-relay.md)
- [Release Notes](./docs/releases.md)
- [Release Articles](./docs/articles.md)
- [Latest v0.3.0 Release Notes](./docs/releases/v0.3.0.md)
- [Latest v0.3.0 Runtime And Benchmark Guide](./docs/articles/v0.3.0-runtime-and-benchmark-guide.md)
- [Architecture notes](./docs/architecture.md)
- [Deployment guide](./docs/deployment.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Repository QA inventory](./docs/repository-qa-inventory.md)

Local docs commands:

```bash
npm run docs:build
npm run docs:preview
```

## Verification

```bash
npm run verify
```

or run each step manually:

```bash
npm run lint
npm run build
npm run docs:build
npm run build:pages
npm run e2e:smoke
```

The smoke test checks that the app boots, the send flow works, and known chunk/icon/runtime request failures stay absent. When no Gemini API key is present, the missing-key error path is treated as a valid smoke outcome.

## Podcast Benchmark Safety

When you benchmark podcast relay with Playwright, keep the run isolated from the watched Next.js workspace.

- Use `npm run bench:podcast:topic -- .tmp-topic-files/agi.txt` or `node scripts/run-podcast-topic-benchmark.mjs <topic-file>` when the topic contains Japanese text or other non-ASCII content.
- Keep `E2E_BENCH_OUTPUT_DIR` outside the repository. The benchmark runner now defaults to the system temp directory so artifact writes do not trigger `next dev` Fast Refresh.
- Use `E2E_BENCH_MODES=streaming` or `E2E_BENCH_MODES=batch` when you want isolated retries per mode.
- If you are collecting many repeated runs under `next dev`, restart the dev server between isolated runs to keep Playwright stable.

For the bilingual latency chart and the text-overflow verifier:

- Run `npm run report:podcast-benchmark` to rebuild the English and Japanese report images plus the shared JSON summary.
- The same command also updates `docs/public/benchmarks/podcast-benchmark-history.json` and `.csv` for longitudinal tracking.
- The tracked history fields are `generatedAt`, `benchmarkKey`, `gitSha`, `sourceKind`, `topics`, `firstAudio*`, and `handoff*`.
- Run `npm run verify:podcast-benchmark-layout` to check missing `data-fit-boundary` annotations, text overflow, and text-on-text overlaps in both SVG files.
- See [Podcast Benchmark Report](./docs/podcast-benchmark.md) for the latest captured numbers, caveats, and output paths.

## Deployment

The repository is prepared for GitHub Pages deployment through GitHub Actions.

- Static export uses `BASE_PATH` for subpath hosting
- `NEXT_EXPORT=true` enables a Pages-ready static build
- Pages artifacts are produced from `.next-pages`
- CI validates lint, build, and smoke E2E on every push and pull request

For step-by-step instructions, see [docs/deployment.md](./docs/deployment.md).

## Security Notes

- This project still sends the Gemini API key from the browser, matching the original local-first ChatVRM setup style.
- The YouTube relay stores the Google OAuth client ID and short-lived YouTube access token in browser local storage until sign-out or token expiry so the session can be restored after reload.
- The external-control `postMessage` surface is enabled by default in development. In production it is gated by local storage and allowed-origin checks, so do not assume it is globally active on public deployments.
- For public production deployments, prefer a token relay or another server-side key handling strategy.

## Acknowledgements

- [`pixiv/ChatVRM`](https://github.com/pixiv/ChatVRM)
- [`@pixiv/three-vrm`](https://github.com/pixiv/three-vrm)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [`@google/genai`](https://www.npmjs.com/package/@google/genai)
