import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relay AI",
    short_name: "Relay AI",
    description:
      "An AI workspace combining chat, deep research, image generation, document creation, and remote coding sessions — powered by Claude.",
    start_url: "/chat/new",
    display: "standalone",
    background_color: "#1e1d1b",
    theme_color: "#1e1d1b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
