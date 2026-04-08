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
      className={`pointer-events-none absolute z-20 overflow-hidden rounded-[24px] border border-white/80 bg-[rgba(20,18,24,0.78)] shadow-[0_20px_56px_rgba(0,0,0,0.32)] backdrop-blur-md ${
        isCompact
          ? "right-3 top-20 w-[168px] sm:right-4 sm:top-24 sm:w-[196px]"
          : "right-3 top-16 w-[188px] sm:right-4 sm:top-20 sm:w-[240px]"
      }`}
      aria-label={label}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-12 py-9 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 sm:px-14">
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
            className={`block w-full object-cover ${
              isCompact ? "aspect-[16/10]" : "aspect-[16/10]"
            }`}
          />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center text-xs font-semibold text-white/65">
            Waiting for frame
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent px-12 py-10 text-[11px] font-semibold text-white">
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
