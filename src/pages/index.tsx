import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { PodcastStage, type PodcastViewerRegistry } from "@/components/podcastStage";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { Message, Screenplay } from "@/features/messages/messages";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { DEFAULT_PARAM } from "@/features/constants/koeiroParam";
import { Introduction } from "@/components/introduction";
import { Menu } from "@/components/menu";
import { GitHubLink } from "@/components/githubLink";
import { Meta } from "@/components/meta";
import {
  type YoutubeAuthState,
  type YoutubeBroadcastLoadState,
  type YoutubeBroadcastSummary as DeckYoutubeBroadcastSummary,
  type YoutubeIncomingComment,
  type YoutubeLiveReceiveState,
  type YoutubeBroadcastState,
  YoutubeLiveControlDeck,
} from "@/components/youtubeLiveControlDeck";
import {
  CHAT_MIC_MODES,
  type ChatMicMode,
} from "@/features/chat/chatMicMode";
import {
  createGeminiLiveHandsFreeSession,
  type GeminiLiveHandsFreeSession,
} from "@/features/chat/geminiLiveHandsFreeChat";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_VOICE_NAME,
} from "@/features/chat/geminiLiveConfig";
import { getGeminiLiveChatResponse } from "@/features/chat/geminiLiveChat";
import {
  createGeminiLiveMicChatSession,
  type GeminiLiveMicChatSession,
} from "@/features/chat/geminiLiveMicChat";
import {
  createMicrophoneCaptureSession,
  type MicrophoneCaptureSession,
} from "@/features/chat/microphoneCapture";
import {
  createScreenShareCaptureSession,
  EMPTY_SCREEN_SHARE_CAPTURE_STATS,
  toScreenShareFrameDataUrl,
  type ScreenShareCaptureFrame,
  type ScreenShareCaptureSession,
  type ScreenShareCaptureStats,
} from "@/features/chat/screenShareCapture";
import {
  createGeminiLiveAudioRelaySession,
  getGeminiLiveAudioRelayResponse,
  type GeminiLiveAudioRelayResponse,
  type GeminiLiveAudioRelaySession,
} from "@/features/podcast/geminiLivePodcast";
import {
  buildPodcastDisplayLog,
  buildPodcastListenerInterruptPrompt,
  buildPodcastOpeningPrompt,
  buildPodcastRelaySystemPrompt,
  podcastTurnsToGeminiMessages,
  DEFAULT_PODCAST_PARTICIPANTS,
  DEFAULT_PODCAST_TURN_COUNT,
  type InteractionMode,
  type PodcastParticipant,
  type PodcastSpeakerId,
  type PodcastTurn,
} from "@/features/podcast/podcastConfig";
import {
  clearPodcastDebugEvents,
  logPodcastDebugEvent,
  resolvePodcastRelayMode,
} from "@/features/podcast/podcastDebug";
import {
  listLiveBroadcasts,
  listLiveChatMessages,
  requestYouTubeAccessToken,
  userFacingMessage,
  YouTubeLiveError,
  type YouTubeAuthToken,
  type YouTubeBroadcastSummary,
  type YouTubeLiveChatMessage,
} from "@/features/youtube";
import {
  GEMINI_VRM_EXTERNAL_CONTROL_MESSAGE_TYPE,
  GEMINI_VRM_EXTERNAL_CONTROL_RESULT_TYPE,
  isExternalControlEnabled,
  isExternalControlOriginAllowed,
  isGeminiVrmExternalControlRequestMessage,
  toExternalControlSummary,
  toExternalControlLog,
  type GeminiVrmExternalControlApi,
  type GeminiVrmExternalControlCommand,
  type GeminiVrmExternalControlCommandResult,
  type GeminiVrmExternalControlResponseMessage,
  type GeminiVrmExternalControlState,
} from "@/features/externalControl/geminiVrmExternalControl";
import {
  BUILT_IN_MOTIONS,
  BuiltInMotionId,
  DEFAULT_BUILT_IN_MOTION_ID,
  isBuiltInMotionId,
} from "@/features/vrmViewer/builtInMotions";
import type { Model } from "@/features/vrmViewer/model";
import { wait } from "@/utils/wait";

const MAX_YOUTUBE_PREVIEW_COMMENTS = 12;
const MAX_YOUTUBE_PENDING_COMMENTS = 20;
const MAX_YOUTUBE_SEEN_IDS = 400;
const MIN_YOUTUBE_POLL_INTERVAL_MS = 3000;
const FALLBACK_YOUTUBE_POLL_INTERVAL_MS = 5000;
const ERROR_YOUTUBE_POLL_INTERVAL_MS = 10000;
const YOUTUBE_COMMENT_FRESHNESS_MS = 10 * 60 * 1000;
const YOUTUBE_RELAY_PRIME_GRACE_MS = 5000;
const PODCAST_INTER_TURN_DELAY_MS = 320;
const PODCAST_SPEAKER_IDS: PodcastSpeakerId[] = ["yukito", "kiyoka"];
const CHAT_VRM_PARAMS_STORAGE_KEY = "chatVRMParams";
const YOUTUBE_AUTH_SESSION_STORAGE_KEY = "youtubeAuthSessionV1";
const YOUTUBE_AUTH_SESSION_LEEWAY_MS = 30000;

type ScreenShareState = "idle" | "starting" | "active" | "error";

type ActiveMicrophoneTurn = {
  captureSession: MicrophoneCaptureSession;
  historyMessages: Message[];
  inputImage?: Message["inputImage"];
  liveSession: GeminiLiveMicChatSession;
  model: Model | undefined;
};

type ActiveHandsFreeTurn = {
  captureSession: MicrophoneCaptureSession;
  liveSession: GeminiLiveHandsFreeSession;
  model: Model | undefined;
};

type ActivePodcastInterruptListener = {
  captureSession: MicrophoneCaptureSession;
  liveSession: GeminiLiveHandsFreeSession;
};

