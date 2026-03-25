import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";

const primarySans = Inter({
  variable: "--font-primary-sans",
  subsets: ["latin"],
});

const primarySerif = Newsreader({
  variable: "--font-primary-serif",
  subsets: ["latin"],
});

const primaryMono = JetBrains_Mono({
  variable: "--font-primary-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Relay AI — AI Workspace for Chat, Research & Coding",
    template: "%s — Relay AI",
  },
  description:
    "An open-source AI workspace combining chat, deep research, image generation, document creation, and remote coding sessions — powered by Claude.",
  metadataBase: new URL(
    process.env.APP_URL || "https://relay-ai-delta.vercel.app",
  ),
  keywords: [
    "AI workspace",
    "Claude",
    "AI chat",
    "coding agent",
    "research assistant",
    "image generation",
    "GitHub integration",
    "MCP",
    "E2B sandbox",
    "Anthropic",
  ],
  authors: [{ name: "Relay AI Contributors" }],
  creator: "Relay AI",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Relay AI",
    title: "Relay AI — AI Workspace for Chat, Research & Coding",
    description:
      "Chat, research, generate images, create documents, and run code in cloud sandboxes — all in one AI workspace powered by Claude.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay AI — AI Workspace for Chat, Research & Coding",
    description:
      "Chat, research, generate images, create documents, and run code in cloud sandboxes — all in one AI workspace powered by Claude.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${primarySans.variable} ${primarySerif.variable} ${primaryMono.variable} antialiased`}>
        <QueryProvider>{children}</QueryProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          toastOptions={{
            style: {
              background: "rgba(30,28,24,0.98)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(245,240,232,0.88)",
              fontSize: "0.86rem",
              zIndex: 9999,
            },
          }}
        />
      </body>
    </html>
  );
}
