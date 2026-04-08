import {
  GoogleGenAI,
  type LiveSendRealtimeInputParameters,
  MediaResolution,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import type { Message } from "../messages/messages";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_VOICE_NAME,
  resolveGeminiVoiceName,
} from "./geminiLiveConfig";
import type {
  ScreenShareCaptureFrame,
  ScreenShareCaptureSession,
} from "./screenShareCapture";

export type GeminiLiveTurnResult = {
  transcript: string;
  audioMimeType: string;
  audioBytes: Uint8Array;
};

export type GeminiLiveChatResponse = GeminiLiveTurnResult;

export type GeminiLiveAudioChunk = {
  data: Uint8Array;
  mimeType: string;
};

type GeminiLiveChatParams = {
  apiKey: string;
  messages: Message[];
  systemPrompt: string;
  model?: string;
  voiceName?: string;
  screenShareSession?: ScreenShareCaptureSession | null;
  onPartialTranscript?: (transcript: string) => void;
  onAudioChunk?: (chunk: GeminiLiveAudioChunk) => void;
};

export async function getGeminiLiveChatResponse({
  apiKey,
  messages,
  systemPrompt,
  model = DEFAULT_GEMINI_LIVE_MODEL,
  voiceName = DEFAULT_GEMINI_VOICE_NAME,
  screenShareSession,
  onPartialTranscript,
  onAudioChunk,
}: GeminiLiveChatParams): Promise<GeminiLiveChatResponse> {
  if (!apiKey) {
    throw new Error("Gemini API key is required.");
  }

  return runGeminiLiveChat({
    apiKey,
    messages,
    model,
    onAudioChunk,
    onPartialTranscript,
    screenShareSession,
    systemPrompt,
    voiceName,
  });
}

async function runGeminiLiveChat({
  apiKey,
  messages,
  systemPrompt,
  model,
  voiceName,
  screenShareSession,
  onAudioChunk,
  onPartialTranscript,
}: Required<
  Pick<
    GeminiLiveChatParams,
    "apiKey" | "messages" | "systemPrompt" | "model" | "voiceName"
  >
> &
  Pick<GeminiLiveChatParams, "onAudioChunk" | "onPartialTranscript"> & {
    screenShareSession?: ScreenShareCaptureSession | null;
  }
): Promise<GeminiLiveChatResponse> {
  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: "v1alpha",
  });

  let audioMimeType = "";
  let transcript = "";
  let turnSettled = false;
  let hasReceivedAudio = false;
  const audioChunks: Uint8Array[] = [];
  const resolvedVoiceName = resolveGeminiVoiceName(voiceName);
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  let stopScreenShareRelay: (() => Promise<void>) | undefined;

  let resolveTurn!: () => void;
  let rejectTurn!: (error: Error) => void;
  const turnFinished = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });

  const failTurn = (error: unknown) => {
    if (turnSettled) {
      return;
    }

    turnSettled = true;
    try {
      session?.close();
    } catch {
      // Ignore best-effort close failures after a streaming error.
    }

    rejectTurn(
      error instanceof Error
        ? error
        : new Error(String(error ?? "Gemini Live connection failed."))
    );
  };

  session = await ai.live.connect({
    model,
    callbacks: {
      onmessage(message: LiveServerMessage) {
        try {
          collectAudio(message, ({ data, mimeType }) => {
            const resolvedMimeType = mimeType || audioMimeType;

            hasReceivedAudio = true;
            audioChunks.push(data);
            if (!audioMimeType && resolvedMimeType) {
              audioMimeType = resolvedMimeType;
            }

            onAudioChunk?.({
              data,
              mimeType: resolvedMimeType,
            });
          });

          const nextTranscript = getTranscriptChunk(message);
          if (nextTranscript) {
            transcript += nextTranscript;
            onPartialTranscript?.(transcript);
          }

          if (message.serverContent?.turnComplete && !turnSettled) {
            turnSettled = true;
            resolveTurn();
          }
        } catch (error) {
          failTurn(error);
        }
      },
      onerror(event: ErrorEvent) {
        failTurn(new Error(event.message || "Gemini Live connection failed."));
      },
      onclose(event: CloseEvent) {
        failTurn(new Error(event.reason || "Gemini Live connection closed early."));
      },
      onopen() {
        // The session is ready once connect resolves.
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: resolvedVoiceName,
          },
        },
      },
      outputAudioTranscription: {},
      systemInstruction: systemPrompt,
    },
  });

  try {
    if (screenShareSession && hasActiveScreenShareSession(screenShareSession)) {
      stopScreenShareRelay = await startScreenShareRelay(
        session,
        screenShareSession,
      );
    }

    session.sendRealtimeInput({
      text: buildRealtimeTextInput(messages, Boolean(stopScreenShareRelay)),
    });

    await turnFinished;
  } finally {
    await stopScreenShareRelay?.();
    session.close();
  }

  if (!hasReceivedAudio || !audioMimeType) {
    throw new Error("Gemini Live returned no audio.");
  }

  return {
    transcript: transcript.trim(),
    audioMimeType,
    audioBytes: concatenateAudioChunks(audioChunks),
  };
}