export default function Home() {
  const { viewer } = useContext(ViewerContext);

  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
  const [geminiApiKey, setGeminiApiKey] = useState(
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "",
  );
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_LIVE_MODEL);
  const [geminiVoiceName, setGeminiVoiceName] = useState(
    DEFAULT_GEMINI_VOICE_NAME,
  );
  const [chatMicMode, setChatMicMode] = useState<ChatMicMode>("push_to_talk");
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("chat");
  const [podcastTurnCount, setPodcastTurnCount] = useState(
    DEFAULT_PODCAST_TURN_COUNT,
  );
  const [podcastYukitoVoiceName, setPodcastYukitoVoiceName] = useState(
    DEFAULT_PODCAST_PARTICIPANTS.yukito.voiceName,
  );
  const [podcastKiyokaVoiceName, setPodcastKiyokaVoiceName] = useState(
    DEFAULT_PODCAST_PARTICIPANTS.kiyoka.voiceName,
  );
  const [selectedMotionId, setSelectedMotionId] = useState<BuiltInMotionId>(
    DEFAULT_BUILT_IN_MOTION_ID,
  );
  const [chatProcessing, setChatProcessing] = useState(false);
  const [isMicRecording, setIsMicRecording] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [podcastLog, setPodcastLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [assistantStatus, setAssistantStatus] = useState("");
  const [assistantSpeakerName, setAssistantSpeakerName] = useState("");
  const [activePodcastSpeakerId, setActivePodcastSpeakerId] =
    useState<PodcastSpeakerId | null>(null);
  const [screenShareState, setScreenShareState] =
    useState<ScreenShareState>("idle");
  const [screenShareError, setScreenShareError] = useState("");
  const [screenShareSourceLabel, setScreenShareSourceLabel] = useState("");
  const [screenShareFrame, setScreenShareFrame] =
    useState<ScreenShareCaptureFrame | null>(null);
  const [screenShareStats, setScreenShareStats] = useState<ScreenShareCaptureStats>(
    EMPTY_SCREEN_SHARE_CAPTURE_STATS,
  );

  const [youtubeClientId, setYoutubeClientId] = useState(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  );
  const [youtubeAuthState, setYoutubeAuthState] =
    useState<YoutubeAuthState>("idle");
  const [youtubeAuthError, setYoutubeAuthError] = useState("");
  const [youtubeAuthToken, setYoutubeAuthToken] =
    useState<YouTubeAuthToken | null>(null);
  const [youtubeBroadcastLoadState, setYoutubeBroadcastLoadState] =
    useState<YoutubeBroadcastLoadState>("idle");
  const [youtubeBroadcastError, setYoutubeBroadcastError] = useState("");
  const [youtubeBroadcasts, setYoutubeBroadcasts] = useState<
    YouTubeBroadcastSummary[]
  >([]);
  const [selectedYoutubeBroadcastId, setSelectedYoutubeBroadcastId] =
    useState("");
  const [isYoutubeRelayMode, setIsYoutubeRelayMode] = useState(false);
  const [isYoutubeAutoReplyEnabled, setIsYoutubeAutoReplyEnabled] =
    useState(true);
  const [youtubeReceiveState, setYoutubeReceiveState] =
    useState<YoutubeLiveReceiveState>("idle");
  const [youtubeReceiveError, setYoutubeReceiveError] = useState("");
  const [youtubeIncomingComments, setYoutubeIncomingComments] = useState<
    YoutubeIncomingComment[]
  >([]);
  const [youtubePendingComments, setYoutubePendingComments] = useState<
    YouTubeLiveChatMessage[]
  >([]);

  const interactionModeRef = useRef<InteractionMode>(interactionMode);
  const podcastTurnCountRef = useRef(podcastTurnCount);
  const podcastYukitoVoiceNameRef = useRef(podcastYukitoVoiceName);
  const podcastKiyokaVoiceNameRef = useRef(podcastKiyokaVoiceName);
  const chatProcessingRef = useRef(chatProcessing);
  const externalControlBusyRef = useRef(false);
  const chatLogRef = useRef<Message[]>([]);
  const podcastTurnsRef = useRef<PodcastTurn[]>([]);
  const podcastViewerRegistryRef = useRef<Partial<PodcastViewerRegistry>>({});
  const podcastRunTokenRef = useRef(0);
  const externalControlStateRef =
    useRef<GeminiVrmExternalControlState | null>(null);
  const youtubeSeenCommentIdsRef = useRef<Set<string>>(new Set());
  const youtubePollPageTokenRef = useRef<string | null>(null);
  const youtubeRelayPrimedRef = useRef(false);
  const youtubeRelayStartedAtRef = useRef<number>(0);
  const youtubeAutoReplyInFlightRef = useRef(false);
  const isYoutubeAutoReplyEnabledRef = useRef(isYoutubeAutoReplyEnabled);
  const restoredYoutubeAccessTokenRef = useRef<string | null>(null);
  const screenShareSessionRef = useRef<ScreenShareCaptureSession | null>(null);
  const activeMicrophoneTurnRef = useRef<ActiveMicrophoneTurn | null>(null);
  const activeHandsFreeTurnRef = useRef<ActiveHandsFreeTurn | null>(null);
  const activePodcastInterruptListenerRef =
    useRef<ActivePodcastInterruptListener | null>(null);
  const podcastInterruptQueueRef = useRef<string[]>([]);

  interactionModeRef.current = interactionMode;
  podcastTurnCountRef.current = podcastTurnCount;
  podcastYukitoVoiceNameRef.current = podcastYukitoVoiceName;
  podcastKiyokaVoiceNameRef.current = podcastKiyokaVoiceName;
  chatProcessingRef.current = chatProcessing;

  useEffect(() => {
    chatLogRef.current = chatLog;
  }, [chatLog]);

  useEffect(() => {
    isYoutubeAutoReplyEnabledRef.current = isYoutubeAutoReplyEnabled;
  }, [isYoutubeAutoReplyEnabled]);

  const clearScreenShareSession = useCallback(() => {
    const captureSession = screenShareSessionRef.current;
    screenShareSessionRef.current = null;
    captureSession?.stop();
    stopMediaStream(captureSession?.stream ?? null);
  }, []);

  const getActiveScreenShareSession = useCallback(() => {
    const captureSession = screenShareSessionRef.current;
    if (
      !captureSession ||
      !captureSession.stream
        .getVideoTracks()
        .some((track) => track.readyState === "live")
    ) {
      return null;
    }

    return captureSession;
  }, []);

  const resetScreenShare = useCallback(
    (nextState: ScreenShareState, nextError = "") => {
      clearScreenShareSession();
      setScreenShareState(nextState);
      setScreenShareError(nextError);
      setScreenShareSourceLabel("");
      setScreenShareFrame(null);
      setScreenShareStats(EMPTY_SCREEN_SHARE_CAPTURE_STATS);
    },
    [clearScreenShareSession],
  );

  const stopScreenShare = useCallback(() => {
    resetScreenShare("idle");
  }, [resetScreenShare]);

  const handleScreenShareTrackEnded = useCallback(() => {
    resetScreenShare("idle");
  }, [resetScreenShare]);

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareState("error");
      setScreenShareError("This browser does not support screen sharing.");
      setScreenShareSourceLabel("");
      setScreenShareFrame(null);
      setScreenShareStats(EMPTY_SCREEN_SHARE_CAPTURE_STATS);
      return;
    }

    clearScreenShareSession();

    setScreenShareState("starting");
    setScreenShareError("");
    setScreenShareSourceLabel("");
    setScreenShareFrame(null);
    setScreenShareStats(EMPTY_SCREEN_SHARE_CAPTURE_STATS);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 1,
            max: 1,
          },
        },
        audio: false,
      });
      const videoTrack = stream.getVideoTracks()[0];

      if (!videoTrack) {
        stopMediaStream(stream);
        throw new Error("The selected screen share source has no video track.");
      }

      videoTrack.onended = () => {
        handleScreenShareTrackEnded();
      };
      const captureSession = await createScreenShareCaptureSession({
        onFrame: setScreenShareFrame,
        onStatsChange: setScreenShareStats,
        stream,
      });
      screenShareSessionRef.current = captureSession;
      setScreenShareState("active");
      setScreenShareError("");
      setScreenShareSourceLabel(videoTrack.label || "Shared screen");
      setScreenShareStats(captureSession.getStats());
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        resetScreenShare("idle");
        return;
      }

      resetScreenShare(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to start screen sharing.",
      );
    }
  }, [clearScreenShareSession, handleScreenShareTrackEnded, resetScreenShare]);

  useEffect(() => {
    return () => {
      clearScreenShareSession();
    };
  }, [clearScreenShareSession]);

  useEffect(() => {
    const rawChatParams = window.localStorage.getItem(
      CHAT_VRM_PARAMS_STORAGE_KEY,
    );
    const defaultYoutubeClientId =
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
    let restoredYoutubeClientId = defaultYoutubeClientId;
    let restoredRelayMode = false;

    if (rawChatParams) {
      try {
        const params = JSON.parse(rawChatParams);
        setSystemPrompt(params.systemPrompt ?? SYSTEM_PROMPT);
        setChatLog(params.chatLog ?? []);
        setPodcastLog(params.podcastLog ?? []);
        setGeminiModel(params.geminiModel ?? DEFAULT_GEMINI_LIVE_MODEL);
        setGeminiVoiceName(params.geminiVoiceName ?? DEFAULT_GEMINI_VOICE_NAME);
        setChatMicMode(
          CHAT_MIC_MODES.includes(params.chatMicMode)
            ? params.chatMicMode
            : "push_to_talk",
        );
        setInteractionMode(
          params.interactionMode === "podcast" ? "podcast" : "chat",
        );
        setPodcastTurnCount(clampPodcastTurnCount(params.podcastTurnCount));
        setPodcastYukitoVoiceName(
          typeof params.podcastYukitoVoiceName === "string"
            ? params.podcastYukitoVoiceName
            : DEFAULT_PODCAST_PARTICIPANTS.yukito.voiceName,
        );
        setPodcastKiyokaVoiceName(
          typeof params.podcastKiyokaVoiceName === "string"
            ? params.podcastKiyokaVoiceName
            : DEFAULT_PODCAST_PARTICIPANTS.kiyoka.voiceName,
        );
        if (
          typeof params.selectedMotionId === "string" &&
          isBuiltInMotionId(params.selectedMotionId)
        ) {
          setSelectedMotionId(params.selectedMotionId);
        }
        if (typeof params.youtubeClientId === "string") {
          restoredYoutubeClientId = params.youtubeClientId;
        }
        setSelectedYoutubeBroadcastId(params.selectedYoutubeBroadcastId ?? "");
        restoredRelayMode = Boolean(
          params.isYoutubeRelayMode ?? params.isYoutubeBroadcastMode ?? false,
        );
        setIsYoutubeAutoReplyEnabled(
          Boolean(params.isYoutubeAutoReplyEnabled ?? true),
        );
      } catch {
        window.localStorage.removeItem(CHAT_VRM_PARAMS_STORAGE_KEY);
      }
    }

    setYoutubeClientId(restoredYoutubeClientId);

    const rawYoutubeAuthSession = window.localStorage.getItem(
      YOUTUBE_AUTH_SESSION_STORAGE_KEY,
    );
    if (!rawYoutubeAuthSession) {
      setIsYoutubeRelayMode(false);
      return;
    }

    const restoredAuthSession = parseYoutubeAuthSession(rawYoutubeAuthSession);
    if (!restoredAuthSession) {
      window.localStorage.removeItem(YOUTUBE_AUTH_SESSION_STORAGE_KEY);
      setIsYoutubeRelayMode(false);
      return;
    }

    if (!isYoutubeAuthTokenUsable(restoredAuthSession.token)) {
      window.localStorage.removeItem(YOUTUBE_AUTH_SESSION_STORAGE_KEY);
      setIsYoutubeRelayMode(false);
      return;
    }

    setYoutubeClientId(restoredAuthSession.clientId);
    setYoutubeAuthToken(restoredAuthSession.token);
    setYoutubeAuthState("authenticated");
    setYoutubeAuthError("");
    setIsYoutubeRelayMode(restoredRelayMode);
    restoredYoutubeAccessTokenRef.current =
      restoredAuthSession.token.accessToken;
  }, []);

  useEffect(() => {
    if (
      isYoutubeAuthUsable(youtubeAuthToken) &&
      youtubeClientId &&
      youtubeAuthState === "authenticated"
    ) {
      saveYoutubeAuthSession({
        clientId: youtubeClientId,
        token: youtubeAuthToken,
      });
      return;
    }

    clearYoutubeAuthSession();
  }, [youtubeAuthState, youtubeAuthToken, youtubeClientId]);

  useEffect(() => {
    const motion = BUILT_IN_MOTIONS[selectedMotionId];
    void viewer.setMotion(motion);
    Object.values(podcastViewerRegistryRef.current).forEach((podcastViewer) => {
      void podcastViewer.setMotion(motion);
    });
  }, [selectedMotionId, viewer]);

  useEffect(() => {
    window.localStorage.setItem(
      CHAT_VRM_PARAMS_STORAGE_KEY,
        JSON.stringify({
          systemPrompt,
          chatLog: chatLog.map(stripTransientMessageImageData),
          podcastLog: podcastLog.map(stripTransientMessageImageData),
          geminiModel,
          geminiVoiceName,
          chatMicMode,
          interactionMode,
          podcastTurnCount,
        podcastYukitoVoiceName,
        podcastKiyokaVoiceName,
        selectedMotionId,
        youtubeClientId,
        selectedYoutubeBroadcastId,
        isYoutubeRelayMode,
        isYoutubeAutoReplyEnabled,
      }),
    );
  }, [
    systemPrompt,
    chatLog,
    podcastLog,
    geminiModel,
    geminiVoiceName,
    chatMicMode,
    interactionMode,
    podcastTurnCount,
    podcastYukitoVoiceName,
    podcastKiyokaVoiceName,
    selectedMotionId,
    youtubeClientId,
    selectedYoutubeBroadcastId,
    isYoutubeRelayMode,
    isYoutubeAutoReplyEnabled,
  ]);

  useEffect(() => {
    if (youtubeBroadcasts.length === 0) {
      if (selectedYoutubeBroadcastId) {
        setSelectedYoutubeBroadcastId("");
      }
      return;
    }

    const hasSelectedBroadcast = youtubeBroadcasts.some(
      (broadcast) => broadcast.id === selectedYoutubeBroadcastId,
    );

    if (!hasSelectedBroadcast) {
      setSelectedYoutubeBroadcastId(
        youtubeBroadcasts.find((broadcast) => broadcast.liveChatId)?.id ??
          youtubeBroadcasts[0].id,
      );
    }
  }, [selectedYoutubeBroadcastId, youtubeBroadcasts]);

  useEffect(() => {
    if (isYoutubeAutoReplyEnabled) {
      return;
    }

    setYoutubePendingComments([]);
  }, [isYoutubeAutoReplyEnabled]);

  const handleChangeChatLog = useCallback(
    (targetIndex: number, text: string) => {
      const updateMessageList = (currentMessageList: Message[]) =>
        currentMessageList.map((value: Message, index) =>
          index === targetIndex ? updateEditableMessage(value, text) : value,
        );

      if (interactionMode === "podcast") {
        setPodcastLog(updateMessageList);
        return;
      }

      setChatLog(updateMessageList);
    },
    [interactionMode],
  );
  const podcastParticipants = buildRuntimePodcastParticipants({
    yukitoVoiceName: podcastYukitoVoiceName,
    kiyokaVoiceName: podcastKiyokaVoiceName,
  });

  const getExternalControlState = useCallback(
    (): GeminiVrmExternalControlState => {
      const serializedChatLog = toExternalControlLog(chatLog);
      const serializedPodcastLog = toExternalControlLog(podcastLog);

      return {
        interactionMode,
        chatProcessing,
        assistantMessage,
        assistantStatus,
        assistantSpeakerName,
        hasGeminiApiKey: geminiApiKey.trim().length > 0,
        geminiModel,
        geminiVoiceName,
        selectedMotionId,
        podcastTurnCount,
        podcastYukitoVoiceName,
        podcastKiyokaVoiceName,
        activePodcastSpeakerId,
        chatViewerReady: viewer.model != null,
        podcastViewerReady: {
          yukito: podcastViewerRegistryRef.current.yukito?.model != null,
          kiyoka: podcastViewerRegistryRef.current.kiyoka?.model != null,
        },
        chatLog: serializedChatLog,
        podcastLog: serializedPodcastLog,
        activeConversationLog:
          interactionMode === "podcast"
            ? serializedPodcastLog
            : serializedChatLog,
        externalControl: {
          postMessageEnabled: isExternalControlEnabled(),
          messageType: GEMINI_VRM_EXTERNAL_CONTROL_MESSAGE_TYPE,
          resultType: GEMINI_VRM_EXTERNAL_CONTROL_RESULT_TYPE,
        },
      };
    },
    [
      activePodcastSpeakerId,
      assistantMessage,
      assistantSpeakerName,
      assistantStatus,
      chatLog,
      chatProcessing,
      geminiApiKey,
      geminiModel,
      geminiVoiceName,
      interactionMode,
      podcastKiyokaVoiceName,
      podcastLog,
      podcastTurnCount,
      podcastYukitoVoiceName,
      selectedMotionId,
      viewer.model,
    ],
  );
  externalControlStateRef.current = getExternalControlState();

  const getLatestExternalControlState = useCallback(
    () => {
      const nextState = getExternalControlState();
      externalControlStateRef.current = nextState;
      return nextState;
    },
    [getExternalControlState],
  );

  const handlePodcastViewersReady = useCallback(
    (viewers: PodcastViewerRegistry) => {
      podcastViewerRegistryRef.current = viewers;
      const motion = BUILT_IN_MOTIONS[selectedMotionId];
      Object.values(viewers).forEach((podcastViewer) => {
        void podcastViewer.setMotion(motion);
      });
    },
    [selectedMotionId],
  );

  const abortActiveMicrophoneTurn = useCallback(async (reason?: unknown) => {
    const activeTurn = activeMicrophoneTurnRef.current;
    activeMicrophoneTurnRef.current = null;
    chatProcessingRef.current = false;
    setChatProcessing(false);
    setIsMicRecording(false);

    if (!activeTurn) {
      return;
    }

    await activeTurn.captureSession.stop().catch(() => {});
    activeTurn.liveSession.close(reason);
    activeTurn.model?.stopSpeaking();
  }, []);

  const abortActiveHandsFreeTurn = useCallback(async (reason?: unknown) => {
    const activeTurn = activeHandsFreeTurnRef.current;
    activeHandsFreeTurnRef.current = null;
    chatProcessingRef.current = false;
    setChatProcessing(false);
    setIsMicRecording(false);

    if (!activeTurn) {
      return;
    }

    await activeTurn.captureSession.stop().catch(() => {});
    await activeTurn.liveSession.close(reason).catch(() => {});
    activeTurn.model?.stopSpeaking();
  }, []);

  const stopPodcastInterruptListener = useCallback(async (reason?: unknown) => {
    const activeListener = activePodcastInterruptListenerRef.current;
    activePodcastInterruptListenerRef.current = null;
    setIsMicRecording(false);

    if (!activeListener) {
      return;
    }

    await activeListener.captureSession.stop().catch(() => {});
    await activeListener.liveSession.close(reason).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      void abortActiveMicrophoneTurn("Page unload stopped microphone chat.");
      void abortActiveHandsFreeTurn("Page unload stopped hands-free chat.");
      void stopPodcastInterruptListener(
        "Page unload stopped podcast interruption listener.",
      );
    };
  }, [
    abortActiveHandsFreeTurn,
    abortActiveMicrophoneTurn,
    stopPodcastInterruptListener,
  ]);

  useEffect(() => {
    if (interactionMode !== "chat" && activeHandsFreeTurnRef.current) {
      void abortActiveHandsFreeTurn(
        "Hands-free chat stopped because conversation mode changed.",
      );
    }
  }, [abortActiveHandsFreeTurn, interactionMode]);

  useEffect(() => {
    if (chatMicMode !== "hands_free" && activeHandsFreeTurnRef.current) {
      void abortActiveHandsFreeTurn(
        "Hands-free chat stopped because microphone mode changed.",
      );
    }
  }, [abortActiveHandsFreeTurn, chatMicMode]);

  useEffect(() => {
    if (interactionMode !== "podcast" && activePodcastInterruptListenerRef.current) {
      void stopPodcastInterruptListener(
        "Podcast interruption listener stopped because conversation mode changed.",
      );
    }
  }, [interactionMode, stopPodcastInterruptListener]);

  const appendCompletedChatTurn = useCallback(
    (
      nextUserMessage: Message | null,
      nextAssistantMessage: Message | null,
      fallbackAssistantMessage?: string,
    ) => {
      const nextEntries = [
        ...(nextUserMessage ? [nextUserMessage] : []),
        ...(nextAssistantMessage ? [nextAssistantMessage] : []),
      ];
      const updatedChatLog = [...chatLogRef.current, ...nextEntries];
      chatLogRef.current = updatedChatLog;
      setChatLog(updatedChatLog);

      if (nextAssistantMessage) {
        setAssistantSpeakerName(nextAssistantMessage.name ?? "CHARACTER");
        setAssistantMessage(
          nextAssistantMessage.displayContent ?? nextAssistantMessage.content,
        );
        return;
      }

      if (fallbackAssistantMessage) {
        setAssistantSpeakerName("CHARACTER");
        setAssistantMessage(fallbackAssistantMessage);
      }
    },
    [],
  );

  const startMicrophoneChatTurn = useCallback(async () => {
    if (interactionMode !== "chat") {
      setAssistantSpeakerName("");
      setAssistantStatus("Microphone input is available only in Character chat.");
      setAssistantMessage("");
      return false;
    }

    if (!geminiApiKey) {
      setAssistantSpeakerName("");
      setAssistantMessage("Enter your Gemini API key first.");
      return false;
    }

    if (chatProcessingRef.current) {
      return false;
    }

    const activeScreenShareSession = getActiveScreenShareSession();
    const currentScreenShareImage = toMessageInputImage(
      activeScreenShareSession?.getLatestFrame(),
      "Screen snapshot sent with this voice message",
    );
    const historyMessages = [...chatLogRef.current];
    const screenplay = createNeutralScreenplay("");
    const activeModel = viewer.model;
    let hasStartedAudio = false;
    let captureSession: MicrophoneCaptureSession | undefined;
    let liveSession: GeminiLiveMicChatSession | undefined;

    chatProcessingRef.current = true;
    setChatProcessing(true);
    setAssistantSpeakerName("YOU");
    setAssistantMessage("");
    setAssistantStatus(
      activeScreenShareSession
        ? "Opening microphone and Gemini Live with screen share..."
        : "Opening microphone and Gemini Live...",
    );

    try {
      await activeModel?.beginStreamingSpeak(screenplay);

      liveSession = await createGeminiLiveMicChatSession({
        apiKey: geminiApiKey,
        historyMessages,
        systemPrompt,
        model: geminiModel,
        voiceName: geminiVoiceName,
        screenShareSession: activeScreenShareSession,
        onInputTranscript: (partialTranscript) => {
          if (hasStartedAudio) {
            return;
          }

          setAssistantSpeakerName("YOU");
          setAssistantStatus("Listening to microphone...");
          setAssistantMessage(partialTranscript);
        },
        onOutputTranscript: (partialTranscript) => {
          setAssistantSpeakerName("CHARACTER");
          if (!hasStartedAudio) {
            setAssistantStatus("Receiving response...");
          }
          setAssistantMessage(partialTranscript);
        },
        onAudioChunk: (chunk) => {
          if (!hasStartedAudio) {
            hasStartedAudio = true;
            setAssistantSpeakerName("CHARACTER");
            setAssistantStatus("Playing audio...");
          }

          activeModel?.appendPCMChunk(chunk.data, chunk.mimeType);
        },
      });

      captureSession = await createMicrophoneCaptureSession({
        onAudioChunk: (chunk, mimeType) => {
          liveSession?.sendUserAudioChunk(chunk, mimeType);
        },
      });

      activeMicrophoneTurnRef.current = {
        captureSession,
        historyMessages,
        inputImage: currentScreenShareImage,
        liveSession,
        model: activeModel,
      };

      setIsMicRecording(true);
      setAssistantSpeakerName("YOU");
      setAssistantStatus("Listening to microphone...");
      setAssistantMessage("");
      return true;
    } catch (error) {
      await captureSession?.stop().catch(() => {});
      liveSession?.close(error);
      activeModel?.stopSpeaking();
      console.error(error);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error ? error.message : "Microphone chat failed.",
      );
      chatProcessingRef.current = false;
      setChatProcessing(false);
      setIsMicRecording(false);
      return false;
    }
  }, [
    geminiApiKey,
    geminiModel,
    geminiVoiceName,
    getActiveScreenShareSession,
    interactionMode,
    systemPrompt,
    viewer.model,
  ]);

  const stopMicrophoneChatTurn = useCallback(async () => {
    const activeTurn = activeMicrophoneTurnRef.current;
    if (!activeTurn) {
      return false;
    }

    activeMicrophoneTurnRef.current = null;
    setIsMicRecording(false);
    setAssistantSpeakerName("YOU");
    setAssistantStatus("Finishing microphone input...");

    try {
      await activeTurn.captureSession.stop();

      const response = await activeTurn.liveSession.finishUserAudio();
      const userTranscript =
        response.inputTranscript.trim() || "[Voice input transcript unavailable]";
      const assistantTranscript =
        response.transcript.trim() || "Audio response received.";
      chatLogRef.current = activeTurn.historyMessages;
      appendCompletedChatTurn(
        {
          role: "user" as const,
          content: userTranscript,
          displayContent: userTranscript,
          inputImage: activeTurn.inputImage,
          source: "manual" as const,
          name: "YOU",
        },
        {
          role: "assistant" as const,
          content: assistantTranscript,
          source: "assistant" as const,
          name: "CHARACTER",
        },
      );

      await activeTurn.model?.finishStreamingSpeak();
      setAssistantStatus("");
      return true;
    } catch (error) {
      activeTurn.liveSession.close(error);
      activeTurn.model?.stopSpeaking();
      console.error(error);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error ? error.message : "Microphone chat failed.",
      );
      return false;
    } finally {
      chatProcessingRef.current = false;
      setChatProcessing(false);
      setIsMicRecording(false);
    }
  }, [appendCompletedChatTurn]);

  const startHandsFreeChatTurn = useCallback(async () => {
    if (interactionMode !== "chat") {
      setAssistantSpeakerName("");
      setAssistantStatus("Hands-free mode is available only in Character chat.");
      setAssistantMessage("");
      return false;
    }

    if (!geminiApiKey) {
      setAssistantSpeakerName("");
      setAssistantMessage("Enter your Gemini API key first.");
      return false;
    }

    if (chatProcessingRef.current) {
      return false;
    }

    const activeScreenShareSession = getActiveScreenShareSession();
    const activeModel = viewer.model;
    let liveSession: GeminiLiveHandsFreeSession | undefined;
    let captureSession: MicrophoneCaptureSession | undefined;
    let hasStartedAudio = false;
    let playbackGeneration = 0;

    const handleHandsFreePlaybackError = (error: unknown) => {
      hasStartedAudio = false;
      activeHandsFreeTurnRef.current = null;
      activeModel?.stopSpeaking();
      setIsMicRecording(false);
      chatProcessingRef.current = false;
      setChatProcessing(false);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error ? error.message : "Hands-free chat failed.",
      );
    };

    const armHandsFreePlayback = async () => {
      playbackGeneration += 1;
      await activeModel?.beginStreamingSpeak(createNeutralScreenplay(""));
      return playbackGeneration;
    };

    chatProcessingRef.current = true;
    setChatProcessing(true);
    setIsMicRecording(true);
    setAssistantSpeakerName("YOU");
    setAssistantMessage("");
    setAssistantStatus(
      activeScreenShareSession
        ? "Hands-free mode is listening with screen share..."
        : "Hands-free mode is listening...",
    );

    try {
      await armHandsFreePlayback();

      liveSession = await createGeminiLiveHandsFreeSession({
        apiKey: geminiApiKey,
        historyMessages: chatLogRef.current,
        systemPrompt,
        model: geminiModel,
        voiceName: geminiVoiceName,
        screenShareSession: activeScreenShareSession,
        onInputTranscript: (partialTranscript) => {
          if (!partialTranscript.trim()) {
            return;
          }

          setAssistantSpeakerName("YOU");
          setAssistantStatus("Hands-free mode is listening...");
          setAssistantMessage(partialTranscript);
        },
        onOutputTranscript: (partialTranscript) => {
          setAssistantSpeakerName("CHARACTER");
          if (!hasStartedAudio) {
            setAssistantStatus("Gemini is replying...");
          }
          setAssistantMessage(partialTranscript);
        },
        onAudioChunk: (chunk) => {
          if (!hasStartedAudio) {
            hasStartedAudio = true;
            setAssistantSpeakerName("CHARACTER");
            setAssistantStatus("Playing audio...");
          }

          activeModel?.appendPCMChunk(chunk.data, chunk.mimeType);
        },
        onTurnComplete: (turn) => {
          const completedPlaybackGeneration = playbackGeneration;
          appendCompletedChatTurn(
            turn.inputTranscript
              ? {
                  role: "user" as const,
                  content: turn.inputTranscript,
                  displayContent: turn.inputTranscript,
                  source: "manual" as const,
                  name: "YOU",
                }
              : null,
            turn.transcript
              ? {
                  role: "assistant" as const,
                  content: turn.transcript,
                  source: "assistant" as const,
                  name: "CHARACTER",
                }
              : null,
            turn.transcript || undefined,
          );

          if (!hasStartedAudio) {
            setAssistantSpeakerName("YOU");
            setAssistantStatus("Hands-free mode is listening...");
            return;
          }

          void (async () => {
            try {
              await activeModel?.finishStreamingSpeak();
              if (
                activeHandsFreeTurnRef.current?.model !== activeModel ||
                playbackGeneration !== completedPlaybackGeneration
              ) {
                return;
              }

              hasStartedAudio = false;
              await armHandsFreePlayback();
              setAssistantSpeakerName("YOU");
              setAssistantStatus("Hands-free mode is listening...");
            } catch (error) {
              handleHandsFreePlaybackError(error);
            }
          })();
        },
        onInterrupted: () => {
          playbackGeneration += 1;
          hasStartedAudio = false;
          activeModel?.stopSpeaking();
          void armHandsFreePlayback().catch(handleHandsFreePlaybackError);
          setAssistantSpeakerName("YOU");
          setAssistantStatus("Hands-free mode is listening...");
        },
        onError: handleHandsFreePlaybackError,
      });

      captureSession = await createMicrophoneCaptureSession({
        onAudioChunk: (chunk, mimeType) => {
          liveSession?.sendUserAudioChunk(chunk, mimeType);
        },
      });

      activeHandsFreeTurnRef.current = {
        captureSession,
        liveSession,
        model: activeModel,
      };

      return true;
    } catch (error) {
      await captureSession?.stop().catch(() => {});
      await liveSession?.close(error).catch(() => {});
      activeModel?.stopSpeaking();
      console.error(error);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error ? error.message : "Hands-free chat failed.",
      );
      chatProcessingRef.current = false;
      setChatProcessing(false);
      setIsMicRecording(false);
      return false;
    }
  }, [
    appendCompletedChatTurn,
    geminiApiKey,
    geminiModel,
    geminiVoiceName,
    getActiveScreenShareSession,
    interactionMode,
    systemPrompt,
    viewer.model,
  ]);

  const stopHandsFreeChatTurn = useCallback(async () => {
    const activeTurn = activeHandsFreeTurnRef.current;
    if (!activeTurn) {
      return false;
    }

    activeHandsFreeTurnRef.current = null;
    setIsMicRecording(false);
    setAssistantStatus("Stopping hands-free mode...");

    try {
      await activeTurn.captureSession.stop();
      await activeTurn.liveSession.close();
      await activeTurn.model?.finishStreamingSpeak();
      setAssistantStatus("");
      return true;
    } catch (error) {
      activeTurn.model?.stopSpeaking();
      console.error(error);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error ? error.message : "Hands-free chat failed.",
      );
      return false;
    } finally {
      chatProcessingRef.current = false;
      setChatProcessing(false);
      setIsMicRecording(false);
    }
  }, []);

  const startChatTurn = useCallback(
    async (nextUserMessage: Message) => {
      const trimmedContent = nextUserMessage.content.trim();
      if (!trimmedContent) {
        return false;
      }

      if (!geminiApiKey) {
        setAssistantSpeakerName("");
        setAssistantMessage("Enter your Gemini API key first.");
        return false;
      }

      const activeScreenShareSession =
        interactionMode === "chat" ? getActiveScreenShareSession() : null;
      const currentScreenShareImage = toMessageInputImage(
        activeScreenShareSession?.getLatestFrame(),
        "Screen snapshot sent with this message",
      );

      const preparedUserMessage = {
        ...nextUserMessage,
        content: trimmedContent,
        inputImage: currentScreenShareImage ?? nextUserMessage.inputImage,
      };

      chatProcessingRef.current = true;
      setChatProcessing(true);
      setAssistantSpeakerName("CHARACTER");
      setAssistantMessage("");
      setAssistantStatus(
        activeScreenShareSession
          ? "Connecting to Gemini Live with screen share..."
          : "Connecting to Gemini Live...",
      );

      const messageLog: Message[] = [
        ...chatLogRef.current,
        preparedUserMessage,
      ];
      chatLogRef.current = messageLog;
      setChatLog(messageLog);
      const screenplay = createNeutralScreenplay("");
      const activeModel = viewer.model;
      let hasStartedAudio = false;

      try {
        await activeModel?.beginStreamingSpeak(screenplay);

        const response = await getGeminiLiveChatResponse({
          apiKey: geminiApiKey,
          messages: messageLog,
          systemPrompt,
          model: geminiModel,
          voiceName: geminiVoiceName,
          screenShareSession: activeScreenShareSession,
          onAudioChunk: (chunk) => {
            if (!hasStartedAudio) {
              hasStartedAudio = true;
              setAssistantStatus("Playing audio...");
            }
            activeModel?.appendPCMChunk(chunk.data, chunk.mimeType);
          },
          onPartialTranscript: (partialTranscript) => {
            if (!hasStartedAudio) {
              setAssistantStatus("Receiving response...");
            }
            setAssistantMessage(partialTranscript);
          },
        });

        const transcript =
          response.transcript.trim() || "Audio response received.";
        const updatedChatLog = [
          ...messageLog,
          {
            role: "assistant" as const,
            content: transcript,
            source: "assistant" as const,
            name: "CHARACTER",
          },
        ];

        chatLogRef.current = updatedChatLog;
        setAssistantMessage(transcript);
        setChatLog(updatedChatLog);

        await activeModel?.finishStreamingSpeak();
        setAssistantStatus("");
        return true;
      } catch (error) {
        activeModel?.stopSpeaking();
        console.error(error);
        setAssistantStatus("Error");
        setAssistantMessage(
          error instanceof Error
            ? error.message
            : "Gemini Live request failed.",
        );
        return false;
      } finally {
        chatProcessingRef.current = false;
        setChatProcessing(false);
      }
    },
    [
      geminiApiKey,
      geminiModel,
      geminiVoiceName,
      getActiveScreenShareSession,
      interactionMode,
      systemPrompt,
      viewer.model,
    ],
  );

  const startPodcastConversation = useCallback(
    async (topic: string) => {
      const trimmedTopic = topic.trim();
      if (!trimmedTopic) {
        return false;
      }

      if (!geminiApiKey) {
        setAssistantSpeakerName("");
        setAssistantMessage("Enter your Gemini API key first.");
        return false;
      }

      const podcastViewers = podcastViewerRegistryRef.current;
      const missingSpeaker = PODCAST_SPEAKER_IDS.find(
        (speakerId) => !podcastViewers[speakerId]?.model,
      );

      if (missingSpeaker) {
        setAssistantSpeakerName("");
        setAssistantStatus("Podcast stage is still loading...");
        setAssistantMessage(
          `${podcastParticipants[missingSpeaker].displayName} is not ready yet.`,
        );
        return false;
      }

      const relayMode = resolvePodcastRelayMode();
      const activeScreenShareSession = getActiveScreenShareSession();
      const usePreparedRelay =
        relayMode === "streaming" && activeScreenShareSession == null;
      clearPodcastDebugEvents();
      const runToken = ++podcastRunTokenRef.current;
      podcastTurnsRef.current = [];
      setPodcastLog([]);
      chatProcessingRef.current = true;
      setChatProcessing(true);
      setAssistantSpeakerName("");
      setAssistantMessage("");
      setAssistantStatus("Preparing podcast mode...");
      logPodcastDebugEvent("start", {
        topic: trimmedTopic,
        runToken,
        relayMode,
        turnCount: podcastTurnCount,
        participants: Object.values(podcastParticipants).map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          voiceName: participant.voiceName,
        })),
      });

      type PodcastRelayChunk = {
        data: Uint8Array;
        mimeType: string;
      };

      type PreparedRelaySession = {
        speakerId: PodcastSpeakerId;
        targetTurnIndex: number;
        session: Promise<GeminiLiveAudioRelaySession>;
        forwardInputChunk: (
          chunk: PodcastRelayChunk,
          context: {
            sourceSpeakerId: PodcastSpeakerId;
            sourceTurnIndex: number;
          },
        ) => void;
        completeInput: (context: {
          sourceSpeakerId: PodcastSpeakerId;
          sourceTurnIndex: number;
        }) => void;
        getResponse: () => Promise<GeminiLiveAudioRelayResponse>;
        setOutputSink: (
          sink: ((chunk: PodcastRelayChunk) => void) | null,
        ) => void;
        setPartialTranscriptSink: (
          sink: ((transcript: string) => void) | null,
        ) => void;
        close: (reason?: unknown) => void;
      };

      const createPreparedRelaySession = (
        targetSpeaker: PodcastParticipant,
        partnerSpeaker: PodcastParticipant,
        turnsForHistory: PodcastTurn[],
        targetTurnIndex: number,
      ): PreparedRelaySession => {
        const pendingChunks: PodcastRelayChunk[] = [];
        let outputSink: ((chunk: PodcastRelayChunk) => void) | null = null;
        let partialTranscriptSink:
          | ((transcript: string) => void)
          | null = null;
        let completion: Promise<GeminiLiveAudioRelayResponse> | undefined;
        let forwardedChunkCount = 0;
        let hasLoggedFirstBufferedOutput = false;
        let hasLoggedFirstPlayedOutput = false;
        let isClosed = false;

        const emitOutputChunk = (chunk: PodcastRelayChunk) => {
          if (!outputSink) {
            pendingChunks.push(chunk);
            return;
          }

          if (!hasLoggedFirstPlayedOutput) {
            hasLoggedFirstPlayedOutput = true;
            logPodcastDebugEvent("prepared-relay-output-first-played", {
              runToken,
              relayMode,
              targetTurnIndex,
              targetSpeakerId: targetSpeaker.id,
              targetSpeakerName: targetSpeaker.displayName,
              partnerSpeakerId: partnerSpeaker.id,
              partnerSpeakerName: partnerSpeaker.displayName,
              forwardedChunkCount,
            });
          }

          outputSink(chunk);
        };

        const flushQueuedChunks = () => {
          if (pendingChunks.length === 0) {
            return;
          }

          const chunks = pendingChunks.splice(0, pendingChunks.length);
          for (const chunk of chunks) {
            emitOutputChunk(chunk);
          }
        };

        const session = createGeminiLiveAudioRelaySession({
          apiKey: geminiApiKey,
          historyMessages: [],
          systemPrompt: buildPodcastRelaySystemPrompt(
            targetSpeaker,
            partnerSpeaker,
            turnsForHistory,
          ),
          model: geminiModel,
          voiceName: targetSpeaker.voiceName,
          onAudioChunk: (chunk) => {
            if (!hasLoggedFirstBufferedOutput) {
              hasLoggedFirstBufferedOutput = true;
              logPodcastDebugEvent("prepared-relay-output-first-chunk", {
                runToken,
                relayMode,
                targetTurnIndex,
                targetSpeakerId: targetSpeaker.id,
                targetSpeakerName: targetSpeaker.displayName,
                partnerSpeakerId: partnerSpeaker.id,
                partnerSpeakerName: partnerSpeaker.displayName,
                buffered: outputSink == null,
              });
            }

            emitOutputChunk({
              data: new Uint8Array(chunk.data),
              mimeType: chunk.mimeType,
            });
          },
          onPartialTranscript: (partialTranscript) => {
            partialTranscriptSink?.(partialTranscript);
          },
        });

        return {
          speakerId: targetSpeaker.id,
          targetTurnIndex,
          session,
          forwardInputChunk(chunk, context) {
            if (isClosed) {
              return;
            }

            forwardedChunkCount += 1;
            if (forwardedChunkCount === 1) {
              logPodcastDebugEvent("prepared-relay-input-first-chunk", {
                runToken,
                relayMode,
                targetTurnIndex,
                targetSpeakerId: targetSpeaker.id,
                targetSpeakerName: targetSpeaker.displayName,
                partnerSpeakerId: partnerSpeaker.id,
                partnerSpeakerName: partnerSpeaker.displayName,
                sourceTurnIndex: context.sourceTurnIndex,
                sourceSpeakerId: context.sourceSpeakerId,
                audioMimeType: chunk.mimeType,
              });
            }

            void session
              .then((relaySession) => {
                relaySession.sendRelayAudioChunk(chunk.data, chunk.mimeType);
              })
              .catch((error) => {
                isClosed = true;
                logPodcastDebugEvent("relay-forward-error", {
                  runToken,
                  relayMode,
                  sourceTurnIndex: context.sourceTurnIndex,
                  sourceSpeakerId: context.sourceSpeakerId,
                  targetTurnIndex,
                  targetSpeakerId: targetSpeaker.id,
                  error:
                    error instanceof Error ? error.message : String(error),
                });
                void session.then((relaySession) =>
                  relaySession.close(
                    error instanceof Error ? error : String(error),
                  ),
                ).catch(() => {
                  // Ignore setup failures during best-effort cleanup.
                });
              });
          },
          completeInput(context) {
            logPodcastDebugEvent("prepared-relay-input-complete", {
              runToken,
              relayMode,
              targetTurnIndex,
              targetSpeakerId: targetSpeaker.id,
              targetSpeakerName: targetSpeaker.displayName,
              sourceTurnIndex: context.sourceTurnIndex,
              sourceSpeakerId: context.sourceSpeakerId,
              forwardedChunkCount,
            });

            if (!completion) {
              completion = session.then((relaySession) => relaySession.audioStreamEnd());
              void completion.catch(() => {
                // Deferred to the active turn error path.
              });
            }
          },
          getResponse() {
            if (!completion) {
              completion = session.then((relaySession) => relaySession.audioStreamEnd());
            }

            return completion;
          },
          setOutputSink(sink) {
            outputSink = sink;
            flushQueuedChunks();
          },
          setPartialTranscriptSink(sink) {
            partialTranscriptSink = sink;
          },
          close(reason) {
            isClosed = true;
            void session.then((relaySession) =>
              relaySession.close(
                reason instanceof Error ? reason.message : String(reason ?? ""),
              ),
            ).catch(() => {
              // Ignore setup failures during best-effort cleanup.
            });
          },
        };
      };

      const closePreparedRelaySession = (
        targetSession: PreparedRelaySession | null,
        reason: unknown,
      ) => {
        if (!targetSession) {
          return;
        }

        targetSession.close(reason);
      };

      let preparedSessionForNextTurn: PreparedRelaySession | null = null;

      try {

        for (let turnIndex = 0; turnIndex < podcastTurnCount; turnIndex += 1) {
          if (runToken !== podcastRunTokenRef.current) {
            logPodcastDebugEvent("cancelled", {
              reason: "run-token-changed",
              runToken,
              turnIndex,
            });
            return false;
          }

          const speakerId: PodcastSpeakerId =
            turnIndex % 2 === 0 ? "yukito" : "kiyoka";
          const partnerId = speakerId === "yukito" ? "kiyoka" : "yukito";
          const speaker = podcastParticipants[speakerId];
          const partner = podcastParticipants[partnerId];
          const speakerModel = podcastViewers[speakerId]?.model;

          if (!speakerModel) {
            throw new Error(`${speaker.displayName} is not ready for audio playback.`);
          }

          const priorTurns = podcastTurnsRef.current;
          const priorMessages = podcastTurnsToGeminiMessages(priorTurns, speakerId);
          const latestPartnerTurn = priorTurns[priorTurns.length - 1];
          const listenerInterrupt =
            podcastInterruptQueueRef.current.shift()?.trim() ?? "";
          const currentScreenShareImage = toMessageInputImage(
            activeScreenShareSession?.getLatestFrame(),
            `${speaker.displayName} turn input snapshot`,
          );
          let preparedSessionForCurrentTurn =
            preparedSessionForNextTurn?.speakerId === speakerId
              ? preparedSessionForNextTurn
              : null;
          const nextSpeakerId =
            speakerId === "yukito" ? "kiyoka" : "yukito";
          let preparedSessionForFollowingTurn: PreparedRelaySession | null = null;
          let hasStartedAudio = false;
          const turnStartedAtMs = performance.now();
          let firstAssistantAudioAtMs: number | null = null;
          let responseResolvedAtMs: number | null = null;
          let responsePath: "opening" | "prepared" | "batch" | "listener-interrupt" =
            listenerInterrupt
              ? "listener-interrupt"
              : latestPartnerTurn == null
                ? "opening"
                : preparedSessionForCurrentTurn && usePreparedRelay
                  ? "prepared"
                  : "batch";

          if (
            preparedSessionForNextTurn &&
            preparedSessionForNextTurn.speakerId !== speakerId
          ) {
            closePreparedRelaySession(
              preparedSessionForNextTurn,
              "Speaker rotation changed before relay session consumed.",
            );
            preparedSessionForCurrentTurn = null;
          }
          preparedSessionForNextTurn = null;

          if (listenerInterrupt && preparedSessionForCurrentTurn) {
            closePreparedRelaySession(
              preparedSessionForCurrentTurn,
              "Listener interrupted before prepared relay session was consumed.",
            );
            preparedSessionForCurrentTurn = null;
          }

          setActivePodcastSpeakerId(speakerId);
          setAssistantSpeakerName(speaker.displayName);
          setAssistantMessage("");
          setAssistantStatus(
            `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} speaking...`,
          );
          logPodcastDebugEvent("turn-start", {
            runToken,
            relayMode,
            turnIndex,
            speakerId,
            speakerName: speaker.displayName,
            partnerId,
            partnerName: partner.displayName,
            responsePath,
            hasLatestPartnerTurn: latestPartnerTurn != null,
            hasListenerInterrupt: Boolean(listenerInterrupt),
          });

          await speakerModel.beginStreamingSpeak(createNeutralScreenplay(""));

          const nextSpeaker =
            podcastParticipants[nextSpeakerId];
          if (usePreparedRelay && turnIndex < podcastTurnCount - 1) {
            preparedSessionForFollowingTurn = createPreparedRelaySession(
              nextSpeaker,
              speaker,
              priorTurns,
              turnIndex + 1,
            );
            preparedSessionForNextTurn = preparedSessionForFollowingTurn;
          }

          const forwardCurrentSpeakerAudioChunk = (chunk: PodcastRelayChunk) => {
            if (!preparedSessionForFollowingTurn) {
              return;
            }

            preparedSessionForFollowingTurn.forwardInputChunk(chunk, {
              sourceSpeakerId: speakerId,
              sourceTurnIndex: turnIndex,
            });
          };

          if (preparedSessionForCurrentTurn) {
            const relayReplyStatus = `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} replying...`;
            const relayDraftStatus = `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} thinking...`;

            preparedSessionForCurrentTurn.setOutputSink((chunk) => {
              if (!hasStartedAudio) {
                hasStartedAudio = true;
                firstAssistantAudioAtMs = performance.now();
                logPodcastDebugEvent("turn-first-audio", {
                  runToken,
                  relayMode,
                  turnIndex,
                  speakerId,
                  speakerName: speaker.displayName,
                  responsePath,
                  firstAssistantAudioDelayMs:
                    firstAssistantAudioAtMs - turnStartedAtMs,
                });
                setAssistantStatus(relayReplyStatus);
              }

              speakerModel.appendPCMChunk(chunk.data, chunk.mimeType);
              forwardCurrentSpeakerAudioChunk(chunk);
            });
            preparedSessionForCurrentTurn.setPartialTranscriptSink((partialTranscript) => {
              if (!hasStartedAudio) {
                setAssistantStatus(relayDraftStatus);
              }
              setAssistantMessage(partialTranscript);
            });
          }

          const runBatchRelayResponse = async () => {
            if (!latestPartnerTurn) {
              throw new Error("Batch relay response has no previous turn.");
            }

            logPodcastDebugEvent("batch-relay-start", {
              runToken,
              relayMode,
              turnIndex,
              speakerId,
              speakerName: speaker.displayName,
              partnerId,
              partnerName: partner.displayName,
              responsePath,
              relayAudioBytesLength: latestPartnerTurn.audioBytes.byteLength,
              relayAudioMimeType: latestPartnerTurn.audioMimeType,
            });

            return getGeminiLiveAudioRelayResponse({
              apiKey: geminiApiKey,
              historyMessages: priorMessages,
              systemPrompt: buildPodcastRelaySystemPrompt(
                speaker,
                partner,
                priorTurns,
                latestPartnerTurn.transcript,
              ),
              relayAudioBytes: latestPartnerTurn.audioBytes,
              relayAudioMimeType: latestPartnerTurn.audioMimeType,
              model: geminiModel,
              voiceName: speaker.voiceName,
              screenShareSession: activeScreenShareSession,
              onAudioChunk: (chunk) => {
                if (!hasStartedAudio) {
                  hasStartedAudio = true;
                  firstAssistantAudioAtMs = performance.now();
                  logPodcastDebugEvent("turn-first-audio", {
                    runToken,
                    relayMode,
                    turnIndex,
                    speakerId,
                    speakerName: speaker.displayName,
                    responsePath,
                    firstAssistantAudioDelayMs:
                      firstAssistantAudioAtMs - turnStartedAtMs,
                  });
                  setAssistantStatus(
                    `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} replying...`,
                  );
                }
                speakerModel.appendPCMChunk(chunk.data, chunk.mimeType);
                forwardCurrentSpeakerAudioChunk(chunk);
              },
              onPartialTranscript: (partialTranscript) => {
                if (!hasStartedAudio) {
                  setAssistantStatus(
                    `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} thinking...`,
                  );
                }
                setAssistantMessage(partialTranscript);
              },
            });
          };

          const runRelayResponse = async () => {
            if (!preparedSessionForCurrentTurn) {
              return runBatchRelayResponse();
            }

            try {
              return await preparedSessionForCurrentTurn.getResponse();
            } catch (error) {
              preparedSessionForCurrentTurn.setOutputSink(null);
              preparedSessionForCurrentTurn.setPartialTranscriptSink(null);
              preparedSessionForCurrentTurn.close(error);

              if (preparedSessionForFollowingTurn) {
                closePreparedRelaySession(
                  preparedSessionForFollowingTurn,
                  "Discarding prewarmed next relay after prepared relay failure.",
                );
                preparedSessionForFollowingTurn = null;
                preparedSessionForNextTurn = null;
              }

              throw error;
            }
          };

          const runListenerInterruptResponse = async () => {
            logPodcastDebugEvent("listener-interrupt-start", {
              runToken,
              relayMode,
              turnIndex,
              speakerId,
              speakerName: speaker.displayName,
              listenerInterrupt,
            });

            return getGeminiLiveChatResponse({
              apiKey: geminiApiKey,
              messages: [
                ...priorMessages,
                {
                  role: "user",
                  content: buildPodcastListenerInterruptPrompt(
                    listenerInterrupt,
                    speaker,
                    partner,
                    priorTurns,
                  ),
                  name: "LISTENER",
                  source: "manual",
                },
              ],
              systemPrompt: speaker.systemPrompt,
              model: geminiModel,
              voiceName: speaker.voiceName,
              screenShareSession: activeScreenShareSession,
              onAudioChunk: (chunk) => {
                if (!hasStartedAudio) {
                  hasStartedAudio = true;
                  firstAssistantAudioAtMs = performance.now();
                  logPodcastDebugEvent("turn-first-audio", {
                    runToken,
                    relayMode,
                    turnIndex,
                    speakerId,
                    speakerName: speaker.displayName,
                    responsePath,
                    firstAssistantAudioDelayMs:
                      firstAssistantAudioAtMs - turnStartedAtMs,
                  });
                  setAssistantStatus(
                    `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} answering listener...`,
                  );
                }
                speakerModel.appendPCMChunk(chunk.data, chunk.mimeType);
                forwardCurrentSpeakerAudioChunk(chunk);
              },
              onPartialTranscript: (partialTranscript) => {
                if (!hasStartedAudio) {
                  setAssistantStatus(
                    `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} thinking about listener comment...`,
                  );
                }
                setAssistantMessage(partialTranscript);
              },
            });
          };

          const response =
            listenerInterrupt
              ? await runListenerInterruptResponse()
              : latestPartnerTurn == null
                ? await getGeminiLiveChatResponse({
                  apiKey: geminiApiKey,
                  messages: [
                    ...priorMessages,
                    {
                      role: "user",
                      content: buildPodcastOpeningPrompt(
                        trimmedTopic,
                        speaker,
                        partner,
                        podcastTurnCount,
                      ),
                      name: "PODCAST",
                      source: "podcast",
                    },
                  ],
                  systemPrompt: speaker.systemPrompt,
                  model: geminiModel,
                  voiceName: speaker.voiceName,
                  screenShareSession: activeScreenShareSession,
                  onAudioChunk: (chunk) => {
                    if (!hasStartedAudio) {
                      hasStartedAudio = true;
                      firstAssistantAudioAtMs = performance.now();
                      logPodcastDebugEvent("turn-first-audio", {
                        runToken,
                        relayMode,
                        turnIndex,
                        speakerId,
                        speakerName: speaker.displayName,
                        responsePath,
                        firstAssistantAudioDelayMs:
                          firstAssistantAudioAtMs - turnStartedAtMs,
                      });
                      setAssistantStatus(
                        `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} on mic...`,
                      );
                    }
                    speakerModel.appendPCMChunk(chunk.data, chunk.mimeType);
                    forwardCurrentSpeakerAudioChunk(chunk);
                  },
                  onPartialTranscript: (partialTranscript) => {
                    if (!hasStartedAudio) {
                      setAssistantStatus(
                        `Podcast ${turnIndex + 1}/${podcastTurnCount} - ${speaker.displayName} drafting...`,
                      );
                    }
                    setAssistantMessage(partialTranscript);
                  },
                })
              : await runRelayResponse();
          responseResolvedAtMs = performance.now();

          preparedSessionForFollowingTurn?.completeInput({
            sourceSpeakerId: speakerId,
            sourceTurnIndex: turnIndex,
          });

          closePreparedRelaySession(
            preparedSessionForCurrentTurn,
            "Relay session completed for current turn.",
          );
          const inputTranscript =
            "inputTranscript" in response ? response.inputTranscript : "";

          const transcript =
            response.transcript.trim() ||
            `${speaker.displayName} responded with audio.`;
          const nextTurn: PodcastTurn = {
            speakerId,
            speakerName: speaker.displayName,
            transcript,
            audioMimeType: response.audioMimeType,
            audioBytes: response.audioBytes,
            inputImage: currentScreenShareImage ?? undefined,
          };

          podcastTurnsRef.current = [...podcastTurnsRef.current, nextTurn];
          const displayLog = buildPodcastDisplayLog(podcastTurnsRef.current);
          setPodcastLog(displayLog);
          setAssistantMessage(transcript);
          logPodcastDebugEvent("turn-complete", {
            runToken,
            relayMode,
            turnIndex,
            speakerId,
            speakerName: speaker.displayName,
            partnerId,
            partnerName: partner.displayName,
            responsePath,
            transcript,
            inputTranscript,
            audioMimeType: response.audioMimeType,
            audioBytesLength: response.audioBytes.byteLength,
            turnDurationMs: responseResolvedAtMs - turnStartedAtMs,
            firstAssistantAudioDelayMs:
              firstAssistantAudioAtMs == null
                ? null
                : firstAssistantAudioAtMs - turnStartedAtMs,
            conversationLog: displayLog.map((entry, index) => ({
              index,
              role: entry.role,
              name: entry.name,
              content: entry.displayContent ?? entry.content,
            })),
          });

          await speakerModel.finishStreamingSpeak();
          logPodcastDebugEvent("turn-playback-finished", {
            runToken,
            relayMode,
            turnIndex,
            speakerId,
            speakerName: speaker.displayName,
            responsePath,
            playbackFinishedDelayMs: performance.now() - turnStartedAtMs,
            firstAssistantAudioDelayMs:
              firstAssistantAudioAtMs == null
                ? null
                : firstAssistantAudioAtMs - turnStartedAtMs,
          });

          if (turnIndex < podcastTurnCount - 1) {
            setAssistantStatus(
              `${speaker.displayName} finished. Handing the mic to ${partner.displayName}...`,
            );
            await wait(PODCAST_INTER_TURN_DELAY_MS);
          }
        }

        setAssistantStatus("Podcast finished.");
        logPodcastDebugEvent("finished", {
          runToken,
          topic: trimmedTopic,
          relayMode,
          turnCount: podcastTurnsRef.current.length,
          turns: podcastTurnsRef.current.map((turn, index) => ({
            index,
            speakerId: turn.speakerId,
            speakerName: turn.speakerName,
            transcript: turn.transcript,
          })),
        });
        return true;
      } catch (error) {
        Object.values(podcastViewers).forEach((podcastViewer) =>
          podcastViewer.model?.stopSpeaking(),
        );
        if (preparedSessionForNextTurn) {
          closePreparedRelaySession(
            preparedSessionForNextTurn,
            error instanceof Error ? error : String(error),
          );
        }
        console.error(error);
        logPodcastDebugEvent("error", {
          runToken,
          topic: trimmedTopic,
          relayMode,
          turnCount: podcastTurnsRef.current.length,
          error: error instanceof Error ? error.message : String(error),
        });
        setAssistantStatus("Error");
        setAssistantMessage(
          error instanceof Error ? error.message : "Podcast mode failed.",
        );
        return false;
      } finally {
        if (preparedSessionForNextTurn) {
          closePreparedRelaySession(
            preparedSessionForNextTurn,
            "Podcast conversation ended before relay handoff.",
          );
        }
        setActivePodcastSpeakerId(null);
        chatProcessingRef.current = false;
        setChatProcessing(false);
      }
    },
    [
      geminiApiKey,
      geminiModel,
      getActiveScreenShareSession,
      podcastParticipants,
      podcastTurnCount,
    ],
  );

  const startPodcastInterruptListener = useCallback(async () => {
    if (interactionMode !== "podcast") {
      setAssistantSpeakerName("");
      setAssistantStatus(
        "Podcast interruption listener is available only in Podcast mode.",
      );
      setAssistantMessage("");
      return false;
    }

    if (chatMicMode !== "hands_free") {
      setAssistantSpeakerName("");
      setAssistantStatus("Switch microphone mode to Hands-free first.");
      setAssistantMessage("");
      return false;
    }

    if (!geminiApiKey) {
      setAssistantSpeakerName("");
      setAssistantMessage("Enter your Gemini API key first.");
      return false;
    }

    if (activePodcastInterruptListenerRef.current) {
      return true;
    }

    let liveSession: GeminiLiveHandsFreeSession | undefined;
    let captureSession: MicrophoneCaptureSession | undefined;

    setIsMicRecording(true);
    setAssistantSpeakerName("YOU");
    setAssistantStatus("Listening for listener interruptions...");

    try {
      liveSession = await createGeminiLiveHandsFreeSession({
        apiKey: geminiApiKey,
        historyMessages: buildPodcastDisplayLog(podcastTurnsRef.current),
        systemPrompt: [
          "You are listening for a human listener interruption during a two-host podcast.",
          "Do not answer the listener yourself. Keep any text response short.",
          "The application will use the input audio transcription as the interruption text for the podcast hosts.",
        ].join(" "),
        model: geminiModel,
        onInputTranscript: (partialTranscript) => {
          if (!partialTranscript.trim()) {
            return;
          }

          setAssistantSpeakerName("YOU");
          setAssistantStatus("Listening for listener interruptions...");
          setAssistantMessage(partialTranscript);
        },
        onTurnComplete: (turn) => {
          const interruptText = turn.inputTranscript.trim();
          if (!interruptText) {
            return;
          }

          podcastInterruptQueueRef.current = [
            ...podcastInterruptQueueRef.current,
            interruptText,
          ].slice(-3);
          setAssistantSpeakerName("YOU");
          setAssistantMessage(interruptText);

          if (chatProcessingRef.current) {
            setAssistantStatus("Listener interruption queued for next host...");
            return;
          }

          setAssistantStatus("Starting podcast from listener topic...");
          void startPodcastConversation(interruptText);
        },
        onError: (error) => {
          activePodcastInterruptListenerRef.current = null;
          setIsMicRecording(false);
          setAssistantStatus("Error");
          setAssistantMessage(error.message);
        },
      });

      captureSession = await createMicrophoneCaptureSession({
        onAudioChunk: (chunk, mimeType) => {
          liveSession?.sendUserAudioChunk(chunk, mimeType);
        },
      });

      activePodcastInterruptListenerRef.current = {
        captureSession,
        liveSession,
      };

      return true;
    } catch (error) {
      await captureSession?.stop().catch(() => {});
      await liveSession?.close(error).catch(() => {});
      console.error(error);
      setIsMicRecording(false);
      setAssistantStatus("Error");
      setAssistantMessage(
        error instanceof Error
          ? error.message
          : "Podcast interruption listener failed.",
      );
      return false;
    }
  }, [
    chatMicMode,
    geminiApiKey,
    geminiModel,
    interactionMode,
    startPodcastConversation,
  ]);

  const handleSendChat = useCallback(
    async (text: string) => {
      if (text == null || !text.trim()) {
        return;
      }

      if (interactionMode === "podcast") {
        await startPodcastConversation(text);
        return;
      }

      await startChatTurn({
        role: "user",
        content: text,
        source: "manual",
        name: "YOU",
      });
    },
    [interactionMode, startChatTurn, startPodcastConversation],
  );

  const handleToggleMicRecording = useCallback(async () => {
    if (interactionMode === "podcast") {
      if (isMicRecording) {
        await stopPodcastInterruptListener();
        return;
      }

      await startPodcastInterruptListener();
      return;
    }

    if (isMicRecording) {
      if (chatMicMode === "hands_free") {
        await stopHandsFreeChatTurn();
        return;
      }

      await stopMicrophoneChatTurn();
      return;
    }

    if (chatMicMode === "hands_free") {
      await startHandsFreeChatTurn();
      return;
    }

    await startMicrophoneChatTurn();
  }, [
    chatMicMode,
    interactionMode,
    isMicRecording,
    startHandsFreeChatTurn,
    startMicrophoneChatTurn,
    startPodcastInterruptListener,
    stopHandsFreeChatTurn,
    stopMicrophoneChatTurn,
    stopPodcastInterruptListener,
  ]);

  const dispatchExternalControlCommand = useCallback(
    async (
      command: GeminiVrmExternalControlCommand,
    ): Promise<GeminiVrmExternalControlCommandResult> => {
      const ensureIdle = () => {
        if (chatProcessingRef.current) {
          throw new Error("A chat or podcast turn is already in progress.");
        }
      };

      const shouldSerializeCommand = command.type !== "getState";
      if (shouldSerializeCommand) {
        if (externalControlBusyRef.current) {
          throw new Error("Another external control command is already running.");
        }

        externalControlBusyRef.current = true;
      }

      try {
        switch (command.type) {
          case "getState":
            return {
              state: getLatestExternalControlState(),
              detail: "External control state snapshot captured.",
            };
          case "setInteractionMode": {
            ensureIdle();
            interactionModeRef.current = command.interactionMode;
            setInteractionMode(command.interactionMode);
            await wait(0);

            return {
              state: getLatestExternalControlState(),
              detail: `Interaction mode switched to ${command.interactionMode}.`,
            };
          }
          case "updatePodcastSettings": {
            ensureIdle();

            const nextPodcastTurnCount =
              command.podcastTurnCount == null
                ? podcastTurnCountRef.current
                : clampPodcastTurnCount(command.podcastTurnCount);
            const nextPodcastYukitoVoiceName =
              command.podcastYukitoVoiceName == null
                ? podcastYukitoVoiceNameRef.current
                : resolveExternalVoiceName(
                    command.podcastYukitoVoiceName,
                    DEFAULT_PODCAST_PARTICIPANTS.yukito.voiceName,
                  );
            const nextPodcastKiyokaVoiceName =
              command.podcastKiyokaVoiceName == null
                ? podcastKiyokaVoiceNameRef.current
                : resolveExternalVoiceName(
                    command.podcastKiyokaVoiceName,
                    DEFAULT_PODCAST_PARTICIPANTS.kiyoka.voiceName,
                  );

            podcastTurnCountRef.current = nextPodcastTurnCount;
            podcastYukitoVoiceNameRef.current = nextPodcastYukitoVoiceName;
            podcastKiyokaVoiceNameRef.current = nextPodcastKiyokaVoiceName;
            setPodcastTurnCount(nextPodcastTurnCount);
            setPodcastYukitoVoiceName(nextPodcastYukitoVoiceName);
            setPodcastKiyokaVoiceName(nextPodcastKiyokaVoiceName);
            await wait(0);

            return {
              state: getLatestExternalControlState(),
              detail: "Podcast settings updated.",
            };
          }
          case "setMotion":
            ensureIdle();
            setSelectedMotionId(command.motionId);
            await wait(0);

            return {
              state: getLatestExternalControlState(),
              detail: `Motion switched to ${command.motionId}.`,
            };
          case "sendMessage": {
            ensureIdle();

            const trimmedText = command.text.trim();
            if (!trimmedText) {
              throw new Error("Message text is empty.");
            }

            const currentInteractionMode = interactionModeRef.current;
            const didStartConversation =
              currentInteractionMode === "podcast"
                ? await startPodcastConversation(trimmedText)
                : await startChatTurn({
                    role: "user",
                    content: trimmedText,
                    source: "manual",
                    name: command.authorName?.trim() || "AGENT",
                  });

            if (!didStartConversation) {
              await wait(0);
              throw new Error(
                currentInteractionMode === "podcast"
                  ? "Podcast topic was not accepted. Check the returned state for readiness or error details."
                  : "Chat message was not accepted. Check the returned state for error details.",
              );
            }

            await wait(0);
            return {
              state: getLatestExternalControlState(),
              detail:
                currentInteractionMode === "podcast"
                  ? "Podcast topic submitted."
                  : "Chat message submitted.",
            };
          }
          case "resetConversation": {
            ensureIdle();

            const currentState = getLatestExternalControlState();
            const target = command.target ?? "active";
            const resetChatLog =
              target === "chat" ||
              (target === "active" && currentState.interactionMode === "chat");
            const resetPodcastLog =
              target === "podcast" ||
              (target === "active" && currentState.interactionMode === "podcast");

            if (resetChatLog) {
              chatLogRef.current = [];
              setChatLog([]);
            }

            if (resetPodcastLog) {
              podcastTurnsRef.current = [];
              setPodcastLog([]);
            }

            setAssistantSpeakerName("");
            setAssistantMessage("");
            setAssistantStatus("");
            setActivePodcastSpeakerId(null);
            await wait(0);

            return {
              state: getLatestExternalControlState(),
              detail:
                target === "active"
                  ? "The active conversation log was reset."
                  : `${target} conversation log was reset.`,
            };
          }
        }
      } finally {
        if (shouldSerializeCommand) {
          externalControlBusyRef.current = false;
        }
      }
    },
    [
      getLatestExternalControlState,
      startChatTurn,
      startPodcastConversation,
    ],
  );

  useEffect(() => {
    const externalControlApi: GeminiVrmExternalControlApi = {
      isPostMessageEnabled: isExternalControlEnabled,
      getState: getLatestExternalControlState,
      setInteractionMode: (nextInteractionMode) =>
        dispatchExternalControlCommand({
          type: "setInteractionMode",
          interactionMode: nextInteractionMode,
        }),
      updatePodcastSettings: (settings) =>
        dispatchExternalControlCommand({
          type: "updatePodcastSettings",
          ...settings,
        }),
      setMotion: (motionId) =>
        dispatchExternalControlCommand({
          type: "setMotion",
          motionId,
        }),
      sendMessage: (text, authorName) =>
        dispatchExternalControlCommand({
          type: "sendMessage",
          text,
          authorName,
        }),
      resetConversation: (target) =>
        dispatchExternalControlCommand({
          type: "resetConversation",
          target,
        }),
    };

    if (!isExternalControlEnabled()) {
      delete window.geminiVrmControl;
      return;
    }

    window.geminiVrmControl = externalControlApi;

    const handleExternalControlMessage = async (event: MessageEvent<unknown>) => {
      if (!isGeminiVrmExternalControlRequestMessage(event.data)) {
        return;
      }

      if (!isExternalControlOriginAllowed(event.origin)) {
        return;
      }

      try {
        const result = await dispatchExternalControlCommand(event.data.command);
        postExternalControlResponse(event, {
          type: GEMINI_VRM_EXTERNAL_CONTROL_RESULT_TYPE,
          id: event.data.id,
          ok: true,
          result: {
            state: toExternalControlSummary(result.state),
            detail: result.detail,
          },
        });
      } catch (error) {
        postExternalControlResponse(event, {
          type: GEMINI_VRM_EXTERNAL_CONTROL_RESULT_TYPE,
          id: event.data.id,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "External control command failed.",
          result: {
            state: toExternalControlSummary(getLatestExternalControlState()),
          },
        });
      }
    };

    window.addEventListener("message", handleExternalControlMessage);

    return () => {
      window.removeEventListener("message", handleExternalControlMessage);

      if (window.geminiVrmControl === externalControlApi) {
        delete window.geminiVrmControl;
      }
    };
  }, [dispatchExternalControlCommand, getLatestExternalControlState]);

  const resetYoutubeSession = useCallback((message: string) => {
    clearYoutubeAuthSession();
    setYoutubeAuthToken(null);
    setYoutubeAuthState("error");
    setYoutubeAuthError(message);
    setYoutubeBroadcasts([]);
    setYoutubeBroadcastLoadState("error");
    setYoutubeBroadcastError(message);
    setIsYoutubeRelayMode(false);
    setYoutubeReceiveState("error");
    setYoutubeReceiveError(message);
    setYoutubeIncomingComments([]);
    setYoutubePendingComments([]);
    youtubeSeenCommentIdsRef.current.clear();
    youtubePollPageTokenRef.current = null;
    youtubeRelayPrimedRef.current = false;
  }, []);

  const getFreshYoutubeAccessToken = useCallback(
    (accessTokenOverride?: string) => {
      if (accessTokenOverride) {
        return accessTokenOverride;
      }

      if (isYoutubeAuthUsable(youtubeAuthToken)) {
        return youtubeAuthToken.accessToken;
      }

      const expiredMessage =
        "YouTube sign-in expired. Sign in with Google again.";
      if (youtubeAuthToken) {
        resetYoutubeSession(expiredMessage);
      } else {
        setYoutubeAuthError(expiredMessage);
      }
      return "";
    },
    [resetYoutubeSession, youtubeAuthToken],
  );

  const refreshYoutubeBroadcasts = useCallback(
    async (accessTokenOverride?: string) => {
      const accessToken = getFreshYoutubeAccessToken(accessTokenOverride);

      if (!accessToken) {
        setYoutubeBroadcastLoadState("error");
        setYoutubeBroadcastError(
          "Connect Google first to load your active or upcoming broadcasts.",
        );
        return;
      }

      setYoutubeBroadcastLoadState("loading");
      setYoutubeBroadcastError("");

      try {
        const result = await listLiveBroadcasts({
          accessToken,
          includeActive: true,
          includeUpcoming: true,
        });

        const sortedBroadcasts = [...result.broadcasts].sort(
          compareYoutubeBroadcasts,
        );

        setYoutubeBroadcasts(sortedBroadcasts);
        setYoutubeBroadcastLoadState("ready");
      } catch (error) {
        if (isYoutubeAuthRejectedError(error)) {
          resetYoutubeSession(
            "YouTube sign-in expired or was revoked. Sign in with Google again.",
          );
          return;
        }

        setYoutubeBroadcastLoadState("error");
        setYoutubeBroadcastError(userFacingMessage(error));
      }
    },
    [getFreshYoutubeAccessToken, resetYoutubeSession],
  );

  const handleSignInToYoutube = useCallback(async () => {
    setYoutubeAuthState("connecting");
    setYoutubeAuthError("");
    setYoutubeBroadcastError("");
    setYoutubeReceiveError("");

    try {
      const nextAuthState = await requestYouTubeAccessToken({
        clientId: youtubeClientId.trim(),
      });

      if (!nextAuthState.token) {
        throw new Error("YouTube sign-in did not return an access token.");
      }

      setYoutubeClientId(nextAuthState.clientId);
      setYoutubeAuthToken(nextAuthState.token);
      setYoutubeAuthState("authenticated");
      saveYoutubeAuthSession({
        clientId: nextAuthState.clientId,
        token: nextAuthState.token,
      });

      await refreshYoutubeBroadcasts(nextAuthState.token.accessToken);
    } catch (error) {
      clearYoutubeAuthSession();
      setYoutubeAuthToken(null);
      setYoutubeAuthState("error");
      setYoutubeAuthError(userFacingMessage(error));
    }
  }, [refreshYoutubeBroadcasts, youtubeClientId]);

  const handleSignOutFromYoutube = useCallback(() => {
    clearYoutubeAuthSession();
    setYoutubeAuthToken(null);
    setYoutubeAuthState("idle");
    setYoutubeAuthError("");
    setYoutubeBroadcastLoadState("idle");
    setYoutubeBroadcastError("");
    setYoutubeBroadcasts([]);
    setSelectedYoutubeBroadcastId("");
    setIsYoutubeRelayMode(false);
    setIsYoutubeAutoReplyEnabled(true);
    setYoutubeReceiveState("idle");
    setYoutubeReceiveError("");
    setYoutubeIncomingComments([]);
    setYoutubePendingComments([]);
    youtubeSeenCommentIdsRef.current.clear();
    youtubePollPageTokenRef.current = null;
    youtubeRelayPrimedRef.current = false;
  }, []);

  const handleRefreshYoutubeBroadcasts = useCallback(() => {
    void refreshYoutubeBroadcasts();
  }, [refreshYoutubeBroadcasts]);

  useEffect(() => {
    const restoredAccessToken = restoredYoutubeAccessTokenRef.current;
    if (!restoredAccessToken) {
      return;
    }

    restoredYoutubeAccessTokenRef.current = null;
    void refreshYoutubeBroadcasts(restoredAccessToken);
  }, [refreshYoutubeBroadcasts]);

  const handleSelectYoutubeBroadcast = useCallback(
    (broadcast: { id: string }) => {
      setSelectedYoutubeBroadcastId(broadcast.id);
      setYoutubeReceiveError("");
    },
    [],
  );

  const selectedYoutubeBroadcast = youtubeBroadcasts.find(
    (broadcast) => broadcast.id === selectedYoutubeBroadcastId,
  );

  useEffect(() => {
    youtubeAutoReplyInFlightRef.current = false;

    if (
      youtubeAuthState !== "authenticated" ||
      !isYoutubeRelayMode ||
      !selectedYoutubeBroadcast?.liveChatId
    ) {
      setYoutubeReceiveState("idle");
      if (!isYoutubeRelayMode) {
        setYoutubeReceiveError("");
      }
      setYoutubePendingComments([]);
      youtubeSeenCommentIdsRef.current.clear();
      youtubePollPageTokenRef.current = null;
      youtubeRelayPrimedRef.current = false;
      return;
    }

    let isCancelled = false;
    let timeoutId: number | undefined;

    youtubeSeenCommentIdsRef.current.clear();
    youtubePollPageTokenRef.current = null;
    youtubeRelayPrimedRef.current = false;
    youtubeRelayStartedAtRef.current = Date.now();
    setYoutubeIncomingComments([]);
    setYoutubePendingComments([]);
    setYoutubeReceiveState("idle");
    setYoutubeReceiveError("");

    const schedulePoll = (delayMs: number) => {
      if (isCancelled) {
        return;
      }

      timeoutId = window.setTimeout(
        pollLiveComments,
        Math.max(delayMs, MIN_YOUTUBE_POLL_INTERVAL_MS),
      );
    };

    const pollLiveComments = async () => {
      const accessToken = getFreshYoutubeAccessToken();
      if (!accessToken) {
        if (!isCancelled) {
          setYoutubeReceiveState("error");
          setYoutubeReceiveError(
            "YouTube sign-in expired. Sign in with Google again.",
          );
        }
        return;
      }

      try {
        const response = await listLiveChatMessages({
          accessToken,
          liveChatId: selectedYoutubeBroadcast.liveChatId ?? "",
          pageToken: youtubePollPageTokenRef.current,
        });

        if (isCancelled) {
          return;
        }

        youtubePollPageTokenRef.current = response.nextPageToken;
        const relayCandidates = response.messages
          .filter((message) =>
            isRelayCandidateMessage(
              message,
              selectedYoutubeBroadcast.channelId,
            ),
          )
          .sort(compareYouTubeLiveChatMessages);

        setYoutubeReceiveState("listening");
        setYoutubeReceiveError("");

        if (!youtubeRelayPrimedRef.current) {
          youtubeRelayPrimedRef.current = true;
          const relayStartedAt = youtubeRelayStartedAtRef.current;
          const commentsAfterRelayEnabled = relayCandidates.filter((message) =>
            isCommentNewSinceRelayEnabled(message.publishedAt, relayStartedAt),
          );
          relayCandidates.forEach((message) =>
            rememberYouTubeCommentId(
              youtubeSeenCommentIdsRef.current,
              message.id,
            ),
          );
          setYoutubeIncomingComments(
            mergeIncomingComments(
              relayCandidates.map(toYoutubeIncomingComment),
              [],
            ),
          );

          if (
            commentsAfterRelayEnabled.length > 0 &&
            isYoutubeAutoReplyEnabledRef.current
          ) {
            setYoutubePendingComments((currentQueue) =>
              enqueueYouTubeComments(currentQueue, commentsAfterRelayEnabled),
            );
          }
        } else {
          const newMessages = relayCandidates.filter((message) => {
            if (youtubeSeenCommentIdsRef.current.has(message.id)) {
              return false;
            }

            rememberYouTubeCommentId(
              youtubeSeenCommentIdsRef.current,
              message.id,
            );
            return isFreshYouTubeComment(message.publishedAt);
          });

          if (newMessages.length > 0) {
            setYoutubeIncomingComments((currentComments) =>
              mergeIncomingComments(
                newMessages.map(toYoutubeIncomingComment),
                currentComments,
              ),
            );

            if (isYoutubeAutoReplyEnabledRef.current) {
              setYoutubePendingComments((currentQueue) =>
                enqueueYouTubeComments(currentQueue, newMessages),
              );
            }
          }
        }

        schedulePoll(
          response.pollingIntervalMillis || FALLBACK_YOUTUBE_POLL_INTERVAL_MS,
        );
      } catch (error) {
        if (isCancelled) {
          return;
        }

        if (isYoutubeAuthRejectedError(error)) {
          resetYoutubeSession(
            "YouTube sign-in expired or was revoked. Sign in with Google again.",
          );
          return;
        }

        setYoutubeReceiveState("error");
        setYoutubeReceiveError(userFacingMessage(error));
        schedulePoll(ERROR_YOUTUBE_POLL_INTERVAL_MS);
      }
    };

    void pollLiveComments();

    return () => {
      isCancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    getFreshYoutubeAccessToken,
    isYoutubeRelayMode,
    resetYoutubeSession,
    selectedYoutubeBroadcast?.channelId,
    selectedYoutubeBroadcast?.id,
    selectedYoutubeBroadcast?.liveChatId,
    youtubeAuthState,
  ]);

  useEffect(() => {
    if (
      !isYoutubeAutoReplyEnabled ||
      chatProcessingRef.current ||
      youtubeAutoReplyInFlightRef.current ||
      youtubePendingComments.length === 0
    ) {
      return;
    }

    const nextComment = youtubePendingComments[0];
    youtubeAutoReplyInFlightRef.current = true;

    void startChatTurn(createYouTubeRelayMessage(nextComment)).finally(() => {
      youtubeAutoReplyInFlightRef.current = false;
      setYoutubePendingComments((currentQueue) => currentQueue.slice(1));
    });
  }, [
    chatProcessing,
    isYoutubeAutoReplyEnabled,
    startChatTurn,
    youtubePendingComments,
  ]);

  const activeConversationLog =
    interactionMode === "podcast" ? podcastLog : chatLog;
  const inputPlaceholder =
    interactionMode === "podcast"
      ? "Type a podcast topic"
      : "Type a message";

  return (
    <div className="relative min-h-[100svh] font-M_PLUS_2">
      <Meta />
      {isYoutubeRelayMode || screenShareState === "active" ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-8 px-16">
          {isYoutubeRelayMode ? (
          <div
            className={`rounded-full border border-white/60 px-16 py-8 text-xs font-bold uppercase tracking-[0.24em] shadow-lg backdrop-blur ${
              youtubeReceiveState === "listening"
                ? "bg-emerald-500/90 text-white"
                : youtubeReceiveState === "error"
                  ? "bg-rose-500/90 text-white"
                  : "bg-white/80 text-[#6a466f]"
            }`}
            role="status"
            aria-live="polite"
          >
            {selectedYoutubeBroadcast
              ? `YouTube Relay - ${selectedYoutubeBroadcast.title}`
              : "YouTube Relay - Waiting for broadcast"}
          </div>
          ) : null}
          {screenShareState === "active" ? (
            <div className="rounded-full border border-white/60 bg-sky-500/90 px-16 py-8 text-xs font-bold uppercase tracking-[0.24em] text-white shadow-lg backdrop-blur">
              {`Screen Share To Gemini - C${screenShareStats.capturedFrameCount} / S${screenShareStats.streamedFrameCount}`}
            </div>
          ) : null}
        </div>
      ) : null}
      <Introduction
        geminiApiKey={geminiApiKey}
        onChangeGeminiApiKey={setGeminiApiKey}
      />
      {interactionMode === "podcast" ? (
        <PodcastStage
          participants={[podcastParticipants.yukito, podcastParticipants.kiyoka]}
          activeSpeakerId={activePodcastSpeakerId}
          onViewersReady={handlePodcastViewersReady}
          screenShareFrame={screenShareFrame}
        />
      ) : (
        <VrmViewer screenShareFrame={screenShareFrame} />
      )}
      <MessageInputContainer
        isChatProcessing={chatProcessing}
        isMicRecording={isMicRecording}
        isMicAvailable={
          interactionMode === "chat" ||
          (interactionMode === "podcast" && chatMicMode === "hands_free")
        }
        canStartMicWhileProcessing={
          interactionMode === "podcast" && chatMicMode === "hands_free"
        }
        placeholder={inputPlaceholder}
        onChatProcessStart={handleSendChat}
        onToggleMicRecording={handleToggleMicRecording}
      />
        <Menu
          geminiApiKey={geminiApiKey}
          geminiModel={geminiModel}
          geminiVoiceName={geminiVoiceName}
          chatMicMode={chatMicMode}
          interactionMode={interactionMode}
        screenShareState={screenShareState}
        screenShareError={screenShareError}
        screenShareSourceLabel={screenShareSourceLabel}
        screenShareStats={screenShareStats}
        podcastTurnCount={podcastTurnCount}
        podcastYukitoVoiceName={podcastYukitoVoiceName}
        podcastKiyokaVoiceName={podcastKiyokaVoiceName}
        selectedMotionId={selectedMotionId}
        systemPrompt={systemPrompt}
        chatLog={activeConversationLog}
        assistantMessage={assistantMessage}
        assistantStatus={assistantStatus}
        assistantSpeakerName={assistantSpeakerName}
          onChangeGeminiApiKey={setGeminiApiKey}
          onChangeGeminiModel={setGeminiModel}
          onChangeGeminiVoiceName={setGeminiVoiceName}
          onChangeChatMicMode={setChatMicMode}
          onChangeInteractionMode={setInteractionMode}
        onStartScreenShare={startScreenShare}
        onStopScreenShare={stopScreenShare}
        onChangePodcastTurnCount={(nextTurnCount) =>
          setPodcastTurnCount(clampPodcastTurnCount(nextTurnCount))
        }
        onChangePodcastYukitoVoiceName={setPodcastYukitoVoiceName}
        onChangePodcastKiyokaVoiceName={setPodcastKiyokaVoiceName}
        onChangeMotion={setSelectedMotionId}
        onChangeSystemPrompt={setSystemPrompt}
        onChangeChatLog={handleChangeChatLog}
        handleClickResetChatLog={() => {
          if (interactionMode === "podcast") {
            podcastTurnsRef.current = [];
            setPodcastLog([]);
            return;
          }

          setChatLog([]);
        }}
        handleClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
        youtubeSection={
          <YoutubeLiveControlDeck
            googleClientId={youtubeClientId}
            onGoogleClientIdChange={setYoutubeClientId}
            authState={youtubeAuthState}
            authError={youtubeAuthError}
            onSignIn={handleSignInToYoutube}
            onSignOut={handleSignOutFromYoutube}
            broadcastLoadState={youtubeBroadcastLoadState}
            broadcastError={youtubeBroadcastError}
            broadcasts={youtubeBroadcasts.map(toDeckYoutubeBroadcastSummary)}
            selectedBroadcastId={selectedYoutubeBroadcastId}
            onSelectBroadcast={(broadcast) =>
              handleSelectYoutubeBroadcast(broadcast)
            }
            onRefreshBroadcasts={handleRefreshYoutubeBroadcasts}
            isRelayModeEnabled={isYoutubeRelayMode}
            onToggleRelayMode={setIsYoutubeRelayMode}
            isAutoReplyEnabled={isYoutubeAutoReplyEnabled}
            onToggleAutoReply={setIsYoutubeAutoReplyEnabled}
            receiveState={youtubeReceiveState}
            receiveError={youtubeReceiveError}
            incomingComments={youtubeIncomingComments}
            onOpenStreamingHint={() =>
              window.open(
                "https://studio.youtube.com/",
                "_blank",
                "noopener,noreferrer",
              )
            }
          />
        }
      />
      <GitHubLink />
    </div>
  );
}

