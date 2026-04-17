import type { Message, MessageInputImage } from "../messages/messages";
import { DEFAULT_GEMINI_VOICE_NAME } from "../chat/geminiLiveConfig";

export type InteractionMode = "chat" | "podcast";

export type PodcastSpeakerId = "yukito" | "kiyoka";

export type PodcastParticipant = {
  id: PodcastSpeakerId;
  displayName: string;
  shortLabel: string;
  vrmPath: string;
  voiceName: string;
  systemPrompt: string;
};

export type PodcastTurn = {
  speakerId: PodcastSpeakerId;
  speakerName: string;
  transcript: string;
  audioMimeType: string;
  audioBytes: Uint8Array;
  inputImage?: MessageInputImage;
};

export const DEFAULT_PODCAST_TURN_COUNT = 6;

export const DEFAULT_PODCAST_PARTICIPANTS: Record<
  PodcastSpeakerId,
  PodcastParticipant
> = {
  yukito: {
    id: "yukito",
    displayName: "Yukito",
    shortLabel: "Host A",
    vrmPath: "/Yukito.vrm",
    voiceName: "Puck",
    systemPrompt: [
      "You are Yukito, one half of a two-person Japanese podcast with Kiyoka.",
      "Speak in natural Japanese with a lively, curious host energy.",
      "Keep each turn to 1-3 concise sentences.",
      "React to what Kiyoka just said, ask follow-up questions when helpful, and avoid narration or stage directions.",
    ].join(" "),
  },
  kiyoka: {
    id: "kiyoka",
    displayName: "Kiyoka",
    shortLabel: "Host B",
    vrmPath: "/Kiyoka.vrm",
    voiceName: DEFAULT_GEMINI_VOICE_NAME,
    systemPrompt: [
      "You are Kiyoka, one half of a two-person Japanese podcast with Yukito.",
      "Speak in natural Japanese with a calm, insightful co-host energy.",
      "Keep each turn to 1-3 concise sentences.",
      "Build on Yukito's latest point, add nuance, and avoid narration or stage directions.",
    ].join(" "),
  },
};

const PODCAST_CONTEXT_WINDOW = 6;

export function buildPodcastOpeningPrompt(
  topic: string,
  speaker: PodcastParticipant,
  partner: PodcastParticipant,
  totalTurns: number
): string {
  return [
    `Podcast topic: ${topic.trim() || "最近気になっていること"}`,
    `${speaker.displayName}として番組を始めてください。`,
    `${partner.displayName}と自然に掛け合いを始め、最初の話題を振ってください。`,
    `全体で${totalTurns}ターン程度の短い会話になる想定なので、テンポよく進めてください。`,
  ].join("\n");
}

export function buildPodcastRelaySystemPrompt(
  speaker: PodcastParticipant,
  partner: PodcastParticipant,
  turns: PodcastTurn[],
  latestPartnerTranscript?: string
): string {
  const recentConversation = formatRecentConversation(turns);

  return [
    speaker.systemPrompt,
    `You are talking with ${partner.displayName}.`,
    "The next audio input is the other host's latest spoken turn.",
    "Respond naturally in Japanese, continue the same topic, and do not repeat the whole previous line verbatim.",
    `Recent conversation:\n${recentConversation}`,
    latestPartnerTranscript
      ? `Latest partner transcript hint:\n${latestPartnerTranscript}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPodcastDisplayLog(turns: PodcastTurn[]): Message[] {
  return turns.map((turn) => ({
    role: "assistant",
    content: turn.transcript,
    inputImage: turn.inputImage,
    name: turn.speakerName,
    source: "podcast",
  }));
}

export function podcastTurnsToGeminiMessages(
  turns: PodcastTurn[],
  currentSpeakerId: PodcastSpeakerId
): Message[] {
  return turns.map((turn) => ({
    role: turn.speakerId === currentSpeakerId ? "assistant" : "user",
    content: turn.transcript,
    name: turn.speakerName,
    source: "podcast",
  }));
}

function formatRecentConversation(turns: PodcastTurn[]): string {
  if (turns.length === 0) {
    return "No prior podcast turns yet.";
  }

  return turns
    .slice(-PODCAST_CONTEXT_WINDOW)
    .map((turn) => `${turn.speakerName}: ${turn.transcript}`)
    .join("\n");
}
