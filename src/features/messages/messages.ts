import { VRMExpression, VRMExpressionPresetName } from "@pixiv/three-vrm";
import { KoeiroParam } from "../constants/koeiroParam";

// ChatGPT API
export type MessageInputImage = {
  byteLength: number;
  capturedAt: number;
  dataUrl?: string;
  height: number;
  label?: string;
  mimeType: string;
  width: number;
};

export type Message = {
  role: "assistant" | "system" | "user";
  content: string;
  displayContent?: string;
  inputImage?: MessageInputImage;
  name?: string;
  source?: "manual" | "podcast" | "youtube" | "system" | "assistant";
  externalId?: string;
  receivedAt?: string;
};

export const getMessageBadgeLabel = (message: Message): string => {
  if (message.source === "podcast") {
    return `PODCAST ${message.name ?? "Host"}`;
  }

  if (message.role === "assistant") {
    return "CHARACTER";
  }

  if (message.source === "youtube") {
    return `YOUTUBE ${message.name ?? "Viewer"}`;
  }

  if (message.role === "system" || message.source === "system") {
    return "SYSTEM";
  }

  return message.name ?? "YOU";
};

export const getMessageListLabel = (message: Message): string => {
  if (message.source === "podcast") {
    return `Podcast: ${message.name ?? "Host"}`;
  }

  if (message.role === "assistant") {
    return "Assistant";
  }

  if (message.role === "system" || message.source === "system") {
    return "System";
  }

  if (message.source === "youtube") {
    return `YouTube: ${message.name ?? "Viewer"}`;
  }

  return message.name ?? "You";
};

const talkStyles = [
  "talk",
  "happy",
  "sad",
  "angry",
  "fear",
  "surprised",
] as const;
export type TalkStyle = (typeof talkStyles)[number];

export type Talk = {
  style: TalkStyle;
  speakerX: number;
  speakerY: number;
  message: string;
};

const emotions = ["neutral", "happy", "angry", "sad", "relaxed"] as const;
type EmotionType = (typeof emotions)[number] & VRMExpressionPresetName;

/**
 * 発話文と音声の感情と、モデルの感情表現がセットになった物
 */
export type Screenplay = {
  expression: EmotionType;
  talk: Talk;
};

export const splitSentence = (text: string): string[] => {
  const splitMessages = text.split(/(?<=[。．！？\n])/g);
  return splitMessages.filter((msg) => msg !== "");
};

export const textsToScreenplay = (
  texts: string[],
  koeiroParam: KoeiroParam
): Screenplay[] => {
  const screenplays: Screenplay[] = [];
  let prevExpression = "neutral";
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];

    const match = text.match(/\[(.*?)\]/);

    const tag = (match && match[1]) || prevExpression;

    const message = text.replace(/\[(.*?)\]/g, "");

    let expression = prevExpression;
    if (emotions.includes(tag as any)) {
      expression = tag;
      prevExpression = tag;
    }

    screenplays.push({
      expression: expression as EmotionType,
      talk: {
        style: emotionToTalkStyle(expression as EmotionType),
        speakerX: koeiroParam.speakerX,
        speakerY: koeiroParam.speakerY,
        message: message,
      },
    });
  }

  return screenplays;
};

const emotionToTalkStyle = (emotion: EmotionType): TalkStyle => {
  switch (emotion) {
    case "angry":
      return "angry";
    case "happy":
      return "happy";
    case "sad":
      return "sad";
    default:
      return "talk";
  }
};