type YoutubeAuthSession = {
  clientId: string;
  token: YouTubeAuthToken;
};

function isYoutubeAuthUsable(
  token: YouTubeAuthToken | null,
): token is YouTubeAuthToken {
  return (
    !!token &&
    typeof token.accessToken === "string" &&
    token.accessToken.length > 0 &&
    typeof token.tokenType === "string" &&
    token.tokenType.length > 0 &&
    typeof token.scope === "string" &&
    token.scope.length > 0 &&
    typeof token.expiresAt === "number" &&
    Number.isFinite(token.expiresAt) &&
    token.expiresAt > Date.now() + YOUTUBE_AUTH_SESSION_LEEWAY_MS
  );
}

function isYoutubeAuthTokenUsable(token: YouTubeAuthToken): boolean {
  return (
    !!token &&
    typeof token.expiresAt === "number" &&
    Number.isFinite(token.expiresAt) &&
    token.expiresAt > Date.now() + YOUTUBE_AUTH_SESSION_LEEWAY_MS
  );
}

function isYoutubeAuthSessionValid(
  session: unknown,
): session is YoutubeAuthSession {
  if (!session || typeof session !== "object") {
    return false;
  }

  const candidate = session as {
    clientId?: unknown;
    token?: unknown;
  };

  if (
    typeof candidate.clientId !== "string" ||
    candidate.clientId.length <= 0
  ) {
    return false;
  }

  return isYoutubeAuthUsable(candidate.token as YouTubeAuthToken);
}

