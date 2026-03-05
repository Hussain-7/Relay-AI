import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const primarySans = Space_Grotesk({
  variable: "--font-primary-sans",
  subsets: ["latin"],
});

const primaryMono = JetBrains_Mono({
  variable: "--font-primary-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Endless Dev",
  description: "General-purpose research, coding, and MCP agent platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${primarySans.variable} ${primaryMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
