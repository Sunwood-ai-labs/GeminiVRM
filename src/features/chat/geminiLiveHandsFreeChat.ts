import {
  type Content,
  GoogleGenAI,
  MediaResolution,
  Modality,
  type Part,
  type LiveServerMessage,
} from "@google/genai";
import type { Message } from "../messages/messages";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_VOICE_NAME,
  resolveGeminiVoiceName,
} from "./geminiLiveConfig";
import {
  hasActiveScreenShareSession,
  startScreenShareRelay,
} from "./geminiLiveChat";
import { createPcm16MonoNormalizer } from "./pcmAudio";
import type { ScreenShareCaptureSession } from "./screenShareCapture";

export type GeminiLiveHandsFreeAudioChunk = {
  data: Uint8Array;
  mimeType: string;
};

export type GeminiLiveHandsFreeTurn = {
  inputTranscript: string;
  transcript: string;
};

export type GeminiLiveHandsFreeSession = {
  sendUserAudioChunk: (audioBytes: Uint8Array, audioMimeType: string) => void;
  close: (reason?: unknown) => Promise<void>;
};

type CreateGeminiLiveHandsFreeSessionParams = {
  apiKey: string;
  historyMessages: Message[];
  systemPrompt: string;
  model?: string;
  voiceName?: string;
  screenShareSession?: ScreenShareCaptureSession | null;
  onInputTranscript?: (transcript: string) => void;
  onOutputTranscript?: (transcript: string) => void;
  onAudioChunk?: (chunk: GeminiLiveHandsFreeAudioChunk) => void;
  onTurnComplete?: (turn: GeminiLiveHandsFreeTurn) => void;
  onInterrupted?: () => void;
  onError?: (error: Error) => void;
};

export async function createGeminiLiveHandsFreeSession({
  apiKey,
  historyMessages,
  systemPrompt,
  model = DEFAULT_GEMINI_LIVE_MODEL,
  voiceName = DEFAULT_GEMINI_VOICE_NAME,
  screenShareSession,
  onInputTranscript,
  onOutputTranscript,
  onAudioChunk,
  onTurnComplete,
  onInterrupted,
  onError,
}: CreateGeminiLiveHandsFreeSessionParams): Promise<GeminiLiveHandsFreeSession> {
  if (!apiKey) {
    throw new Error("Gemini API key is required.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: "v1alpha",
  });

  const resolvedVoiceName = resolveGeminiVoiceName(voiceName);
  const historyTurns = buildHistoryTurns(historyMessages);
  const hasScreenShare =
    !!screenShareSession && hasActiveScreenShareSession(screenShareSession);
  const audioNormalizer = createPcm16MonoNormalizer();
  const sessionConfig = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
      },
    },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: resolvedVoiceName,
        },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: prependScreenShareSystemInstruction(
      systemPrompt,
      hasScreenShare,
    ),
    historyConfig: {
      initialHistoryInClientContent: historyTurns.length > 0,
    },
  };
  let inputTranscript = "";
  let outputTranscript = "";
  let turnSettled = false;
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  let stopScreenShareRelay: (() => Promise<void>) | undefined;
  let closePromise: Promise<void> | undefined;

  const failTurn = (error: unknown) => {
    if (turnSettled) {
      return;
    }

    turnSettled = true;
    const resolvedError =
      error instanceof Error
        ? error
        : new Error(String(error ?? "Gemini Live hands-free chat failed."));
    void stopScreenShareRelay?.().catch(() => {});
    stopScreenShareRelay = undefined;
    try {
      session?.close();
    } catch {
      // Ignore best-effort close failures after a streaming error.
    }
    onError?.(resolvedError);
  };

  session = await ai.live.connect({
    model,
    callbacks: {
      onmessage(message: LiveServerMessage) {
        try {
          collectAudio(message, (chunk) => {
            onAudioChunk?.(chunk);
          });

          const nextInputTranscript = getInputTranscriptChunk(message);
          if (nextInputTranscript) {
            inputTranscript += nextInputTranscript;
            onInputTranscript?.(inputTranscript);
          }

          const nextOutputTranscript = getOutputTranscriptChunk(message);
          if (nextOutputTranscript) {
            outputTranscript += nextOutputTranscript;
            onOutputTranscript?.(outputTranscript);
          }

          if (message.serverContent?.interrupted) {
            outputTranscript = "";
            onInterrupted?.();
          }

          if (message.serverContent?.turnComplete) {
            const completedTurn = {
              inputTranscript: inputTranscript.trim(),
              transcript: outputTranscript.trim(),
            };
            if (completedTurn.inputTranscript || completedTurn.transcript) {
              onTurnComplete?.(completedTurn);
            }
            inputTranscript = "";
            outputTranscript = "";
          }
        } catch (error) {
          failTurn(error);
        }
      },
      onerror(event: ErrorEvent) {
        failTurn(new Error(event.message || "Gemini Live hands-free chat failed."));
      },
      onclose(event: CloseEvent) {
        if (turnSettled) {
          return;
        }

        failTurn(
          new Error(event.reason || "Gemini Live hands-free chat closed early."),
        );
      },
      onopen() {
        // The session is ready once connect resolves.
      },
    },
    config: sessionConfig,
  });

  if (historyTurns.length > 0) {
    session.sendClientContent({
      turns: historyTurns,
      turnComplete: false,
    });
  }

  if (hasScreenShare) {
    stopScreenShareRelay = await startScreenShareRelay(session, screenShareSession!);
  }

  return {
    sendUserAudioChunk: (audioBytes, audioMimeType) => {
      if (turnSettled) {
        return;
      }

      const normalizedAudio = audioNormalizer.push(audioBytes, audioMimeType);
      if (normalizedAudio.data.byteLength === 0) {
        return;
      }

      session!.sendRealtimeInput({
        audio: {
          data: encodeBase64(normalizedAudio.data),
          mimeType: normalizedAudio.mimeType,
        },
      });
    },
    close: async (reason?: unknown) => {
      if (closePromise) {
        return closePromise;
      }

      closePromise = (async () => {
        if (turnSettled) {
          return;
        }

        turnSettled = true;

        const trailingAudio = audioNormalizer.flush();
        if (trailingAudio.data.byteLength > 0) {
          session!.sendRealtimeInput({
            audio: {
              data: encodeBase64(trailingAudio.data),
              mimeType: trailingAudio.mimeType,
            },
          });
        }

        try {
          session!.close();
        } catch {
          // Ignore best-effort close failures after a manual shutdown.
        }

        await stopScreenShareRelay?.().catch(() => {});
        stopScreenShareRelay = undefined;

        if (reason instanceof Error) {
          throw reason;
        }
      })();

      return closePromise;
    },
  };
}