function parseYoutubeAuthSession(raw: string): YoutubeAuthSession | null {
  try {
    const session = JSON.parse(raw);
    return isYoutubeAuthSessionValid(session) ? session : null;
  } catch {
    return null;
  }
}

function saveYoutubeAuthSession(session: YoutubeAuthSession): void {
  window.localStorage.setItem(
    YOUTUBE_AUTH_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
}

function clearYoutubeAuthSession(): void {
  window.localStorage.removeItem(YOUTUBE_AUTH_SESSION_STORAGE_KEY);
}

function isYoutubeAuthRejectedError(error: unknown) {
  return (
    error instanceof YouTubeLiveError &&
    (error.code === "YOUTUBE_API_AUTH_ERROR" || error.httpStatus === 401)
  );
}

function createNeutralScreenplay(message: string): Screenplay {
  return {
    expression: "neutral",
    talk: {
      style: "talk",
      speakerX: DEFAULT_PARAM.speakerX,
      speakerY: DEFAULT_PARAM.speakerY,
      message,
    },
  };
}

function clampPodcastTurnCount(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DEFAULT_PODCAST_TURN_COUNT), 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_PODCAST_TURN_COUNT;
  }

  return Math.min(Math.max(parsed, 2), 12);
}

function resolveExternalVoiceName(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function buildRuntimePodcastParticipants({
  yukitoVoiceName,
  kiyokaVoiceName,
}: {
  yukitoVoiceName: string;
  kiyokaVoiceName: string;
}): Record<PodcastSpeakerId, PodcastParticipant> {
  return {
    yukito: {
      ...DEFAULT_PODCAST_PARTICIPANTS.yukito,
      voiceName:
        yukitoVoiceName.trim() || DEFAULT_PODCAST_PARTICIPANTS.yukito.voiceName,
    },
    kiyoka: {
      ...DEFAULT_PODCAST_PARTICIPANTS.kiyoka,
      voiceName:
        kiyokaVoiceName.trim() || DEFAULT_PODCAST_PARTICIPANTS.kiyoka.voiceName,
    },
  };
}

function postExternalControlResponse(
  event: MessageEvent<unknown>,
  response: GeminiVrmExternalControlResponseMessage,
): void {
  const messageSource = event.source;
  if (!messageSource) {
    return;
  }

  try {
    (messageSource as WindowProxy).postMessage(
      response,
      event.origin && event.origin !== "null" ? event.origin : "*",
    );
  } catch {
    // Ignore best-effort response failures for detached or cross-context sources.
  }
}

function compareYoutubeBroadcasts(
  left: YouTubeBroadcastSummary,
  right: YouTubeBroadcastSummary,
) {
  const rankDifference =
    getYoutubeBroadcastRank(left.lifecycleStatus) -
    getYoutubeBroadcastRank(right.lifecycleStatus);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  const leftTime = Date.parse(
    left.scheduledStartTime ?? left.actualStartTime ?? "",
  );
  const rightTime = Date.parse(
    right.scheduledStartTime ?? right.actualStartTime ?? "",
  );

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.title.localeCompare(right.title);
  }

  return leftTime - rightTime;
}

