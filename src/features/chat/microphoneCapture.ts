import { float32ToInt16Pcm } from "./pcmAudio";

export type MicrophoneCaptureSession = {
  stop: () => Promise<void>;
};

type CreateMicrophoneCaptureSessionParams = {
  onAudioChunk: (chunk: Uint8Array, mimeType: string) => void;
};

type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export async function createMicrophoneCaptureSession({
  onAudioChunk,
}: CreateMicrophoneCaptureSessionParams): Promise<MicrophoneCaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioWindow = window as WindowWithAudioContext;
  const AudioContextConstructor =
    audioWindow.AudioContext || audioWindow.webkitAudioContext;

  if (!AudioContextConstructor) {
    stopTracks(stream);
    throw new Error("This browser does not support Web Audio capture.");
  }

  const audioContext = new AudioContextConstructor();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  const silentSink = audioContext.createGain();
  silentSink.gain.value = 0;

  let stopped = false;

  try {
    await audioContext.resume();

    processorNode.onaudioprocess = (event) => {
      if (stopped) {
        return;
      }

      const channelSamples = event.inputBuffer.getChannelData(0);
      const chunk = float32ToInt16Pcm(channelSamples);
      if (chunk.byteLength === 0) {
        return;
      }

      onAudioChunk(chunk, `audio/pcm;rate=${audioContext.sampleRate}`);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentSink);
    silentSink.connect(audioContext.destination);
  } catch (error) {
    stopped = true;
    processorNode.onaudioprocess = null;
    processorNode.disconnect();
    sourceNode.disconnect();
    silentSink.disconnect();
    stopTracks(stream);
    await audioContext.close().catch(() => {});
    throw error;
  }

  return {
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      processorNode.onaudioprocess = null;
      processorNode.disconnect();
      sourceNode.disconnect();
      silentSink.disconnect();
      stopTracks(stream);
      await audioContext.close().catch(() => {});
    },
  };
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    if (track.readyState === "live") {
      track.stop();
    }
  });
}
