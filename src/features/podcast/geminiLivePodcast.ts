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
  hasActiveScreenShareTrack,
  startScreenShareRelay,
  type GeminiLiveAudioChunk,
  type GeminiLiveTurnResult,
} from "../chat/geminiLiveChat";

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
  screenShareStream?: MediaStream | null;
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
    screenShareStream,
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
  let streamEndSignaled = false;
  let activityStarted = false;
  let activityEnded = false;
  const audioChunks: Uint8Array[] = [];
  const resolvedVoiceName = resolveGeminiVoiceName(voiceName);
  const relayAudioNormalizer = createRelayAudioStreamNormalizer();
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
          screenShareStream && hasActiveScreenShareTrack(screenShareStream)
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
      systemInstruction: systemPrompt,
    },
  });

  if (screenShareStream && hasActiveScreenShareTrack(screenShareStream)) {
    stopScreenShareRelay = await startScreenShareRelay(session, screenShareStream);
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
        if (!streamEndSignaled) {
          streamEndSignaled = true;
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
          session!.sendRealtimeInput({ audioStreamEnd: true });
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
  screenShareStream,
  onPartialTranscript,
  onAudioChunk,
}: GeminiLiveAudioRelayParams): Promise<GeminiLiveAudioRelayResponse> {
  const session = await createGeminiLiveAudioRelaySession({
    apiKey,
    historyMessages,
    model,
    systemPrompt,
    voiceName,
    screenShareStream,
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

function createRelayAudioStreamNormalizer() {
  const outputMimeType = "audio/pcm;rate=16000";
  const defaultInputMimeType = "audio/pcm;rate=24000";

  let format:
    | {
        sampleRate: number;
        channels: number;
        bitsPerSample: number;
      }
    | undefined;
  let pendingBytes = new Uint8Array(0);
  let sampleOffset = 0;
  let nextSourcePosition = 0;
  const pendingSamples: number[] = [];

  const resolveFormat = (mimeType?: string) => {
    const normalizedMimeType = (mimeType || defaultInputMimeType).toLowerCase();
    const nextFormat = {
      sampleRate: getSampleRate(normalizedMimeType),
      channels: getChannels(normalizedMimeType),
      bitsPerSample: getBitsPerSample(normalizedMimeType),
    };

    if (nextFormat.channels !== 1) {
      throw new Error(
        `Unsupported Gemini Live relay format "${normalizedMimeType}". Expected mono audio.`,
      );
    }

    if (nextFormat.bitsPerSample !== 16) {
      throw new Error(
        `Unsupported Gemini Live relay format "${normalizedMimeType}". Expected 16-bit PCM.`,
      );
    }

    if (
      format &&
      (format.sampleRate !== nextFormat.sampleRate ||
        format.channels !== nextFormat.channels ||
        format.bitsPerSample !== nextFormat.bitsPerSample)
    ) {
      throw new Error("Gemini Live changed relay audio formats mid-stream.");
    }

    format = nextFormat;
    return nextFormat;
  };

  const appendSamples = (data: Uint8Array) => {
    for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
      const value = (data[offset] | (data[offset + 1] << 8)) << 16 >> 16;
      pendingSamples.push(value);
    }
  };

  const drainResampledAudio = (finalChunk: boolean) => {
    if (!format || pendingSamples.length === 0) {
      return new Uint8Array(0);
    }

    const outputSamples: number[] = [];
    const availableSamples = sampleOffset + pendingSamples.length;
    const sourceStep = format.sampleRate / 16000;
    const maxPositionExclusive = finalChunk
      ? availableSamples
      : availableSamples - 1;

    while (nextSourcePosition < maxPositionExclusive) {
      const leftAbsoluteIndex = Math.floor(nextSourcePosition);
      const leftQueueIndex = leftAbsoluteIndex - sampleOffset;
      if (leftQueueIndex < 0 || leftQueueIndex >= pendingSamples.length) {
        break;
      }

      const rightQueueIndex = Math.min(
        leftQueueIndex + 1,
        pendingSamples.length - 1,
      );
      const leftSample = pendingSamples[leftQueueIndex];
      const rightSample = pendingSamples[rightQueueIndex] ?? leftSample;
      const blend = nextSourcePosition - leftAbsoluteIndex;
      outputSamples.push(
        Math.round(leftSample * (1 - blend) + rightSample * blend),
      );
      nextSourcePosition += sourceStep;
    }

    const discardAbsoluteIndex = Math.max(
      sampleOffset,
      Math.floor(nextSourcePosition) - 1,
    );
    const discardCount = discardAbsoluteIndex - sampleOffset;
    if (discardCount > 0) {
      pendingSamples.splice(0, discardCount);
      sampleOffset = discardAbsoluteIndex;
    }

    return encodeInt16Samples(outputSamples);
  };

  const normalizeChunk = (
    data: Uint8Array,
    mimeType?: string,
    finalChunk = false,
  ): { data: Uint8Array; mimeType: string } => {
    const nextFormat = resolveFormat(mimeType);
    const bytesPerFrame = Math.max(
      (nextFormat.bitsPerSample / 8) * nextFormat.channels,
      1,
    );
    const merged = concatenateAudioChunks([pendingBytes, data]);
    const completeLength = merged.byteLength - (merged.byteLength % bytesPerFrame);
    const completeBytes = merged.slice(0, completeLength);
    pendingBytes = merged.slice(completeLength);

    if (nextFormat.sampleRate === 16000) {
      if (finalChunk && pendingBytes.byteLength > 0) {
        const paddedPendingBytes = padBytesToFrame(pendingBytes, bytesPerFrame);
        const padded = new Uint8Array(
          completeBytes.byteLength + paddedPendingBytes.byteLength,
        );
        padded.set(completeBytes);
        padded.set(paddedPendingBytes, completeBytes.byteLength);
        pendingBytes = new Uint8Array(0);

        return {
          data: padded,
          mimeType: outputMimeType,
        };
      }

      return {
        data: completeBytes,
        mimeType: outputMimeType,
      };
    }

    if (completeBytes.byteLength > 0) {
      appendSamples(completeBytes);
    }

    if (finalChunk && pendingBytes.byteLength > 0) {
      appendSamples(padBytesToFrame(pendingBytes, bytesPerFrame));
      pendingBytes = new Uint8Array(0);
    }

    return {
      data: drainResampledAudio(finalChunk),
      mimeType: outputMimeType,
    };
  };

  return {
    push(data: Uint8Array, mimeType?: string) {
      return normalizeChunk(data, mimeType, false);
    },
    flush() {
      return normalizeChunk(new Uint8Array(0), undefined, true);
    },
  };
}

function getBitsPerSample(mimeType: string): number {
  return Number.parseInt(mimeType.match(/l(\d+)/)?.[1] ?? "16", 10);
}

function getChannels(mimeType: string): number {
  return Number.parseInt(mimeType.match(/channels=(\d+)/)?.[1] ?? "1", 10);
}

function getSampleRate(mimeType: string): number {
  return Number.parseInt(mimeType.match(/rate=(\d+)/)?.[1] ?? "24000", 10);
}

function padBytesToFrame(data: Uint8Array, bytesPerFrame: number): Uint8Array {
  if (data.byteLength === 0 || data.byteLength % bytesPerFrame === 0) {
    return data;
  }

  const padded = new Uint8Array(
    data.byteLength + (bytesPerFrame - (data.byteLength % bytesPerFrame)),
  );
  padded.set(data);
  return padded;
}

function encodeInt16Samples(samples: number[]): Uint8Array {
  if (samples.length === 0) {
    return new Uint8Array(0);
  }

  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-32768, Math.min(32767, sample));
    bytes[index * 2] = clamped & 0xff;
    bytes[index * 2 + 1] = (clamped >> 8) & 0xff;
  });

  return bytes;
}