function getYoutubeBroadcastRank(lifecycleStatus: string | null) {
  switch (lifecycleStatus) {
    case "live":
    case "liveStarting":
    case "testing":
      return 0;
    case "ready":
    case "created":
    case "testStarting":
      return 1;
    case "complete":
    case "revoked":
      return 2;
    default:
      return 3;
  }
}

function compareYouTubeLiveChatMessages(
  left: YouTubeLiveChatMessage,
  right: YouTubeLiveChatMessage,
) {
  const leftTime = Date.parse(left.publishedAt);
  const rightTime = Date.parse(right.publishedAt);

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.id.localeCompare(right.id);
  }

  return leftTime - rightTime;
}

function toDeckYoutubeBroadcastSummary(
  broadcast: YouTubeBroadcastSummary,
): DeckYoutubeBroadcastSummary {
  return {
    id: broadcast.id,
    title: broadcast.title,
    state: getDeckYoutubeBroadcastState(broadcast.lifecycleStatus),
    liveChatId: broadcast.liveChatId,
    scheduledStartTime: formatYoutubeDate(
      broadcast.scheduledStartTime ?? broadcast.actualStartTime,
    ),
    viewerCount: undefined,
  };
}

function getDeckYoutubeBroadcastState(
  lifecycleStatus: string | null,
): YoutubeBroadcastState {
  switch (lifecycleStatus) {
    case "live":
    case "liveStarting":
    case "testing":
      return "active";
    case "ready":
    case "created":
    case "testStarting":
      return "upcoming";
    case "complete":
    case "revoked":
      return "completed";
    default:
      return "unknown";
  }
}

