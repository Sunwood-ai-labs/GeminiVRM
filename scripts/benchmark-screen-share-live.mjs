import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  GoogleGenAI,
  MediaResolution,
  Modality,
  createPartFromBase64,
  createPartFromText,
  createUserContent,
} from "@google/genai";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_IMAGE_PATH = path.join(REPO_DIR, "public", "ogp.jpg");
const DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_ROUNDS = 3;
const DEFAULT_MEDIA_RESOLUTION = MediaResolution.MEDIA_RESOLUTION_MEDIUM;
const TURN_TIMEOUT_MS = 45000;
const PROMPT = "What is visible here? Reply in one short sentence.";
const SYSTEM_INSTRUCTION =
  "Reply in one short sentence. If visual input is available, mention one concrete visible detail.";

const strategies = [
  {
    id: "text_only",
    label: "Text only",
    async send({ markDone, session }) {
      session.sendRealtimeInput({
        text: PROMPT,
      });
      return {
        framesSent: 0,
        stop: async () => {
          markDone();
        },
      };
    },
  },
  {
    id: "realtime_snapshot",
    label: "Realtime snapshot",
    async send({ imagePayload, markDone, session }) {
      session.sendRealtimeInput({
        video: imagePayload,
      });
      session.sendRealtimeInput({
        text: PROMPT,
      });
      return {
        framesSent: 1,
        stop: async () => {
          markDone();
        },
      };
    },
  },
  {
    id: "client_content_image_text",
    label: "ClientContent image+text",
    async send({ imagePayload, markDone, session }) {
      session.sendClientContent({
        turns: [
          createUserContent([
            createPartFromBase64(imagePayload.data, imagePayload.mimeType),
            createPartFromText(PROMPT),
          ]),
        ],
        turnComplete: true,
      });
      return {
        framesSent: 1,
        stop: async () => {
          markDone();
        },
      };
    },
  },
];

const env = await loadDotEnv(path.join(REPO_DIR, ".env"));
const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || env.NEXT_PUBLIC_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("NEXT_PUBLIC_GEMINI_API_KEY was not found in the environment or .env.");
}

const imagePathArg = process.argv[2];
const roundsArg = process.argv[3];
const resolutionArg = process.argv[4];
const imagePath = imagePathArg
  ? path.resolve(REPO_DIR, imagePathArg)
  : DEFAULT_IMAGE_PATH;
const rounds = Math.max(Number.parseInt(roundsArg || String(DEFAULT_ROUNDS), 10) || DEFAULT_ROUNDS, 1);
const mediaResolution = parseMediaResolution(resolutionArg);
const imageBytes = await readFile(imagePath);
const imagePayload = {
  mimeType: guessMimeTypeFromPath(imagePath),
  data: imageBytes.toString("base64"),
};

const ai = new GoogleGenAI({
  apiKey,
  apiVersion: "v1alpha",
});

const results = [];

for (let round = 1; round <= rounds; round += 1) {
  for (const strategy of strategies) {
    const result = await runStrategyRound({
      ai,
      imagePayload,
      model: env.NEXT_PUBLIC_GEMINI_LIVE_MODEL || DEFAULT_MODEL,
      round,
      strategy,
    });
    results.push(result);
    console.log(
      `${strategy.id} round ${round}: firstAudio=${formatMetric(result.firstAudioAtMs)} ms, firstTranscript=${formatMetric(result.firstTranscriptAtMs)} ms, turnComplete=${formatMetric(result.turnCompleteAtMs)} ms, frames=${result.framesSent}`,
    );
  }
}

console.log("");
console.log(`Image: ${path.relative(REPO_DIR, imagePath)} (${Math.round(imageBytes.byteLength / 1024)} KB)`);
console.log(`Model: ${env.NEXT_PUBLIC_GEMINI_LIVE_MODEL || DEFAULT_MODEL}`);
console.log(`Media resolution: ${mediaResolution}`);
console.log(`Rounds: ${rounds}`);
console.log("");
console.log("| Strategy | Status | Avg first audio (ms) | Median first audio (ms) | Avg turn complete (ms) | Avg frames sent |");
console.log("| --- | --- | ---: | ---: | ---: | ---: |");

for (const strategy of strategies) {
  const strategyResults = results.filter((result) => result.strategyId === strategy.id);
  const successResults = strategyResults.filter((result) => !result.error);
  const status = successResults.length === strategyResults.length
    ? "ok"
    : successResults.length === 0
      ? "failed"
      : "partial";
  console.log(
    `| ${strategy.label} | ${status} | ${formatMetric(average(successResults.map((result) => result.firstAudioAtMs)))} | ${formatMetric(median(successResults.map((result) => result.firstAudioAtMs)))} | ${formatMetric(average(successResults.map((result) => result.turnCompleteAtMs)))} | ${formatMetric(average(successResults.map((result) => result.framesSent)))} |`,
  );
}

