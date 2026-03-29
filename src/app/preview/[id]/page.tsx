import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: { filename: true, mediaType: true },
  });
  if (!attachment || attachment.mediaType !== "text/html") {
    return { title: "Not Found" };
  }
  return { title: `${attachment.filename} — Relay AI` };
}

export default async function PreviewPage({ params }: Props) {
  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: { filename: true, mediaType: true },
  });

  if (!attachment || attachment.mediaType !== "text/html") {
    notFound();
  }

  return (
    <div className="flex h-dvh flex-col bg-[#1e1c18]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 rounded-[6px] bg-[rgba(212,112,73,0.15)] px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-[rgba(212,112,73,0.9)]">
            HTML
          </span>
          <span className="text-[0.8rem] text-[rgba(245,240,232,0.8)] truncate">{attachment.filename}</span>
        </div>
        <a
          href="https://relay-ai-delta.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[0.7rem] text-[rgba(245,240,232,0.4)] no-underline hover:text-[rgba(245,240,232,0.6)] transition-colors"
        >
          Powered by Relay AI
        </a>
      </div>

      {/* Iframe */}
      <iframe
        src={`/api/attachments/${id}/public-content`}
        sandbox="allow-scripts"
        title={attachment.filename}
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}