function collectAudio(
  message: LiveServerMessage,
  onAudioChunk: (chunk: GeminiLiveAudioChunk) => void
) {
  const parts = message.serverContent?.modelTurn?.parts;
  if (!parts?.length) {
    return;
  }

  for (const part of parts) {
    if (!part.inlineData?.data) {
      continue;
    }

    onAudioChunk({
      data: decodeBase64(part.inlineData.data),
      mimeType: part.inlineData.mimeType ?? "",
    });
  }
}

function getTranscriptChunk(message: LiveServerMessage): string {
  return message.serverContent?.outputTranscription?.text ?? "";
}

function decodeBase64(data: string): Uint8Array {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function concatenateAudioChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function buildRealtimeTextInput(
  messages: Message[],
  hasScreenShare = false,
): string {
  const conversationalMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const latestMessage = conversationalMessages.at(-1);

  if (!latestMessage) {
    throw new Error("Gemini Live requires at least one user message.");
  }

  if (conversationalMessages.length === 1) {
    return prependScreenShareContext(latestMessage.content, hasScreenShare);
  }

  const history = conversationalMessages
    .slice(0, -1)
    .map((message) => `${getRealtimeSpeakerLabel(message)}: ${message.content}`)
    .join("\n");

  return prependScreenShareContext(
    [
      "Conversation so far:",
      history,
      "",
      "Latest user message:",
      latestMessage.content,
    ].join("\n"),
    hasScreenShare,
  );
}

function prependScreenShareContext(text: string, hasScreenShare: boolean): string {
  if (!hasScreenShare) {
    return text;
  }

  return [
    "The user is also sharing live screen frames for this turn.",
    "Treat the shared screen as primary context when it is relevant to the request.",
    "Before the main answer, mention one concrete visible detail from the shared screen when possible so the user knows the visual input reached you.",
    "",
    text,
  ].join("\n");
}

function getRealtimeSpeakerLabel(message: Message): string {
  if (message.role === "assistant") {
    return message.name?.trim() || "Assistant";
  }

  return message.name?.trim() || "User";
}

export type GeminiLiveVideoSession = {
  sendRealtimeInput: (params: LiveSendRealtimeInputParameters) => void;
};

export async function startScreenShareRelay(
  session: GeminiLiveVideoSession,
  screenShareSession: ScreenShareCaptureSession,
): Promise<() => Promise<void>> {
  const latestFrame = screenShareSession.getLatestFrame();
  if (latestFrame) {
    sendScreenShareFrame(session, screenShareSession, latestFrame);
  }

  const unsubscribe = screenShareSession.subscribe((frame) => {
    sendScreenShareFrame(session, screenShareSession, frame);
  });

  return async () => {
    unsubscribe();
  };
}

export function hasActiveScreenShareSession(
  screenShareSession: ScreenShareCaptureSession,
): boolean {
  return screenShareSession.stream
    .getVideoTracks()
    .some((track) => track.readyState === "live");
}

function sendScreenShareFrame(
  session: GeminiLiveVideoSession,
  screenShareSession: ScreenShareCaptureSession,
  frame: ScreenShareCaptureFrame,
): void {
  const video = {
    data: frame.data,
    mimeType: frame.mimeType,
  } as NonNullable<LiveSendRealtimeInputParameters["video"]>;

  session.sendRealtimeInput({
    video,
  });
  screenShareSession.markFrameStreamed();
}