console.log("");
console.log("Latest transcripts:");
for (const strategy of strategies) {
  const latestResult = results
    .filter((result) => result.strategyId === strategy.id)
    .at(-1);
  if (!latestResult) {
    continue;
  }

  console.log(
    `- ${strategy.label}: ${latestResult.error ? `[error] ${latestResult.error}` : latestResult.transcript || "[empty]"}`,
  );
}

async function runStrategyRound({
  ai,
  imagePayload,
  model,
  round,
  strategy,
}) {
  let firstAudioAtMs = null;
  let firstTranscriptAtMs = null;
  let turnCompleteAtMs = null;
  let framesSent = 0;
  let transcript = "";
  let turnResolved = false;

  const startedAt = performance.now();
  let resolveTurn;
  let rejectTurn;
  const turnFinished = new Promise((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });

  const timeoutId = setTimeout(() => {
    if (turnResolved) {
      return;
    }

    turnResolved = true;
    rejectTurn(new Error(`Timed out after ${TURN_TIMEOUT_MS}ms.`));
  }, TURN_TIMEOUT_MS);

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      mediaResolution,
      outputAudioTranscription: {},
      systemInstruction: SYSTEM_INSTRUCTION,
    },
    callbacks: {
      onmessage(message) {
        if (
          firstAudioAtMs == null &&
          message.serverContent?.modelTurn?.parts?.some((part) => part.inlineData?.data)
        ) {
          firstAudioAtMs = Math.round(performance.now() - startedAt);
        }

        const nextTranscriptChunk = message.serverContent?.outputTranscription?.text ?? "";
        if (nextTranscriptChunk) {
          transcript += nextTranscriptChunk;
          if (firstTranscriptAtMs == null) {
            firstTranscriptAtMs = Math.round(performance.now() - startedAt);
          }
        }

        if (message.serverContent?.turnComplete && !turnResolved) {
          turnResolved = true;
          turnCompleteAtMs = Math.round(performance.now() - startedAt);
          resolveTurn();
        }
      },
      onerror(errorEvent) {
        if (turnResolved) {
          return;
        }

        turnResolved = true;
        rejectTurn(new Error(errorEvent.message || "Live API error."));
      },
      onclose(closeEvent) {
        if (turnResolved) {
          return;
        }

        turnResolved = true;
        rejectTurn(new Error(closeEvent.reason || "Live API closed early."));
      },
    },
  });

  let handle;
  try {
    handle = await strategy.send({
      imagePayload,
      markDone() {
        turnResolved = true;
      },
      session,
    });

    await turnFinished;

    clearTimeout(timeoutId);
    framesSent =
      typeof handle.framesSent === "number" ? handle.framesSent : handle.framesSent;
    return {
      error: null,
      firstAudioAtMs,
      firstTranscriptAtMs,
      framesSent,
      round,
      strategyId: strategy.id,
      transcript: transcript.trim().replace(/\s+/g, " ").slice(0, 160),
      turnCompleteAtMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      error: error instanceof Error ? error.message : String(error),
      firstAudioAtMs,
      firstTranscriptAtMs,
      framesSent,
      round,
      strategyId: strategy.id,
      transcript: transcript.trim().replace(/\s+/g, " ").slice(0, 160),
      turnCompleteAtMs,
    };
  } finally {
    if (handle?.stop) {
      await handle.stop().catch(() => {
        // Ignore best-effort stop failures during benchmark cleanup.
      });
    }
    session.close();
  }
}

function average(values) {
  const numbers = values.filter((value) => typeof value === "number");
  if (numbers.length === 0) {
    return null;
  }

  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function median(values) {
  const numbers = values
    .filter((value) => typeof value === "number")
    .sort((left, right) => left - right);
  if (numbers.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) {
    return numbers[middleIndex];
  }

  return Math.round((numbers[middleIndex - 1] + numbers[middleIndex]) / 2);
}

function formatMetric(value) {
  return value == null ? "n/a" : String(value);
}

function guessMimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}

async function loadDotEnv(dotEnvPath) {
  try {
    const raw = await readFile(dotEnvPath, "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
          return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function parseMediaResolution(value) {
  const normalizedValue = (value || "").trim().toLowerCase();
  switch (normalizedValue) {
    case "low":
    case "media_resolution_low":
      return MediaResolution.MEDIA_RESOLUTION_LOW;
    case "medium":
    case "media_resolution_medium":
      return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
    default:
      return DEFAULT_MEDIA_RESOLUTION;
  }
}
