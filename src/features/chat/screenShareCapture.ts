export type ScreenShareCaptureFrame = {
  byteLength: number;
  capturedAt: number;
  data: string;
  height: number;
  mimeType: string;
  width: number;
};

export type ScreenShareCaptureStats = {
  bufferedFrameCount: number;
  capturedFrameCount: number;
  lastCapturedAt: number | null;
  lastFrameByteLength: number;
  lastFrameHeight: number;
  lastFrameWidth: number;
  lastStreamedAt: number | null;
  streamedFrameCount: number;
};

export type ScreenShareCaptureSession = {
  getLatestFrame: () => ScreenShareCaptureFrame | null;
  getStats: () => ScreenShareCaptureStats;
  markFrameStreamed: (count?: number) => void;
  stop: () => void;
  stream: MediaStream;
  subscribe: (
    listener: (frame: ScreenShareCaptureFrame) => void,
  ) => () => void;
};

type CreateScreenShareCaptureSessionParams = {
  frameIntervalMs?: number;
  onFrame?: (frame: ScreenShareCaptureFrame | null) => void;
  onStatsChange?: (stats: ScreenShareCaptureStats) => void;
  stream: MediaStream;
};

const DEFAULT_FRAME_INTERVAL_MS = 1000;

export const EMPTY_SCREEN_SHARE_CAPTURE_STATS: ScreenShareCaptureStats = {
  bufferedFrameCount: 0,
  capturedFrameCount: 0,
  lastCapturedAt: null,
  lastFrameByteLength: 0,
  lastFrameHeight: 0,
  lastFrameWidth: 0,
  lastStreamedAt: null,
  streamedFrameCount: 0,
};

export async function createScreenShareCaptureSession({
  frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
  onFrame,
  onStatsChange,
  stream,
}: CreateScreenShareCaptureSessionParams): Promise<ScreenShareCaptureSession> {
  const videoTrack = stream
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
  const listeners = new Set<(frame: ScreenShareCaptureFrame) => void>();
  let latestFrame: ScreenShareCaptureFrame | null = null;
  let stats: ScreenShareCaptureStats = {
    ...EMPTY_SCREEN_SHARE_CAPTURE_STATS,
  };

  const notifyStatsChange = () => {
    onStatsChange?.({
      ...stats,
    });
  };

  const applyStats = (
    nextStats:
      | ScreenShareCaptureStats
      | ((currentStats: ScreenShareCaptureStats) => ScreenShareCaptureStats),
  ) => {
    stats =
      typeof nextStats === "function"
        ? nextStats(stats)
        : nextStats;
    notifyStatsChange();
  };

  const updateLatestFrame = (frame: ScreenShareCaptureFrame | null) => {
    latestFrame = frame;
    onFrame?.(frame);
  };

  await waitForScreenShareVideo(videoElement);
  await captureAndBroadcastFrame({
    canvas: frameCanvas,
    listeners,
    applyStats,
    updateLatestFrame,
    videoElement,
  });

  void captureFrameLoop({
    abortSignal: abortController.signal,
    canvas: frameCanvas,
    frameIntervalMs,
    listeners,
    applyStats,
    updateLatestFrame,
    videoElement,
    videoTrack,
  });

  return {
    getLatestFrame() {
      return latestFrame;
    },
    getStats() {
      return {
        ...stats,
      };
    },
    markFrameStreamed(count = 1) {
      applyStats((currentStats) => ({
        ...currentStats,
        lastStreamedAt: Date.now(),
        streamedFrameCount:
          currentStats.streamedFrameCount + Math.max(count, 0),
      }));
    },
    stop() {
      abortController.abort();
      listeners.clear();
      updateLatestFrame(null);
      videoElement.pause();
      videoElement.srcObject = null;
    },
    stream,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function setStatsFromFrame(
  stats: ScreenShareCaptureStats,
  frame: ScreenShareCaptureFrame,
): ScreenShareCaptureStats {
  return {
    ...stats,
    bufferedFrameCount: 1,
    capturedFrameCount: stats.capturedFrameCount + 1,
    lastCapturedAt: frame.capturedAt,
    lastFrameByteLength: frame.byteLength,
    lastFrameHeight: frame.height,
    lastFrameWidth: frame.width,
  };
}

async function captureFrameLoop({
  abortSignal,
  canvas,
  frameIntervalMs,
  listeners,
  applyStats,
  updateLatestFrame,
  videoElement,
  videoTrack,
}: {
  abortSignal: AbortSignal;
  canvas: HTMLCanvasElement;
  frameIntervalMs: number;
  listeners: Set<(frame: ScreenShareCaptureFrame) => void>;
  applyStats: (
    stats:
      | ScreenShareCaptureStats
      | ((currentStats: ScreenShareCaptureStats) => ScreenShareCaptureStats),
  ) => void;
  updateLatestFrame: (frame: ScreenShareCaptureFrame | null) => void;
  videoElement: HTMLVideoElement;
  videoTrack: MediaStreamTrack;
}): Promise<void> {
  while (!abortSignal.aborted && videoTrack.readyState === "live") {
    await waitForNextFrameInterval(abortSignal, frameIntervalMs);
    if (abortSignal.aborted || videoTrack.readyState !== "live") {
      break;
    }

    try {
      await captureAndBroadcastFrame({
        canvas,
        listeners,
        applyStats,
        updateLatestFrame,
        videoElement,
      });
    } catch {
      // Ignore transient capture failures and try again on the next tick.
    }
  }
}

async function captureAndBroadcastFrame({
  canvas,
  listeners,
  applyStats,
  updateLatestFrame,
  videoElement,
}: {
  canvas: HTMLCanvasElement;
  listeners: Set<(frame: ScreenShareCaptureFrame) => void>;
  applyStats: (
    stats:
      | ScreenShareCaptureStats
      | ((currentStats: ScreenShareCaptureStats) => ScreenShareCaptureStats),
  ) => void;
  updateLatestFrame: (frame: ScreenShareCaptureFrame | null) => void;
  videoElement: HTMLVideoElement;
}): Promise<void> {
  const frame = await captureScreenShareFrame(videoElement, canvas);
  updateLatestFrame(frame);

  applyStats((currentStats) =>
    setStatsFromFrame(currentStats, frame),
  );

  listeners.forEach((listener) => {
    listener(frame);
  });
}

async function captureScreenShareFrame(
  videoElement: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<ScreenShareCaptureFrame> {
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

  return {
    byteLength: frameBytes.byteLength,
    capturedAt: Date.now(),
    data: encodeBase64(frameBytes),
    height: scaledHeight,
    mimeType: frameBlob.type || "image/jpeg",
    width: scaledWidth,
  };
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

function waitForNextFrameInterval(
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

export function toScreenShareFrameDataUrl(
  frame: ScreenShareCaptureFrame | null | undefined,
): string | null {
  if (!frame) {
    return null;
  }

  return `data:${frame.mimeType};base64,${frame.data}`;
}
