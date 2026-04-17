import { useEffect, useRef } from "react";
import {
  getMessageBadgeLabel,
  Message,
} from "@/features/messages/messages";
type Props = {
  messages: Message[];
};
export const ChatLog = ({ messages }: Props) => {
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: "auto",
      block: "center",
    });
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [messages]);
  return (
    <div className="absolute h-[100svh] max-w-full pb-96 sm:pb-112">
      <div className="max-h-full overflow-y-auto scroll-hidden px-16 pt-104 pb-96 sm:pb-112">
        {messages.map((msg, i) => {
          return (
            <div key={i} ref={messages.length - 1 === i ? chatScrollRef : null}>
              <Chat message={msg} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Chat = ({ message }: { message: Message }) => {
  const roleColor =
    message.role === "assistant"
      ? "bg-secondary text-white "
      : message.source === "youtube"
        ? "bg-primary text-white"
        : "bg-base text-primary";
  const roleText =
    message.role === "assistant"
      ? "text-secondary"
      : message.source === "youtube"
        ? "text-primary"
        : "text-primary";
  const offsetX = message.role === "user" ? "pl-40" : "pr-40";
  const label = getMessageBadgeLabel(message);
  const bodyText = message.displayContent ?? message.content;
  const inputImage = message.inputImage;

  return (
    <div className={`mx-auto max-w-sm my-16 ${offsetX}`}>
      <div
        className={`px-24 py-8 rounded-t-8 font-bold tracking-wider ${roleColor}`}
      >
        {label}
      </div>
      <div className="px-24 py-16 bg-white rounded-b-8">
        {inputImage ? (
          <div className="mb-12 overflow-hidden rounded-16 border border-[#ead8e2] bg-[#fff8fb]">
            <div className="flex items-center justify-between border-b border-[#ead8e2] px-12 py-8 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8d6178]">
              <span>{inputImage.label || "Input image sent to Gemini"}</span>
              <span>
                {inputImage.width}x{inputImage.height}
              </span>
            </div>
            {inputImage.dataUrl ? (
              <img
                src={inputImage.dataUrl}
                alt={inputImage.label || "Input image sent to Gemini"}
                className="block aspect-[16/10] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-[#f6eef3] text-sm font-semibold text-[#8d6178]">
                Preview not persisted
              </div>
            )}
            <div className="px-12 py-8 text-[11px] font-semibold text-[#8d6178]">
              {formatImageMeta(inputImage.byteLength, inputImage.capturedAt)}
            </div>
          </div>
        ) : null}
        <div className={`typography-16 font-bold ${roleText}`}>{bodyText}</div>
      </div>
    </div>
  );
};

function formatImageMeta(byteLength: number, capturedAt: number) {
  const sizeLabel = `${Math.max(1, Math.round(byteLength / 1024))} KB`;
  const timeLabel = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(capturedAt));

  return `${sizeLabel} · ${timeLabel}`;
}
