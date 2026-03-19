import type { AttachmentDto } from "@/lib/contracts";
import { getFileTypeBadge } from "@/lib/chat-utils";
import { IconClose } from "@/components/icons";

export interface PendingFile {
  clientId: string;
  file: File;
  previewUrl: string | null;
  status: "uploading" | "done" | "error";
  attachment?: AttachmentDto;
  error?: string;
}

type AttachmentCardProps =
  | { attachment: AttachmentDto; pendingFile?: undefined; onRemove?: () => void; previewUrl?: string }
  | { pendingFile: PendingFile; attachment?: undefined; onRemove?: () => void; previewUrl?: undefined };

function getExtBadge(filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() ?? "";
  if (["DOC", "DOCX"].includes(ext)) return "DOC";
  if (["XLS", "XLSX"].includes(ext)) return "XLS";
  if (["TXT", "MD", "JSON", "CSV"].includes(ext)) return ext;
  return "FILE";
}

function isImageMediaType(mediaType: string) {
  return mediaType.startsWith("image/");
}

function Thumbnail({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 h-full w-full object-cover"
      draggable={false}
    />
  );
}

function FileIcon({ badge }: { badge: string }) {
  const isPdf = badge === "PDF";
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(255,255,255,0.03)]">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className={isPdf ? "text-[rgba(220,120,100,0.5)]" : "text-[rgba(245,240,232,0.2)]"}>
        <path d="M6 2h9l5 5v15H6V2z" fill="currentColor" opacity="0.15" />
        <path d="M14 2v5h5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 2h8l6 6v14H6V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-[2] flex items-center justify-center bg-[rgba(0,0,0,0.45)] backdrop-blur-[2px]">
      <div className="h-5 w-5 rounded-full border-2 border-[rgba(255,255,255,0.2)] border-t-[rgba(255,255,255,0.7)] animate-spin" />
    </div>
  );
}

function ErrorOverlay() {
  return (
    <div className="absolute inset-0 z-[2] flex items-center justify-center bg-[rgba(180,60,60,0.12)]">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[rgba(240,100,100,0.7)]">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6v5M10 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function AttachmentChip(props: AttachmentCardProps) {
  const { onRemove } = props;

  let filename: string;
  let badge: string;
  let isImage: boolean;
  let thumbnailSrc: string | null = null;
  let isUploading = false;
  let isError = false;

  if (props.pendingFile) {
    const pf = props.pendingFile;
    filename = pf.file.name;
    isImage = pf.file.type.startsWith("image/");
    badge = isImage ? "IMG" : pf.file.type === "application/pdf" ? "PDF" : getExtBadge(pf.file.name);
    thumbnailSrc = pf.previewUrl;
    isUploading = pf.status === "uploading";
    isError = pf.status === "error";
  } else {
    const att = props.attachment;
    filename = att.filename;
    badge = getFileTypeBadge(att);
    isImage = att.kind === "IMAGE" && isImageMediaType(att.mediaType);
    if (isImage) {
      // Prefer local object URL (fast, no API round-trip) over Anthropic Files API download
      thumbnailSrc = props.previewUrl ?? `/api/attachments/${att.id}/content`;
    }
  }

  return (
    <div
      className={[
        "group/card relative flex flex-col w-[156px] h-[112px] rounded-[12px] overflow-hidden border transition-[border-color] duration-[140ms] ease-linear",
        isError
          ? "border-[rgba(220,80,80,0.4)] bg-[rgba(220,80,80,0.06)]"
          : "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.18)]",
      ].join(" ")}
    >
      {/* Thumbnail / icon area */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {isImage && thumbnailSrc ? (
          <Thumbnail src={thumbnailSrc} alt={filename} />
        ) : (
          <FileIcon badge={badge} />
        )}
        {isUploading && <LoadingOverlay />}
        {isError && <ErrorOverlay />}
      </div>

      {/* Bottom info bar */}
      <div className="relative z-[1] flex items-center gap-1.5 px-2.5 py-2 bg-[rgba(0,0,0,0.35)] backdrop-blur-[6px] min-w-0">
        <span className="inline-flex shrink-0 px-1 py-0.5 rounded-[3px] bg-[rgba(255,255,255,0.1)] text-[rgba(245,240,232,0.6)] text-[0.58rem] font-bold tracking-[0.04em] uppercase leading-none">
          {badge}
        </span>
        <span className="text-[0.72rem] leading-[1.2] text-[rgba(245,240,232,0.8)] truncate min-w-0">
          {filename}
        </span>
      </div>

      {/* Remove button */}
      {onRemove && (
        <button
          type="button"
          className="absolute top-1.5 right-1.5 z-[3] grid h-[22px] w-[22px] place-items-center border-0 rounded-[6px] bg-[rgba(0,0,0,0.55)] text-[rgba(245,240,232,0.7)] cursor-pointer opacity-0 transition-[opacity,background] duration-[140ms] ease-linear group-hover/card:opacity-100 hover:bg-[rgba(0,0,0,0.75)] hover:text-[rgba(245,240,232,0.95)]"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}
