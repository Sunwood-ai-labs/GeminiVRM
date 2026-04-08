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
  screenShareStream?: MediaStream | null;
  onPartialTranscript?: (transcript: string) => void;
  onAudioChunk?: (chunk: GeminiLiveAudioChunk) => void;
};

export async function getGeminiLiveChatResponse({
  apiKey,
  messages,
  systemPrompt,
  model = DEFAULT_GEMINI_LIVE_MODEL,
  voiceName = DEFAULT_GEMINI_VOICE_NAME,
  screenShareStream,
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
    screenShareStream,
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
  screenShareStream,
  onAudioChunk,
  onPartialTranscript,
}: Required<
  Pick<
    GeminiLiveChatParams,
    "apiKey" | "messages" | "systemPrompt" | "model" | "voiceName"
  >
> &
  Pick<GeminiLiveChatParams, "onAudioChunk" | "onPartialTranscript"> & {
    screenShareStream?: MediaStream | null;
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
    if (screenShareStream && hasActiveScreenShareTrack(screenShareStream)) {
      stopScreenShareRelay = await startScreenShareRelay(
        session,
        screenShareStream,
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
    "Use that visual context when it is relevant.",
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
  screenShareStream: MediaStream,
): Promise<() => Promise<void>> {
  const videoTrack = screenShareStream
    .getVideoTracks()
    .find((track) => track.readyState === "live");

  if (!videoTrack) {
    throw new Error("Screen share video track is not active.");
  }

  const relayStream = new MediaStream([videoTrack]);
  const videoElement = document.createElement("video");
  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.srcObject = relayStream;

  const frameCanvas = document.createElement("canvas");
  const abortController = new AbortController();

  await waitForScreenShareVideo(videoElement);
  await sendScreenShareFrame(session, videoElement, frameCanvas);

  const loopPromise = streamScreenShareFrames({
    abortSignal: abortController.signal,
    canvas: frameCanvas,
    session,
    videoElement,
    videoTrack,
  });

  return async () => {
    abortController.abort();

    try {
      await loopPromise;
    } catch {
      // Ignore best-effort frame loop shutdown failures.
    }

    videoElement.pause();
    videoElement.srcObject = null;
  };
}

export function hasActiveScreenShareTrack(stream: MediaStream): boolean {
  return stream
    .getVideoTracks()
    .some((track) => track.readyState === "live");
}

async function streamScreenShareFrames({
  abortSignal,
  canvas,
  session,
  videoElement,
  videoTrack,
}: {
  abortSignal: AbortSignal;
  canvas: HTMLCanvasElement;
  session: GeminiLiveVideoSession;
  videoElement: HTMLVideoElement;
  videoTrack: MediaStreamTrack;
}): Promise<void> {
  while (!abortSignal.aborted && videoTrack.readyState === "live") {
    await waitForNextVideoFrame(abortSignal, 1000);
    if (abortSignal.aborted || videoTrack.readyState !== "live") {
      break;
    }

    await sendScreenShareFrame(session, videoElement, canvas);
  }
}

async function waitForScreenShareVideo(videoElement: HTMLVideoElement): Promise<void> {
  try {
    await videoElement.play();
  } catch {
    // Muted display-media playback can still produce frames without autoplay.
  }

  if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Screen share video stream did not become ready."));
    }, 4000);

    const handleLoadedMetadata = () => {
      if (videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
        return;
      }

      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Screen share video stream could not be read."));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("loadeddata", handleLoadedMetadata);
      videoElement.removeEventListener("error", handleError);
    };

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("loadeddata", handleLoadedMetadata);
    videoElement.addEventListener("error", handleError);
  });
}

async function sendScreenShareFrame(
  session: GeminiLiveVideoSession,
  videoElement: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;

  if (width <= 0 || height <= 0) {
    throw new Error("Screen share frame is not ready yet.");
  }

  const { scaledHeight, scaledWidth } = fitScreenShareFrame(width, height);
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable for screen sharing.");
  }

  context.drawImage(videoElement, 0, 0, scaledWidth, scaledHeight);

  const frameBlob = await canvasToJpegBlob(canvas);
  const frameBytes = new Uint8Array(await frameBlob.arrayBuffer());
  const video = {
    data: encodeBase64(frameBytes),
    mimeType: frameBlob.type || "image/jpeg",
  } as NonNullable<LiveSendRealtimeInputParameters["video"]>;

  session.sendRealtimeInput({
    video,
  });
}

function fitScreenShareFrame(width: number, height: number) {
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(width, height));

  return {
    scaledWidth: Math.max(1, Math.round(width * scale)),
    scaledHeight: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode the screen share frame."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      0.85,
    );
  });
}

function waitForNextVideoFrame(
  abortSignal: AbortSignal,
  delayMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      resolve();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      abortSignal.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      cleanup();
      resolve();
    };

    abortSignal.addEventListener("abort", handleAbort, { once: true });
  });
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < data.byteLength; index += 1) {
    binary += String.fromCharCode(data[index]);
  }

  return window.btoa(binary);
}
