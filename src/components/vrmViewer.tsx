import { useContext, useCallback } from "react";
import { ViewerContext } from "../features/vrmViewer/viewerContext";
import { buildUrl } from "@/utils/buildUrl";
import type { ScreenShareCaptureFrame } from "@/features/chat/screenShareCapture";
import { ScreenSharePreviewCard } from "./screenSharePreviewCard";

type VrmViewerProps = {
  screenShareFrame?: ScreenShareCaptureFrame | null;
};

export default function VrmViewer({ screenShareFrame = null }: VrmViewerProps) {
  const { viewer } = useContext(ViewerContext);

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (canvas) {
        viewer.setup(canvas);
        viewer.loadVrm(buildUrl("/Kiyoka.vrm"));

        // Drag and DropでVRMを差し替え
        canvas.addEventListener("dragover", function (event) {
          event.preventDefault();
        });

        canvas.addEventListener("drop", function (event) {
          event.preventDefault();

          const files = event.dataTransfer?.files;
          if (!files) {
            return;
          }

          const file = files[0];
          if (!file) {
            return;
          }

          const file_type = file.name.split(".").pop();
          if (file_type === "vrm") {
            const blob = new Blob([file], { type: "application/octet-stream" });
            const url = window.URL.createObjectURL(blob);
            viewer.loadVrm(url);
          }
        });
      }
    },
    [viewer]
  );

  return (
    <div className={"absolute top-0 left-0 z-0 w-screen h-[100svh]"}>
      {screenShareFrame ? (
        <ScreenSharePreviewCard frame={screenShareFrame} label="Screen sent to Gemini" />
      ) : null}
      <canvas ref={canvasRef} className={"h-full w-full touch-none"}></canvas>
    </div>
  );
}