function buildHistoryTurns(messages: Message[]): Content[] {
  return messages
    .filter((message) => message.role !== "system")
    .reduce<Content[]>((turns, message) => {
      const parts = buildMessageParts(message);
      if (parts.length === 0) {
        return turns;
      }

      turns.push({
        role: message.role === "assistant" ? "model" : "user",
        parts,
      });
      return turns;
    }, []);
}

function buildMessageParts(message: Message): Part[] {
  const parts: Part[] = [];
  const text = (message.displayContent ?? message.content).trim();
  if (text) {
    parts.push({ text });
  }

  const inputImage = message.inputImage;
  if (inputImage?.dataUrl) {
    const data = extractBase64Data(inputImage.dataUrl);
    if (data) {
      parts.push({
        inlineData: {
          data,
          mimeType: inputImage.mimeType,
        },
      });
    }
  }

  return parts;
}

function collectAudio(
  message: LiveServerMessage,
  onAudioChunk: (chunk: GeminiLiveHandsFreeAudioChunk) => void,
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

function getInputTranscriptChunk(message: LiveServerMessage): string {
  return message.serverContent?.inputTranscription?.text ?? "";
}

function getOutputTranscriptChunk(message: LiveServerMessage): string {
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

function encodeBase64(data: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < data.byteLength; index += 1) {
    binary += String.fromCharCode(data[index]);
  }

  return window.btoa(binary);
}

function prependScreenShareSystemInstruction(
  instruction: string,
  hasScreenShare: boolean,
): string {
  if (!hasScreenShare) {
    return instruction;
  }

  return [
    instruction,
    "",
    "The user is also sharing live screen frames for this turn.",
    "Treat the shared screen as primary context when it is relevant to the request.",
    "Before the main answer, mention one concrete visible detail from the shared screen when possible so the user knows the visual input reached you.",
  ].join("\n");
}

function extractBase64Data(dataUrl: string): string {
  const separatorIndex = dataUrl.indexOf(",");
  if (separatorIndex < 0) {
    return "";
  }

  return dataUrl.slice(separatorIndex + 1);
}
