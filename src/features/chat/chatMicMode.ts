export const CHAT_MIC_MODES = ["push_to_talk", "hands_free"] as const;

export type ChatMicMode = (typeof CHAT_MIC_MODES)[number];
