export type NormalizedPcmChunk = {
  data: Uint8Array;
  mimeType: string;
};

type Pcm16MonoNormalizerOptions = {
  defaultInputMimeType?: string;
  outputSampleRate?: number;
};

export function createPcm16MonoNormalizer({
  defaultInputMimeType = "audio/pcm;rate=24000",
  outputSampleRate = 16000,
}: Pcm16MonoNormalizerOptions = {}) {
  const outputMimeType = `audio/pcm;rate=${outputSampleRate}`;

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
    const normalizedMimeType = (
      mimeType || defaultInputMimeType
    ).toLowerCase();
    const nextFormat = {
      sampleRate: getSampleRate(normalizedMimeType),
      channels: getChannels(normalizedMimeType),
      bitsPerSample: getBitsPerSample(normalizedMimeType),
    };

    if (nextFormat.channels !== 1) {
      throw new Error(
        `Unsupported PCM format "${normalizedMimeType}". Expected mono audio.`,
      );
    }

    if (nextFormat.bitsPerSample !== 16) {
      throw new Error(
        `Unsupported PCM format "${normalizedMimeType}". Expected 16-bit PCM.`,
      );
    }

    if (
      format &&
      (format.sampleRate !== nextFormat.sampleRate ||
        format.channels !== nextFormat.channels ||
        format.bitsPerSample !== nextFormat.bitsPerSample)
    ) {
      throw new Error("PCM input format changed mid-stream.");
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
    const sourceStep = format.sampleRate / outputSampleRate;
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
  ): NormalizedPcmChunk => {
    const nextFormat = resolveFormat(mimeType);
    const bytesPerFrame = Math.max(
      (nextFormat.bitsPerSample / 8) * nextFormat.channels,
      1,
    );
    const merged = concatenateAudioChunks([pendingBytes, data]);
    const completeLength = merged.byteLength - (merged.byteLength % bytesPerFrame);
    const completeBytes = merged.slice(0, completeLength);
    pendingBytes = merged.slice(completeLength);

    if (nextFormat.sampleRate === outputSampleRate) {
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
    push(data: Uint8Array, mimeType?: string): NormalizedPcmChunk {
      return normalizeChunk(data, mimeType, false);
    },
    flush(mimeType?: string): NormalizedPcmChunk {
      return normalizeChunk(new Uint8Array(0), mimeType, true);
    },
  };
}

export function float32ToInt16Pcm(samples: Float32Array): Uint8Array {
  if (samples.length === 0) {
    return new Uint8Array(0);
  }

  const pcm = new Uint8Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const value =
      clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    pcm[index * 2] = value & 0xff;
    pcm[index * 2 + 1] = (value >> 8) & 0xff;
  }

  return pcm;
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
