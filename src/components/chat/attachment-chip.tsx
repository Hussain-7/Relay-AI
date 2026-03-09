import type { AttachmentDto } from "@/lib/contracts";
import { getFileTypeBadge } from "@/lib/chat-utils";
import { IconClose } from "@/components/icons";

export function AttachmentChip({ attachment, onRemove }: { attachment: AttachmentDto; onRemove?: () => void }) {
  const badge = getFileTypeBadge(attachment);

  return (
    <div className="group/card relative flex min-w-[120px] max-w-[200px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(255,255,255,0.04)] overflow-hidden transition-[border-color] duration-[140ms] ease-linear hover:border-[rgba(255,255,255,0.16)]">
      <div className="flex flex-col justify-between gap-2 px-3 py-2.5 min-w-0 flex-1">
        <span className="text-[0.8rem] leading-[1.3] text-[rgba(245,240,232,0.86)] overflow-hidden text-ellipsis [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box] break-all">{attachment.filename}</span>
        <span className="inline-flex self-start px-1.5 py-0.5 rounded-[4px] bg-[rgba(255,255,255,0.08)] text-[rgba(245,240,232,0.6)] text-[0.65rem] font-semibold tracking-[0.04em] uppercase">{badge}</span>
      </div>
      {onRemove ? (
        <button type="button" className="absolute top-1 right-1 grid h-[22px] w-[22px] place-items-center border-0 rounded-[6px] bg-[rgba(0,0,0,0.5)] text-[rgba(245,240,232,0.7)] cursor-pointer opacity-0 transition-[opacity,background] duration-[140ms] ease-linear group-hover/card:opacity-100 hover:bg-[rgba(0,0,0,0.7)] hover:text-[rgba(245,240,232,0.95)]" onClick={onRemove} aria-label={`Remove ${attachment.filename}`}>
          <IconClose />
        </button>
      ) : null}
    </div>
  );
}
