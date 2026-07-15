import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const failures = [];

const requiredAssets = [
  {
    path: "public/images/sourdough-hero.jpg",
    type: "jpeg",
    minWidth: 1600,
    minHeight: 650,
  },
  {
    path: "public/images/sourdough-hero-og.jpg",
    type: "jpeg",
    minWidth: 1200,
    minHeight: 630,
  },
  {
    path: "public/images/luna-lorelais-logo-square-180.png",
    type: "png",
    width: 180,
    height: 180,
  },
  {
    path: "public/images/luna-lorelais-logo-square.png",
    type: "png",
    width: 512,
    height: 512,
  },
  ...[
    "classic-country-loaf",
    "rosemary-garlic-loaf",
    "cinnamon-swirl-sourdough",
    "sourdough-starter-crackers",
    "whipped-honey-butter",
  ].map((slug) => ({
    path: `public/images/products/${slug}.webp`,
    type: "webp",
    minWidth: 1000,
    minHeight: 750,
  })),
];

const forbiddenStarterAssets = [
  "public/file.svg",
  "public/globe.svg",
  "public/images/luna-lorelais-logo.png",
  "public/images/sourdough-hero.png",
  "public/next.svg",
  "public/vercel.svg",
  "public/window.svg",
];

function formatList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function readPngDimensions(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L") {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  return null;
}

function readDimensions(path, type) {
  const buffer = readFileSync(path);
  if (type === "png") return readPngDimensions(buffer);
  if (type === "jpeg") return readJpegDimensions(buffer);
  if (type === "webp") return readWebpDimensions(buffer);
  return null;
}

for (const asset of requiredAssets) {
  if (!existsSync(asset.path)) {
    failures.push(`${asset.path} is missing.`);
    continue;
  }

  const dimensions = readDimensions(asset.path, asset.type);
  if (!dimensions) {
    failures.push(`${asset.path} is not a readable ${asset.type} image.`);
    continue;
  }

  if (asset.width && dimensions.width !== asset.width) {
    failures.push(`${asset.path} must be ${asset.width}px wide, got ${dimensions.width}px.`);
  }
  if (asset.height && dimensions.height !== asset.height) {
    failures.push(`${asset.path} must be ${asset.height}px tall, got ${dimensions.height}px.`);
  }
  if (asset.minWidth && dimensions.width < asset.minWidth) {
    failures.push(
      `${asset.path} must be at least ${asset.minWidth}px wide, got ${dimensions.width}px.`,
    );
  }
  if (asset.minHeight && dimensions.height < asset.minHeight) {
    failures.push(
      `${asset.path} must be at least ${asset.minHeight}px tall, got ${dimensions.height}px.`,
    );
  }
}

for (const assetPath of forbiddenStarterAssets) {
  if (existsSync(assetPath)) {
    failures.push(`${assetPath} should be removed from the production public assets.`);
  }
}

if (failures.length) {
  console.error("Asset readiness check failed:");
  console.error(formatList(failures));
  process.exit(1);
}

console.log("Asset readiness check passed.");
