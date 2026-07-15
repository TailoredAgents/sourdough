import type { MetadataRoute } from "next";
import { bakery } from "@/lib/bakery-data";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: bakery.name,
    short_name: "L&L Sourdough",
    description:
      "Weekly sourdough loaves and small-batch add-ons for local delivery around Canton, Georgia.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffaf2",
    theme_color: "#23443b",
    categories: ["food", "shopping", "lifestyle"],
    icons: [
      {
        src: "/images/luna-lorelais-logo-square-180.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/luna-lorelais-logo-square.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
