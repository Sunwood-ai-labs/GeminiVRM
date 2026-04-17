import { IconButton } from "./iconButton";

type Props = {
  userMessage: string;
  isMicRecording: boolean;
  isChatProcessing: boolean;
  isMicAvailable?: boolean;
  placeholder?: string;
  onChangeUserMessage: (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => void;
  onClickSendButton: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onClickMicButton: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export const MessageInput = ({
  userMessage,
  isMicRecording,
  isChatProcessing,
  isMicAvailable = true,
  placeholder = "Type a message",
  onChangeUserMessage,
  onClickMicButton,
  onClickSendButton,
}: Props) => {
  const isTextInputDisabled = isChatProcessing || isMicRecording;
  const isMicButtonDisabled = !isMicAvailable || (isChatProcessing && !isMicRecording);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-12 pb-12 sm:px-16 sm:pb-16">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-8">
        <div className="pointer-events-auto w-full rounded-[28px] bg-[rgba(255,245,248,0.14)] p-8 text-black shadow-[0_12px_32px_rgba(58,25,37,0.12)] backdrop-blur-sm sm:p-10">
          <div className="grid grid-flow-col grid-cols-[min-content_1fr_min-content] gap-[8px] sm:gap-[10px]">
            <IconButton
              iconName="24/Microphone"
              className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled focus-visible:ring-white/85 focus-visible:ring-offset-white/20"
              isProcessing={isMicRecording}
              disabled={isMicButtonDisabled}
              onClick={onClickMicButton}
            />
            <input
              type="text"
              placeholder={placeholder}
              onChange={onChangeUserMessage}
              disabled={isTextInputDisabled}
              className="disabled bg-surface1 hover:bg-surface1-hover focus:bg-surface1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-white/10 disabled:bg-surface1-disabled disabled:text-primary-disabled min-h-[52px] w-full rounded-16 px-16 text-text-primary typography-16 font-bold"
              value={userMessage}
            />

            <IconButton
              iconName="24/Send"
              className="bg-secondary hover:bg-secondary-hover active:bg-secondary-press disabled:bg-secondary-disabled focus-visible:ring-white/85 focus-visible:ring-offset-white/20"
              isProcessing={isChatProcessing}
              disabled={isTextInputDisabled || !userMessage.trim()}
              onClick={onClickSendButton}
            />
          </div>
        </div>
        <div className="pointer-events-none px-8 text-center font-Montserrat text-[10px] uppercase tracking-[0.16em] text-white/80 drop-shadow-[0_1px_6px_rgba(0,0,0,0.28)] sm:text-[11px]">
          powered by VRoid, Gemini Live, and @pixiv/three-vrm
        </div>
      </div>
    </div>
  );
};
