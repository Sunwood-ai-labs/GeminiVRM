import React, { useEffect, useRef, useState } from "react";
import { IconButton } from "./iconButton";
import { TextButton } from "./textButton";
import { Link } from "./link";
import {
  getMessageListLabel,
  Message,
} from "@/features/messages/messages";
import {
  DEFAULT_GEMINI_VOICE_NAME,
  GEMINI_VOICE_PRESETS,
} from "@/features/chat/geminiLiveConfig";
import {
  BUILT_IN_MOTION_LIST,
  BuiltInMotionId,
} from "@/features/vrmViewer/builtInMotions";
import { InteractionMode } from "@/features/podcast/podcastConfig";
import type { ScreenShareCaptureStats } from "@/features/chat/screenShareCapture";

type Props = {
  geminiApiKey: string;
  geminiModel: string;
  geminiVoiceName: string;
  interactionMode: InteractionMode;
  screenShareState: "idle" | "starting" | "active" | "error";
  screenShareError: string;
  screenShareSourceLabel: string;
  screenShareStats: ScreenShareCaptureStats;
  podcastTurnCount: number;
  podcastYukitoVoiceName: string;
  podcastKiyokaVoiceName: string;
  selectedMotionId: BuiltInMotionId;
  systemPrompt: string;
  chatLog: Message[];
  onClickClose: () => void;
  onChangeGeminiApiKey: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChangeGeminiModel: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChangeGeminiVoiceName: (voiceName: string) => void;
  onChangeInteractionMode: (mode: InteractionMode) => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onChangePodcastTurnCount: (turnCount: number) => void;
  onChangePodcastYukitoVoiceName: (voiceName: string) => void;
  onChangePodcastKiyokaVoiceName: (voiceName: string) => void;
  onChangeMotion: (motionId: BuiltInMotionId) => void;
  onChangeSystemPrompt: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onChangeChatLog: (index: number, text: string) => void;
  onClickOpenVrmFile: () => void;
  onClickResetChatLog: () => void;
  onClickResetSystemPrompt: () => void;
  youtubeSection?: React.ReactNode;
};

