import { IconButton } from "./iconButton";
import { Message } from "@/features/messages/messages";
import { ChatLog } from "./chatLog";
import React, { useCallback, useContext, useRef, useState } from "react";
import { Settings } from "./settings";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { AssistantText } from "./assistantText";
import { BuiltInMotionId } from "@/features/vrmViewer/builtInMotions";
import { InteractionMode } from "@/features/podcast/podcastConfig";
import type { ScreenShareCaptureStats } from "@/features/chat/screenShareCapture";

type Props = {
  geminiApiKey: string;
  geminiModel: string;
  geminiVoiceName: string;
  interactionMode: InteractionMode;
  screenShareState: "idle" | "starting" | "active" | "error";
  screenShareError: string;
  screenShareSourceLabel: string;
  screenShareStats: ScreenShareCaptureStats;
  podcastTurnCount: number;
  podcastYukitoVoiceName: string;
  podcastKiyokaVoiceName: string;
  selectedMotionId: BuiltInMotionId;
  systemPrompt: string;
  chatLog: Message[];
  assistantMessage: string;
  assistantStatus: string;
  assistantSpeakerName?: string;
  onChangeSystemPrompt: (systemPrompt: string) => void;
  onChangeGeminiApiKey: (key: string) => void;
  onChangeGeminiModel: (model: string) => void;
  onChangeGeminiVoiceName: (voiceName: string) => void;
  onChangeInteractionMode: (mode: InteractionMode) => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onChangePodcastTurnCount: (turnCount: number) => void;
  onChangePodcastYukitoVoiceName: (voiceName: string) => void;
  onChangePodcastKiyokaVoiceName: (voiceName: string) => void;
  onChangeMotion: (motionId: BuiltInMotionId) => void;
  onChangeChatLog: (index: number, text: string) => void;
  handleClickResetChatLog: () => void;
  handleClickResetSystemPrompt: () => void;
  youtubeSection?: React.ReactNode;
};

export const Menu = ({
  geminiApiKey,
  geminiModel,
  geminiVoiceName,
  interactionMode,
  screenShareState,
  screenShareError,
  screenShareSourceLabel,
  screenShareStats,
  podcastTurnCount,
  podcastYukitoVoiceName,
  podcastKiyokaVoiceName,
  selectedMotionId,
  systemPrompt,
  chatLog,
  assistantMessage,
  assistantStatus,
  assistantSpeakerName,
  onChangeSystemPrompt,
  onChangeGeminiApiKey,
  onChangeGeminiModel,
  onChangeGeminiVoiceName,
  onChangeInteractionMode,
  onStartScreenShare,
  onStopScreenShare,
  onChangePodcastTurnCount,
  onChangePodcastYukitoVoiceName,
  onChangePodcastKiyokaVoiceName,
  onChangeMotion,
  onChangeChatLog,
  handleClickResetChatLog,
  handleClickResetSystemPrompt,
  youtubeSection,
}: Props) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showChatLog, setShowChatLog] = useState(false);
  const { viewer } = useContext(ViewerContext);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChangeSystemPrompt = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChangeSystemPrompt(event.target.value);
    },
    [onChangeSystemPrompt],
  );

  const handleGeminiApiKeyChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChangeGeminiApiKey(event.target.value);
    },
    [onChangeGeminiApiKey],
  );

  const handleGeminiModelChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChangeGeminiModel(event.target.value);
    },
    [onChangeGeminiModel],
  );

  const handleGeminiVoiceNameChange = useCallback(
    (voiceName: string) => {
      onChangeGeminiVoiceName(voiceName);
    },
    [onChangeGeminiVoiceName],
  );

  const handleClickOpenVrmFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleChangeVrmFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const file = files[0];
      if (!file) return;

      const fileType = file.name.split(".").pop();

      if (fileType === "vrm") {
        const blob = new Blob([file], { type: "application/octet-stream" });
        const url = window.URL.createObjectURL(blob);
        viewer.loadVrm(url);
      }

      event.target.value = "";
    },
    [viewer],
  );

  return (
    <>
      <div className="absolute z-10 m-24">
        <div className="grid grid-flow-col gap-[8px]">
          <IconButton
            iconName="24/Menu"
            label="Settings"
            isProcessing={false}
            onClick={() => setShowSettings(true)}
          />
          {showChatLog ? (
            <IconButton
              iconName="24/CommentOutline"
              label="Chat Log"
              isProcessing={false}
              onClick={() => setShowChatLog(false)}
            />
          ) : (
            <IconButton
              iconName="24/CommentFill"
              label="Chat Log"
              isProcessing={false}
              disabled={chatLog.length <= 0}
              onClick={() => setShowChatLog(true)}
            />
          )}
        </div>
      </div>
      {showChatLog && <ChatLog messages={chatLog} />}
      {showSettings && (
        <Settings
          geminiApiKey={geminiApiKey}
          geminiModel={geminiModel}
          geminiVoiceName={geminiVoiceName}
          interactionMode={interactionMode}
          screenShareState={screenShareState}
          screenShareError={screenShareError}
          screenShareSourceLabel={screenShareSourceLabel}
          screenShareStats={screenShareStats}
          podcastTurnCount={podcastTurnCount}
          podcastYukitoVoiceName={podcastYukitoVoiceName}
          podcastKiyokaVoiceName={podcastKiyokaVoiceName}
          selectedMotionId={selectedMotionId}
          chatLog={chatLog}
          systemPrompt={systemPrompt}
          onClickClose={() => setShowSettings(false)}
          onChangeGeminiApiKey={handleGeminiApiKeyChange}
          onChangeGeminiModel={handleGeminiModelChange}
          onChangeGeminiVoiceName={handleGeminiVoiceNameChange}
          onChangeInteractionMode={onChangeInteractionMode}
          onStartScreenShare={onStartScreenShare}
          onStopScreenShare={onStopScreenShare}
          onChangePodcastTurnCount={onChangePodcastTurnCount}
          onChangePodcastYukitoVoiceName={onChangePodcastYukitoVoiceName}
          onChangePodcastKiyokaVoiceName={onChangePodcastKiyokaVoiceName}
          onChangeMotion={onChangeMotion}
          onChangeSystemPrompt={handleChangeSystemPrompt}
          onChangeChatLog={onChangeChatLog}
          onClickOpenVrmFile={handleClickOpenVrmFile}
          onClickResetChatLog={handleClickResetChatLog}
          onClickResetSystemPrompt={handleClickResetSystemPrompt}
          youtubeSection={youtubeSection}
        />
      )}
      {!showChatLog && (assistantMessage || assistantStatus) && (
        <AssistantText
          message={assistantMessage || assistantStatus}
          status={assistantStatus || undefined}
          speakerName={assistantSpeakerName}
          interactionMode={interactionMode}
        />
      )}
      <input
        type="file"
        className="hidden"
        accept=".vrm"
        ref={fileInputRef}
        onChange={handleChangeVrmFile}
      />
    </>
  );
};