function formatYoutubeDate(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function isRelayCandidateMessage(
  message: YouTubeLiveChatMessage,
  broadcasterChannelId: string | null | undefined,
) {
  if (!message.text.trim()) {
    return false;
  }

  if (message.messageType && message.messageType !== "textMessageEvent") {
    return false;
  }

  if (
    broadcasterChannelId &&
    message.authorChannelId === broadcasterChannelId
  ) {
    return false;
  }

  return true;
}

function isFreshYouTubeComment(publishedAt: string) {
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  return Date.now() - timestamp <= YOUTUBE_COMMENT_FRESHNESS_MS;
}

function isCommentNewSinceRelayEnabled(
  publishedAt: string,
  relayStartedAt: number,
) {
  const publishedTimestamp = Date.parse(publishedAt);
  if (Number.isNaN(publishedTimestamp)) {
    return false;
  }

  return publishedTimestamp >= relayStartedAt - YOUTUBE_RELAY_PRIME_GRACE_MS;
}

function rememberYouTubeCommentId(seenIds: Set<string>, id: string) {
  seenIds.add(id);

  if (seenIds.size <= MAX_YOUTUBE_SEEN_IDS) {
    return;
  }

  const recentIds = Array.from(seenIds).slice(
    -Math.floor(MAX_YOUTUBE_SEEN_IDS / 2),
  );
  seenIds.clear();
  recentIds.forEach((recentId) => seenIds.add(recentId));
}

function mergeIncomingComments(
  nextComments: YoutubeIncomingComment[],
  currentComments: YoutubeIncomingComment[],
) {
  const commentMap = new Map<string, YoutubeIncomingComment>();

  [...nextComments, ...currentComments].forEach((comment) => {
    if (!commentMap.has(comment.id)) {
      commentMap.set(comment.id, comment);
    }
  });

  return Array.from(commentMap.values())
    .sort(
      (left, right) =>
        Date.parse(right.receivedAt || "") - Date.parse(left.receivedAt || ""),
    )
    .slice(0, MAX_YOUTUBE_PREVIEW_COMMENTS);
}

function enqueueYouTubeComments(
  currentQueue: YouTubeLiveChatMessage[],
  nextMessages: YouTubeLiveChatMessage[],
) {
  const queueMap = new Map<string, YouTubeLiveChatMessage>();

  [...currentQueue, ...nextMessages].forEach((message) => {
    if (!queueMap.has(message.id)) {
      queueMap.set(message.id, message);
    }
  });

  return Array.from(queueMap.values())
    .sort(compareYouTubeLiveChatMessages)
    .slice(-MAX_YOUTUBE_PENDING_COMMENTS);
}

function toYoutubeIncomingComment(
  message: YouTubeLiveChatMessage,
): YoutubeIncomingComment {
  return {
    id: message.id,
    author: message.authorDisplayName,
    comment: message.text,
    receivedAt: message.publishedAt,
  };
}

function createYouTubeRelayMessage(message: YouTubeLiveChatMessage): Message {
  return {
    role: "user",
    content: buildYouTubeRelayPrompt(message.authorDisplayName, message.text),
    displayContent: message.text,
    name: message.authorDisplayName,
    source: "youtube",
    externalId: message.id,
    receivedAt: message.publishedAt,
  };
}

function buildYouTubeRelayPrompt(author: string, text: string) {
  return `YouTube live chat comment from ${author}: ${text}`;
}

function updateEditableMessage(message: Message, nextText: string): Message {
  if (message.source === "youtube") {
    return {
      ...message,
      content: buildYouTubeRelayPrompt(message.name ?? "Viewer", nextText),
      displayContent: nextText,
    };
  }

  return {
    ...message,
    content: nextText,
    displayContent: undefined,
  };
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    if (track.readyState === "live") {
      track.stop();
    }
  });
}

function toMessageInputImage(
  frame: ScreenShareCaptureFrame | null | undefined,
  label?: string,
) {
  if (!frame) {
    return undefined;
  }

  return {
    byteLength: frame.byteLength,
    capturedAt: frame.capturedAt,
    dataUrl: toScreenShareFrameDataUrl(frame) ?? undefined,
    height: frame.height,
    label,
    mimeType: frame.mimeType,
    width: frame.width,
  };
}

function stripTransientMessageImageData(message: Message): Message {
  if (!message.inputImage?.dataUrl) {
    return message;
  }

  return {
    ...message,
    inputImage: {
      ...message.inputImage,
      dataUrl: undefined,
    },
  };
}
