import { MessageInput } from "@/components/messageInput";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  isChatProcessing: boolean;
  isMicRecording: boolean;
  isMicAvailable?: boolean;
  canStartMicWhileProcessing?: boolean;
  placeholder?: string;
  onChatProcessStart: (text: string) => void;
  onToggleMicRecording: () => void;
};

export const MessageInputContainer = ({
  isChatProcessing,
  isMicRecording,
  isMicAvailable = true,
  canStartMicWhileProcessing = false,
  placeholder,
  onChatProcessStart,
  onToggleMicRecording,
}: Props) => {
  const [userMessage, setUserMessage] = useState("");
  const hasMountedRef = useRef(false);

  const handleClickSendButton = useCallback(() => {
    onChatProcessStart(userMessage);
  }, [onChatProcessStart, userMessage]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (!isChatProcessing && !isMicRecording) {
      setUserMessage("");
    }
  }, [isChatProcessing, isMicRecording]);

  return (
    <MessageInput
      userMessage={userMessage}
      isChatProcessing={isChatProcessing}
      isMicRecording={isMicRecording}
      isMicAvailable={isMicAvailable}
      canStartMicWhileProcessing={canStartMicWhileProcessing}
      placeholder={placeholder}
      onChangeUserMessage={(event) => setUserMessage(event.target.value)}
      onClickMicButton={onToggleMicRecording}
      onClickSendButton={handleClickSendButton}
    />
  );
};
