import {
  ActivityHandling,
  GoogleGenAI,
  type LiveSendRealtimeInputParameters,
  MediaResolution,
  Modality,
  type LiveServerMessage,
  TurnCoverage,
} from "@google/genai";
import type { Message } from "../messages/messages";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_VOICE_NAME,
  resolveGeminiVoiceName,
} from "../chat/geminiLiveConfig";
import {
  hasActiveScreenShareSession,
  startScreenShareRelay,
  type GeminiLiveAudioChunk,
  type GeminiLiveTurnResult,
} from "../chat/geminiLiveChat";
import { createPcm16MonoNormalizer } from "../chat/pcmAudio";
import type { ScreenShareCaptureSession } from "../chat/screenShareCapture";

export type GeminiLiveAudioRelayResponse = GeminiLiveTurnResult & {
  inputTranscript: string;
};

type GeminiLiveAudioRelayParams = {
  apiKey: string;
  historyMessages: Message[];
  systemPrompt: string;
  historyTurnComplete?: boolean;
  relayAudioBytes: Uint8Array;
  relayAudioMimeType: string;
  model?: string;
  voiceName?: string;
  screenShareSession?: ScreenShareCaptureSession | null;
  onPartialTranscript?: (transcript: string) => void;
  onAudioChunk?: (chunk: GeminiLiveAudioChunk) => void;
};

export type GeminiLiveAudioRelaySession = {
  sendRelayAudioChunk: (audioBytes: Uint8Array, audioMimeType: string) => void;
  audioStreamEnd: () => Promise<GeminiLiveAudioRelayResponse>;
  close: (reason?: unknown) => void;
};

type GeminiLiveAudioRelaySessionParams = Omit<
  GeminiLiveAudioRelayParams,
  "relayAudioBytes" | "relayAudioMimeType"
>;

export async function createGeminiLiveAudioRelaySession(
  params: GeminiLiveAudioRelaySessionParams
): Promise<GeminiLiveAudioRelaySession> {
  const {
    apiKey,
    systemPrompt,
    model = DEFAULT_GEMINI_LIVE_MODEL,
    voiceName = DEFAULT_GEMINI_VOICE_NAME,
    screenShareSession,
    onPartialTranscript,
    onAudioChunk,
  } = params;

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
  const relayAudioNormalizer = createPcm16MonoNormalizer();
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  let stopScreenShareRelay: (() => Promise<void>) | undefined;
  let audioStreamEndResolve!: () => void;
  let audioStreamEndReject!: (error: Error) => void;
  let completion: Promise<GeminiLiveAudioRelayResponse> | undefined;
  const turnFinished = new Promise<void>((resolve, reject) => {
    audioStreamEndResolve = resolve;
    audioStreamEndReject = reject;
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

    audioStreamEndReject(
      error instanceof Error
        ? error
        : new Error(String(error ?? "Gemini Live audio relay failed."))
    );
  };

  const ensureSessionActive = () => {
    if (turnSettled) {
      throw new Error("Gemini Live audio relay session already completed.");
    }
    if (!session) {
      throw new Error("Gemini Live audio relay session is not ready yet.");
    }
  };

  const buildFailure = (error: unknown) =>
    new Error(
      error instanceof Error ? error.message : String(error ?? "Gemini Live error.")
    );
  const hasScreenShare =
    !!screenShareSession && hasActiveScreenShareSession(screenShareSession);

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
          }

          const nextOutputTranscript = getOutputTranscriptChunk(message);
          if (nextOutputTranscript) {
            outputTranscript += nextOutputTranscript;
            onPartialTranscript?.(outputTranscript);
          }

          if (message.serverContent?.turnComplete && !turnSettled) {
            turnSettled = true;
            audioStreamEndResolve();
          }
        } catch (error) {
          failTurn(error);
        }
      },
      onerror(event: ErrorEvent) {
        failTurn(new Error(event.message || "Gemini Live audio relay failed."));
      },
      onclose(event: CloseEvent) {
        failTurn(new Error(event.reason || "Gemini Live audio relay closed early."));
      },
      onopen() {
        // The session is ready once connect resolves.
      },
    },
    config: {
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
    },
  });

  if (hasScreenShare) {
    stopScreenShareRelay = await startScreenShareRelay(
      session,
      screenShareSession!,
    );
  }

  const normalizeAndSendRelayAudioChunk = (
    audioBytes: Uint8Array,
    audioMimeType: string
  ) => {
    if (turnSettled) {
      throw new Error("Gemini Live audio relay session already completed.");
    }

    const normalizedRelayAudio = relayAudioNormalizer.push(
      audioBytes,
      audioMimeType,
    );
    if (!normalizedRelayAudio || normalizedRelayAudio.data.byteLength === 0) {
      return;
    }
    if (!activityStarted) {
      activityStarted = true;
      session!.sendRealtimeInput({
        activityStart: {},
      });
    }
    const relayAudioBlob =
      {
        data: encodeBase64(normalizedRelayAudio.data),
        mimeType: normalizedRelayAudio.mimeType,
      } as NonNullable<LiveSendRealtimeInputParameters["audio"]>;

    session!.sendRealtimeInput({
      audio: relayAudioBlob,
    });
  };

  const finalize = async (): Promise<GeminiLiveAudioRelayResponse> => {
    if (completion) {
      return completion;
    }

    completion = (async () => {
        try {
        ensureSessionActive();
        const trailingRelayAudio = relayAudioNormalizer.flush();
        if (trailingRelayAudio && trailingRelayAudio.data.byteLength > 0) {
          if (!activityStarted) {
            activityStarted = true;
            session!.sendRealtimeInput({
              activityStart: {},
            });
          }
          const trailingRelayAudioBlob =
            {
              data: encodeBase64(trailingRelayAudio.data),
              mimeType: trailingRelayAudio.mimeType,
            } as NonNullable<LiveSendRealtimeInputParameters["audio"]>;

          session!.sendRealtimeInput({
            audio: trailingRelayAudioBlob,
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
        throw new Error("Gemini Live returned no audio for the podcast relay.");
      }

      return {
        transcript: outputTranscript.trim(),
        audioMimeType,
        audioBytes: concatenateAudioChunks(audioChunks),
        inputTranscript: inputTranscript.trim(),
      };
    })();

    return completion;
  };

  return {
    sendRelayAudioChunk: (audioBytes, audioMimeType) => {
      ensureSessionActive();
      normalizeAndSendRelayAudioChunk(audioBytes, audioMimeType);
    },
    audioStreamEnd: finalize,
    close: (reason?: unknown) => {
      if (turnSettled) {
        return;
      }
      failTurn(buildFailure(reason));
    },
  };
}

export async function getGeminiLiveAudioRelayResponse({
  apiKey,
  historyMessages,
  systemPrompt,
  relayAudioBytes,
  relayAudioMimeType,
  model = DEFAULT_GEMINI_LIVE_MODEL,
  voiceName = DEFAULT_GEMINI_VOICE_NAME,
  screenShareSession,
  onPartialTranscript,
  onAudioChunk,
}: GeminiLiveAudioRelayParams): Promise<GeminiLiveAudioRelayResponse> {
  const session = await createGeminiLiveAudioRelaySession({
    apiKey,
    historyMessages,
    model,
    systemPrompt,
    voiceName,
    screenShareSession,
    onAudioChunk,
    onPartialTranscript,
  });

  session.sendRelayAudioChunk(relayAudioBytes, relayAudioMimeType);

  const response = await session.audioStreamEnd();

  return {
    ...response,
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
