import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Heimdall", short_name: "Heimdall",
    description: "The guardian layer for onchain agents on Robinhood Chain.",
    start_url: "/", display: "standalone", background_color: "#F7F9FF", theme_color: "#3355FF",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }, { src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
