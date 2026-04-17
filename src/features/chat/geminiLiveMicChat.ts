import {
  ActivityHandling,
  type Content,
  GoogleGenAI,
  MediaResolution,
  Modality,
  type Part,
  TurnCoverage,
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

export type GeminiLiveMicChatResponse = {
  inputTranscript: string;
  transcript: string;
  audioMimeType: string;
  audioBytes: Uint8Array;
};

export type GeminiLiveMicAudioChunk = {
  data: Uint8Array;
  mimeType: string;
};

export type GeminiLiveMicChatSession = {
  sendUserAudioChunk: (audioBytes: Uint8Array, audioMimeType: string) => void;
  finishUserAudio: () => Promise<GeminiLiveMicChatResponse>;
  close: (reason?: unknown) => void;
};

type CreateGeminiLiveMicChatSessionParams = {
  apiKey: string;
  historyMessages: Message[];
  systemPrompt: string;
  model?: string;
  voiceName?: string;
  screenShareSession?: ScreenShareCaptureSession | null;
  onInputTranscript?: (transcript: string) => void;
  onOutputTranscript?: (transcript: string) => void;
  onAudioChunk?: (chunk: GeminiLiveMicAudioChunk) => void;
};

export async function createGeminiLiveMicChatSession({
  apiKey,
  historyMessages,
  systemPrompt,
  model = DEFAULT_GEMINI_LIVE_MODEL,
  voiceName = DEFAULT_GEMINI_VOICE_NAME,
  screenShareSession,
  onInputTranscript,
  onOutputTranscript,
  onAudioChunk,
}: CreateGeminiLiveMicChatSessionParams): Promise<GeminiLiveMicChatSession> {
  if (!apiKey) {
    throw new Error("Gemini API key is required.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: "v1alpha",
  });

  let audioMimeType = "";
  let outputTranscript = "";
  let inputTranscript = "";
  let turnSettled = false;
  let hasReceivedAudio = false;
  let activityStarted = false;
  let activityEnded = false;
  const audioChunks: Uint8Array[] = [];
  const resolvedVoiceName = resolveGeminiVoiceName(voiceName);
  const audioNormalizer = createPcm16MonoNormalizer();
  const historyTurns = buildHistoryTurns(historyMessages);
  const hasScreenShare =
    !!screenShareSession && hasActiveScreenShareSession(screenShareSession);
  const sessionConfig = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: true,
      },
      activityHandling: ActivityHandling.NO_INTERRUPTION,
      turnCoverage:
        hasScreenShare
          ? TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO
          : TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
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
    // Official docs require this flag when Gemini 3.1 Live seeds history via sendClientContent.
    historyConfig: {
      initialHistoryInClientContent: historyTurns.length > 0,
    },
  };
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  let stopScreenShareRelay: (() => Promise<void>) | undefined;
  let resolveTurn!: () => void;
  let rejectTurn!: (error: Error) => void;
  let completion: Promise<GeminiLiveMicChatResponse> | undefined;
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
        : new Error(String(error ?? "Gemini Live microphone chat failed.")),
    );
  };

  const ensureSessionActive = () => {
    if (turnSettled) {
      throw new Error("Gemini Live microphone chat is already completed.");
    }

    if (!session) {
      throw new Error("Gemini Live microphone chat is not ready yet.");
    }
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

          if (message.serverContent?.turnComplete && !turnSettled) {
            turnSettled = true;
            resolveTurn();
          }
        } catch (error) {
          failTurn(error);
        }
      },
      onerror(event: ErrorEvent) {
        failTurn(new Error(event.message || "Gemini Live microphone chat failed."));
      },
      onclose(event: CloseEvent) {
        failTurn(
          new Error(event.reason || "Gemini Live microphone chat closed early."),
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
      ensureSessionActive();

      const normalizedAudio = audioNormalizer.push(audioBytes, audioMimeType);
      if (normalizedAudio.data.byteLength === 0) {
        return;
      }

      if (!activityStarted) {
        activityStarted = true;
        session!.sendRealtimeInput({
          activityStart: {},
        });
      }

      session!.sendRealtimeInput({
        audio: {
          data: encodeBase64(normalizedAudio.data),
          mimeType: normalizedAudio.mimeType,
        },
      });
    },
    finishUserAudio: async () => {
      if (completion) {
        return completion;
      }

      completion = (async () => {
        try {
          ensureSessionActive();

          const trailingAudio = audioNormalizer.flush();
          if (trailingAudio.data.byteLength > 0) {
            if (!activityStarted) {
              activityStarted = true;
              session!.sendRealtimeInput({
                activityStart: {},
              });
            }

            session!.sendRealtimeInput({
              audio: {
                data: encodeBase64(trailingAudio.data),
                mimeType: trailingAudio.mimeType,
              },
            });
          }

          if (activityStarted && !activityEnded) {
            activityEnded = true;
            session!.sendRealtimeInput({
              activityEnd: {},
            });
          }

          await turnFinished;
        } finally {
          await stopScreenShareRelay?.();
          try {
            session?.close();
          } catch {
            // Ignore best-effort close failures after stream end.
          }
        }

        if (!hasReceivedAudio || !audioMimeType) {
          throw new Error("Gemini Live returned no audio for the microphone turn.");
        }

        return {
          inputTranscript: inputTranscript.trim(),
          transcript: outputTranscript.trim(),
          audioMimeType,
          audioBytes: concatenateAudioChunks(audioChunks),
        };
      })();

      return completion;
    },
    close: (reason?: unknown) => {
      if (turnSettled) {
        return;
      }

      failTurn(
        reason instanceof Error
          ? reason
          : new Error(String(reason ?? "Gemini Live microphone chat stopped.")),
      );
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
  onAudioChunk: (chunk: GeminiLiveMicAudioChunk) => void,
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
