import type { ScreenShareCaptureFrame } from "@/features/chat/screenShareCapture";
import { toScreenShareFrameDataUrl } from "@/features/chat/screenShareCapture";

type ScreenSharePreviewCardProps = {
  frame: ScreenShareCaptureFrame | null;
  isCompact?: boolean;
  label?: string;
};

export function ScreenSharePreviewCard({
  frame,
  isCompact = false,
  label = "Live screen capture",
}: ScreenSharePreviewCardProps) {
  const dataUrl = toScreenShareFrameDataUrl(frame);

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-white/80 bg-[rgba(20,18,24,0.78)] shadow-[0_28px_80px_rgba(0,0,0,0.38)] backdrop-blur-md ${
        isCompact
          ? "w-[min(78vw,540px)] sm:w-[min(64vw,580px)]"
          : "w-[min(88vw,720px)] sm:w-[min(72vw,820px)]"
      }`}
      aria-label={label}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-14 py-10 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 sm:px-16 sm:py-12 sm:text-[11px]">
        <span>{label}</span>
        <span className="rounded-full bg-emerald-400/15 px-7 py-3 text-[9px] text-emerald-200">
          Live
        </span>
      </div>
      <div className="relative bg-black/60">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={label}
            className="block aspect-[16/10] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center text-xs font-semibold text-white/65">
            Waiting for frame
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-14 py-12 text-[11px] font-semibold text-white sm:px-16 sm:py-14 sm:text-[12px]">
          {frame
            ? `${frame.width}x${frame.height} · ${Math.max(
                1,
                Math.round(frame.byteLength / 1024),
              )} KB`
            : "No image captured yet"}
        </div>
      </div>
    </div>
  );
}
