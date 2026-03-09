import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
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
  title: "Relay AI",
  description: "General-purpose AI workspace for chat, research, files, and remote coding",
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
      </body>
    </html>
  );
}