export const Settings = ({
  geminiApiKey,
  geminiModel,
  geminiVoiceName,
  interactionMode,
  screenShareState,
  screenShareError,
  screenShareSourceLabel,
  screenShareStats,
  podcastTurnCount,
  podcastYukitoVoiceName,
  podcastKiyokaVoiceName,
  selectedMotionId,
  systemPrompt,
  chatLog,
  onClickClose,
  onChangeGeminiApiKey,
  onChangeGeminiModel,
  onChangeGeminiVoiceName,
  onChangeInteractionMode,
  onStartScreenShare,
  onStopScreenShare,
  onChangePodcastTurnCount,
  onChangePodcastYukitoVoiceName,
  onChangePodcastKiyokaVoiceName,
  onChangeMotion,
  onChangeSystemPrompt,
  onChangeChatLog,
  onClickOpenVrmFile,
  onClickResetChatLog,
  onClickResetSystemPrompt,
  youtubeSection,
}: Props) => {
  const [activePage, setActivePage] = useState<"main" | "podcast" | "youtube">(
    "main",
  );
  const previousPageRef = useRef<"main" | "podcast" | "youtube">("main");
  const podcastEntryButtonRef = useRef<HTMLButtonElement | null>(null);
  const podcastTitleRef = useRef<HTMLDivElement | null>(null);
  const streamingEntryButtonRef = useRef<HTMLButtonElement | null>(null);
  const youtubeTitleRef = useRef<HTMLDivElement | null>(null);
  const isPresetVoice = (GEMINI_VOICE_PRESETS as readonly string[]).includes(
    geminiVoiceName,
  );

  useEffect(() => {
    if (!youtubeSection && activePage === "youtube") {
      setActivePage("main");
    }
  }, [activePage, youtubeSection]);

  useEffect(() => {
    const previousPage = previousPageRef.current;

    if (activePage === "podcast") {
      podcastTitleRef.current?.focus();
    } else if (activePage === "youtube") {
      youtubeTitleRef.current?.focus();
    } else if (previousPage === "podcast") {
      podcastEntryButtonRef.current?.focus();
    } else if (previousPage === "youtube") {
      streamingEntryButtonRef.current?.focus();
    }

    previousPageRef.current = activePage;
  }, [activePage]);

  return (
    <div className="absolute z-40 h-full w-full bg-white/80 backdrop-blur">
      <div className="absolute m-24">
        <IconButton
          iconName="24/Close"
          label="Close settings"
          isProcessing={false}
          onClick={onClickClose}
        />
      </div>
      <div className="max-h-full overflow-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          className="mx-auto max-w-3xl px-24 py-64 text-text1"
        >
          {activePage === "podcast" ? (
            <>
              <button
                type="button"
                onClick={() => setActivePage("main")}
                aria-label="Back to main settings"
                className="my-16 text-sm font-bold text-primary hover:text-primary-hover"
              >
                Back to settings
              </button>
              <div
                ref={podcastTitleRef}
                id="settings-title"
                tabIndex={-1}
                className="my-12 typography-32 font-bold"
              >
                Podcast settings
              </div>
              <div className="mb-16 text-sm text-text2">
                Optional controls for Yukito and Kiyoka&apos;s looped
                conversation flow.
              </div>
              <div className="rounded-16 border border-black/10 bg-white/70 px-16 py-16">
                <div className="typography-20 font-bold">Playback scope</div>
                <div className="mt-16">
                  <label
                    htmlFor="settings-podcast-turn-count"
                    id="settings-podcast-turn-count-label"
                    className="my-12 block font-bold"
                  >
                    Maximum loop count
                  </label>
                  <input
                    id="settings-podcast-turn-count"
                    className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                    type="number"
                    min={2}
                    max={12}
                    step={1}
                    value={podcastTurnCount}
                    onChange={(event) =>
                      onChangePodcastTurnCount(
                        Number.parseInt(event.target.value, 10),
                      )
                    }
                  />
                  <div className="mt-8 text-sm text-text2">
                    Podcast mode stops automatically when this cap is reached.
                    A value of <code>2</code> means one short back-and-forth:
                    Yukito once and Kiyoka once.
                  </div>
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby="settings-podcast-turn-count-label"
                  className="mt-16 flex flex-wrap gap-8"
                >
                  {[2, 4, 6, 8, 12].map((presetCount) => {
                    const isSelected = presetCount === podcastTurnCount;
                    return (
                      <button
                        key={presetCount}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => onChangePodcastTurnCount(presetCount)}
                        className={`rounded-full px-12 py-6 text-sm font-bold transition ${
                          isSelected
                            ? "bg-primary text-white"
                            : "bg-surface1 text-text1 hover:bg-surface1-hover"
                        }`}
                      >
                        {presetCount} turns
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-24 rounded-16 border border-black/10 bg-white/70 px-16 py-16">
                <div className="typography-20 font-bold">Voice routing</div>
                <div className="mt-16">
                  <label
                    htmlFor="settings-podcast-yukito-voice"
                    className="my-12 block font-bold"
                  >
                    Yukito voice
                  </label>
                  <input
                    id="settings-podcast-yukito-voice"
                    className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                    type="text"
                    value={podcastYukitoVoiceName}
                    onChange={(event) =>
                      onChangePodcastYukitoVoiceName(event.target.value)
                    }
                  />
                </div>
                <div className="mt-16">
                  <label
                    htmlFor="settings-podcast-kiyoka-voice"
                    className="my-12 block font-bold"
                  >
                    Kiyoka voice
                  </label>
                  <input
                    id="settings-podcast-kiyoka-voice"
                    className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                    type="text"
                    value={podcastKiyokaVoiceName}
                    onChange={(event) =>
                      onChangePodcastKiyokaVoiceName(event.target.value)
                    }
                  />
                </div>
                <div className="mt-8 text-sm text-text2">
                  These only affect podcast mode. The regular single-character
                  chat voice stays independent.
                </div>
              </div>
            </>
          ) : activePage === "youtube" ? (
            <>
              <button
                type="button"
                onClick={() => setActivePage("main")}
                aria-label="Back to main settings"
                className="my-16 text-sm font-bold text-primary hover:text-primary-hover"
              >
                Back to settings
              </button>
              <div
                ref={youtubeTitleRef}
                id="settings-title"
                tabIndex={-1}
                className="my-12 typography-32 font-bold"
              >
                YouTube relay
              </div>
              <div className="mb-16 text-sm text-text2">
                Optional streaming tools for live broadcasts, comment relay, and
                auto-reply.
              </div>
              {youtubeSection}
            </>
          ) : (
            <>
              <div
                id="settings-title"
                className="my-24 typography-32 font-bold"
              >
                Settings
              </div>

              <div className="my-24">
                <div className="my-16 typography-20 font-bold">
                  Conversation mode
                </div>
                <div
                  role="radiogroup"
                  aria-label="Conversation mode"
                  className="grid gap-12 md:grid-cols-2"
                >
                  {(["chat", "podcast"] as const).map((mode) => {
                    const isSelected = interactionMode === mode;

                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => onChangeInteractionMode(mode)}
                        className={`rounded-16 border px-16 py-16 text-left transition ${
                          isSelected
                            ? "border-primary bg-primary text-white shadow-lg"
                            : "border-black/10 bg-white/70 text-text1 hover:border-primary/40 hover:bg-surface1"
                        }`}
                      >
                        <div className="typography-20 font-bold">
                          {mode === "chat" ? "Character chat" : "Podcast mode"}
                        </div>
                        <p
                          className={`mt-10 text-sm leading-relaxed ${
                            isSelected ? "text-white/90" : "text-text2"
                          }`}
                        >
                          {mode === "chat"
                            ? "Talk with a single avatar like the current app."
                            : "Let Yukito and Kiyoka alternate short audio turns from one topic."}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-8 text-sm">
                  Podcast mode relays the previous speaker&apos;s audio into the
                  next Gemini Live turn. If the relay fails, the app now stops
                  on that exact Gemini Live error instead of silently switching
                  to another path.
                </div>
              </div>

              <div className="my-40">
                <div className="my-16 typography-20 font-bold">
                  Podcast mode
                </div>
                <button
                  ref={podcastEntryButtonRef}
                  type="button"
                  onClick={() => setActivePage("podcast")}
                  aria-label="Open podcast settings"
                  className="w-full rounded-16 border border-black/10 bg-white/70 px-16 py-16 text-left transition hover:border-primary/30 hover:bg-surface1"
                >
                  <div className="flex items-start justify-between gap-12">
                    <div>
                      <div className="typography-20 font-bold">
                        Podcast settings
                      </div>
                      <div className="mt-6 text-sm leading-relaxed text-text2">
                        Tune Yukito and Kiyoka&apos;s maximum loop count and
                        podcast-only voice routing.
                      </div>
                    </div>
                    <div className="rounded-full bg-secondary/10 px-10 py-4 text-xs font-bold text-secondary">
                      Optional
                    </div>
                  </div>
                  <div className="mt-10 text-sm text-text2">
                    Max loop count: <strong>{podcastTurnCount}</strong>
                    {" · "}
                    Yukito: <strong>{podcastYukitoVoiceName || "Default"}</strong>
                    {" · "}
                    Kiyoka: <strong>{podcastKiyokaVoiceName || "Default"}</strong>
                  </div>
                  <div className="mt-10 text-sm font-bold text-primary">
                    Open podcast settings
                  </div>
                </button>
              </div>

              <div className="my-24">
                <label
                  htmlFor="settings-gemini-api-key"
                  className="my-16 block typography-20 font-bold"
                >
                  Gemini API key
                </label>
                <input
                  id="settings-gemini-api-key"
                  className="w-col-span-2 rounded-8 bg-surface1 px-16 py-8 text-ellipsis hover:bg-surface1-hover"
                  type="password"
                  placeholder="AIza..."
                  value={geminiApiKey}
                  onChange={onChangeGeminiApiKey}
                  aria-describedby="settings-gemini-api-key-help"
                />
                <div id="settings-gemini-api-key-help" className="mt-8">
                  Generate a key in{" "}
                  <Link
                    url="https://aistudio.google.com/apikey"
                    label="Google AI Studio"
                  />
                  .
                </div>
              </div>

              <div className="my-24">
                <label
                  htmlFor="settings-gemini-model"
                  className="my-16 block typography-20 font-bold"
                >
                  Live model
                </label>
                <input
                  id="settings-gemini-model"
                  className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                  type="text"
                  placeholder="gemini-3.1-flash-live-preview"
                  value={geminiModel}
                  onChange={onChangeGeminiModel}
                />
                <div className="mt-8 text-sm">
                  This app is tuned for
                  <code>gemini-3.1-flash-live-preview</code>. Automatic fallback
                  to other Gemini Live models is disabled.
                </div>
              </div>

              <div className="my-24">
                <label
                  htmlFor="settings-gemini-voice"
                  className="my-16 block typography-20 font-bold"
                >
                  Voice
                </label>
                <select
                  id="settings-gemini-voice"
                  className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                  value={isPresetVoice ? geminiVoiceName : "__custom__"}
                  onChange={(event) => {
                    const selectedVoice = event.target.value;
                    if (selectedVoice === "__custom__") {
                      onChangeGeminiVoiceName("");
                      return;
                    }

                    onChangeGeminiVoiceName(selectedVoice);
                  }}
                >
                  <option value="__custom__">Custom voice</option>
                  {GEMINI_VOICE_PRESETS.map((voiceName) => (
                    <option key={voiceName} value={voiceName}>
                      {voiceName}
                    </option>
                  ))}
                </select>
                <div className="mt-8 text-sm">
                  Pick a preset voice, or switch to Custom voice and enter a
                  prebuilt voice name manually. Blank custom input falls back to{" "}
                  <code>{DEFAULT_GEMINI_VOICE_NAME}</code>.
                </div>
                {!isPresetVoice && (
                  <div className="mt-8">
                    <label
                      htmlFor="settings-gemini-voice-custom"
                      className="my-16 block text-sm"
                    >
                      Custom voice name
                    </label>
                    <input
                      id="settings-gemini-voice-custom"
                      className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                      type="text"
                      placeholder="custom voice"
                      value={geminiVoiceName}
                      onChange={(event) =>
                        onChangeGeminiVoiceName(event.target.value)
                      }
                    />
                  </div>
                )}
              </div>

              {youtubeSection ? (
                <div className="my-40">
                  <div className="my-16 typography-20 font-bold">Streaming</div>
                  <button
                    ref={streamingEntryButtonRef}
                    type="button"
                    onClick={() => setActivePage("youtube")}
                    aria-label="Open YouTube relay streaming settings"
                    className="w-full rounded-16 border border-black/10 bg-white/70 px-16 py-16 text-left transition hover:border-primary/30 hover:bg-surface1"
                  >
                    <div className="flex items-start justify-between gap-12">
                      <div>
                        <div className="typography-20 font-bold">
                          YouTube relay
                        </div>
                        <div className="mt-6 text-sm leading-relaxed text-text2">
                          Optional tools for live streaming, comment relay, and
                          auto-reply.
                        </div>
                      </div>
                      <div className="rounded-full bg-secondary/10 px-10 py-4 text-xs font-bold text-secondary">
                        Optional
                      </div>
                    </div>
                    <div className="mt-10 text-sm font-bold text-primary">
                      Open streaming settings
                    </div>
                  </button>
                </div>
              ) : null}

              <div className="my-40">
                <div className="my-16 typography-20 font-bold">
                  Screen sharing
                </div>
                <div className="rounded-16 border border-black/10 bg-white/70 px-16 py-16">
                  <div className="flex items-start justify-between gap-12">
                    <div>
                      <div className="typography-20 font-bold">
                        Realtime screen context
                      </div>
                      <div className="mt-6 text-sm leading-relaxed text-text2">
                        Share a window, tab, or full display and Gemini will
                        receive one JPEG frame per second. The latest live
                        frame is shown on stage, attached to the log, and sent
                        into each Gemini turn before streaming resumes.
                      </div>
                    </div>
                    <div
                      className={`rounded-full px-10 py-4 text-xs font-bold ${
                        screenShareState === "active"
                          ? "bg-emerald-500/10 text-emerald-700"
                          : screenShareState === "starting"
                            ? "bg-amber-500/10 text-amber-700"
                            : screenShareState === "error"
                              ? "bg-rose-500/10 text-rose-700"
                              : "bg-black/5 text-text2"
                      }`}
                    >
                      {screenShareState === "active"
                        ? "Active"
                        : screenShareState === "starting"
                          ? "Starting"
                          : screenShareState === "error"
                            ? "Needs attention"
                            : "Off"}
                    </div>
                  </div>
                  <div className="mt-10 text-sm text-text2">
                    {screenShareState === "active"
                      ? `Source: ${screenShareSourceLabel || "Shared screen"}`
                      : "Gemini Live caps audio+video sessions to about 2 minutes, and Live video input is limited to 1 frame per second."}
                  </div>
                  <div className="mt-8 grid gap-8 text-sm text-text2 md:grid-cols-2">
                    <div>
                      Captured frames: <strong>{screenShareStats.capturedFrameCount}</strong>
                      {" / Live frame ready: "}
                      <strong>{screenShareStats.bufferedFrameCount > 0 ? "Yes" : "No"}</strong>
                    </div>
                    <div>
                      Sent to Gemini: <strong>{screenShareStats.streamedFrameCount}</strong>
                    </div>
                    <div>
                      Last capture:{" "}
                      <strong>{formatScreenShareTimestamp(screenShareStats.lastCapturedAt)}</strong>
                    </div>
                    <div>
                      Last send:{" "}
                      <strong>{formatScreenShareTimestamp(screenShareStats.lastStreamedAt)}</strong>
                    </div>
                    <div>
                      Last frame:{" "}
                      <strong>
                        {formatScreenShareFrameStats(
                          screenShareStats.lastFrameWidth,
                          screenShareStats.lastFrameHeight,
                          screenShareStats.lastFrameByteLength,
                        )}
                      </strong>
                    </div>
                  </div>
                  {interactionMode === "podcast" ? (
                    <div className="mt-8 text-sm text-text2">
                      Podcast mode now forwards the shared screen into each
                      Gemini turn. While screen sharing is active, the podcast
                      relay uses the safer per-turn path instead of relay
                      prewarming.
                    </div>
                  ) : null}
                  {screenShareError ? (
                    <div className="mt-8 text-sm text-rose-700">
                      {screenShareError}
                    </div>
                  ) : null}
                  <div className="mt-16 flex flex-wrap gap-8">
                    {screenShareState === "active" ? (
                      <TextButton onClick={onStopScreenShare}>
                        Stop screen share
                      </TextButton>
                    ) : (
                      <TextButton
                        onClick={onStartScreenShare}
                        disabled={screenShareState === "starting"}
                      >
                        {screenShareState === "starting"
                          ? "Starting..."
                          : "Share a window or screen"}
                      </TextButton>
                    )}
                  </div>
                </div>
              </div>

              <div className="my-40">
                <div className="my-16 typography-20 font-bold">VRM model</div>
                <div className="my-8">
                  <TextButton onClick={onClickOpenVrmFile}>Load VRM</TextButton>
                </div>
              </div>

              <div className="my-40">
                <div className="my-16 typography-20 font-bold">Idle motion</div>
                <div
                  role="radiogroup"
                  aria-describedby="idle-motion-help"
                  className="grid gap-12 md:grid-cols-3"
                >
                  {BUILT_IN_MOTION_LIST.map((motion) => {
                    const isSelected = motion.id === selectedMotionId;

                    return (
                      <button
                        key={motion.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-describedby="idle-motion-help"
                        onClick={() => onChangeMotion(motion.id)}
                        className={`rounded-16 border px-16 py-16 text-left transition ${
                          isSelected
                            ? "border-primary bg-primary text-white shadow-lg"
                            : "border-black/10 bg-white/70 text-text1 hover:border-primary/40 hover:bg-surface1"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-12">
                          <div className="typography-20 font-bold">
                            {motion.label}
                          </div>
                          <div
                            className={`rounded-full px-10 py-4 text-xs font-bold ${
                              isSelected
                                ? "bg-white text-primary"
                                : "bg-black/5 text-text2"
                            }`}
                          >
                            {motion.durationLabel}
                          </div>
                        </div>
                        <p
                          className={`mt-10 text-sm leading-relaxed ${
                            isSelected ? "text-white/90" : "text-text2"
                          }`}
                        >
                          {motion.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div id="idle-motion-help" className="mt-8 text-sm">
                  Random Idle swaps between the bundled Mixamo motions. The
                  other presets keep one motion looping.
                </div>
              </div>

              <div className="my-40">
                <div className="my-8">
                  <label
                    htmlFor="settings-system-prompt"
                    className="my-16 block typography-20 font-bold"
                  >
                    System prompt
                  </label>
                  <TextButton onClick={onClickResetSystemPrompt}>
                    Reset prompt
                  </TextButton>
                </div>

                <textarea
                  id="settings-system-prompt"
                  value={systemPrompt}
                  onChange={onChangeSystemPrompt}
                  className="h-168 w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                />
              </div>

              {chatLog.length > 0 && (
                <div className="my-40">
                  <div className="my-8 grid-cols-2">
                    <div className="my-16 typography-20 font-bold">
                      Chat log
                    </div>
                    <TextButton onClick={onClickResetChatLog}>
                      Reset chat log
                    </TextButton>
                  </div>
                  <div className="my-8">
                    {chatLog.map((value, index) => (
                      <div
                        key={index}
                        className="my-8 grid grid-flow-col grid-cols-[min-content_1fr] gap-x-fixed"
                      >
                        <div className="w-[80px] py-8">
                          {getMessageListLabel(value)}
                        </div>
                        <input
                          aria-label={`Chat log entry ${index + 1}`}
                          className="w-full rounded-8 bg-surface1 px-16 py-8 hover:bg-surface1-hover"
                          type="text"
                          value={value.displayContent ?? value.content}
                          onChange={(event) =>
                            onChangeChatLog(index, event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function formatScreenShareFrameStats(
  width: number,
  height: number,
  byteLength: number,
) {
  if (width <= 0 || height <= 0 || byteLength <= 0) {
    return "No frame yet";
  }

  return `${width}x${height}, ${Math.max(1, Math.round(byteLength / 1024))} KB`;
}

function formatScreenShareTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}
