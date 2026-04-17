---
title: Usage Guide
---

# Usage Guide

## Character Chat Flow

1. Start the app and provide a Gemini API key.
2. Keep the bundled `Kiyoka.vrm` avatar or load your own `.vrm` file.
3. Send a text prompt or click the microphone button to stream a push-to-talk voice turn directly into Gemini Live.
4. Read the partial transcript while audio streams in.
5. Let the viewer finish playback before sending the next prompt if you want the cleanest lip sync.

## Podcast Mode

Use this flow when you want Yukito and Kiyoka to alternate short Gemini Live turns from one topic:

1. Open `Settings` and switch `Conversation mode` to `Podcast mode`.
2. Wait until both podcast viewers are ready.
3. Open `Podcast settings` if you want to change the max loop count or route different prebuilt voices to Yukito and Kiyoka.
4. Enter one topic in the composer. The placeholder changes to `Type a podcast topic`.
5. GeminiVRM starts a capped alternating conversation and stops automatically when the configured turn count is reached.

Important notes:

- podcast mode is a turn-based back-and-forth, not simultaneous duet playback
- later turns relay the previous speaker's audio into Gemini Live when possible
- if a prepared relay path fails, GeminiVRM now stops on the exact Gemini Live
  error instead of silently switching to transcript-driven continuation or an
  older model

## Direct Microphone Chat

- the main `Character chat` microphone button opens a direct Gemini Live audio turn instead of browser speech recognition
- click once to start sending microphone audio to Gemini Live, then click again to end the turn and let the assistant answer
- the partial input transcript shown while recording comes from Gemini Live input transcription, not local browser speech recognition

## Settings You Can Tune

- conversation mode (`Character chat` or `Podcast mode`)
- live model
- single-chat voice preset or custom voice name
- system prompt
- podcast turn cap (`2..12`)
- podcast-only Yukito / Kiyoka voice routing
- idle motion preset
- chat history reset
- local VRM file input
- optional `Streaming` entry that opens the YouTube relay page

## Motion And Viewer Runtime

- `Random Idle` rotates through bundled Mixamo idle clips
- talking motion swaps in automatically while audio is playing
- camera framing is preserved between sessions for the main viewer

## Optional YouTube Live Relay

Use this flow when you want YouTube live chat comments to enter the existing Gemini chat pipeline:

1. Open `Settings` -> `Streaming` -> `YouTube relay`.
2. Sign in with Google and refresh the broadcast list.
3. Pick the active or upcoming broadcast that should feed the relay.
4. Turn on the relay listener, then enable auto-reply if you want Gemini to answer incoming comments automatically.
5. Stream this app window through YouTube Live Control Room or OBS while the relay page stays available from Settings.

Important notes:

- only new comments received after relay starts are forwarded into Gemini
- comments posted by the stream owner's own account are ignored to prevent reply loops
- the saved Google client ID and short-lived access token are restored from local storage until sign-out or token expiry
- relay is inbound-only; GeminiVRM does not post replies back into YouTube chat

See the [YouTube Relay Guide](./youtube-relay.md) for prerequisites, step-by-step setup, and failure cases.

## Docs Shortcut

The app exposes a `Docs` shortcut in the top-right action area.

- local `dev:all` builds send that shortcut to the local docs server
- GitHub Pages builds send it to `/<repo>/docs/`

## What To Watch During Testing

- transcript updates appear before the full turn completes
- audio starts without chunk or Gemini Live request errors
- mouth movement remains synchronized with audio playback
- podcast mode waits for both viewers and stops at the configured turn cap
- switching voice, motion, or conversation mode does not break the next run
