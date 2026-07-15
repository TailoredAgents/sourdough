export type ImageDimensions = {
  width: number;
  height: number;
};

export type ProductImageQualityResult =
  | {
      ok: true;
      dimensions: ImageDimensions;
    }
  | {
      ok: false;
      error: string;
      dimensions?: ImageDimensions;
    };

const minProductImageWidth = 1000;
const minProductImageHeight = 750;
const minProductImageAspectRatio = 1.15;
const maxProductImageAspectRatio = 1.7;

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function readUInt16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || ascii(bytes, 1, 4) !== "PNG") return null;
  return {
    width: readUInt32BE(bytes, 16),
    height: readUInt32BE(bytes, 20),
  };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    const marker = bytes[offset + 1];
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2) return null;

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: readUInt16BE(bytes, offset + 5),
        width: readUInt16BE(bytes, offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = ascii(bytes, 12, 16);
  if (chunkType === "VP8 ") {
    return {
      width: readUInt16LE(bytes, 26) & 0x3fff,
      height: readUInt16LE(bytes, 28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L") {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  if (chunkType === "VP8X") {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27),
    };
  }

  return null;
}

export function readImageDimensions(
  bytes: Uint8Array,
  contentType: string,
): ImageDimensions | null {
  if (contentType === "image/png") return readPngDimensions(bytes);
  if (contentType === "image/jpeg") return readJpegDimensions(bytes);
  if (contentType === "image/webp") return readWebpDimensions(bytes);
  return null;
}

export function validateProductImageQuality(
  bytes: Uint8Array,
  contentType: string,
): ProductImageQualityResult {
  const dimensions = readImageDimensions(bytes, contentType);
  if (!dimensions) {
    return {
      ok: false,
      error: "Image dimensions could not be read. Try a different JPEG, PNG, or WebP file.",
    };
  }

  if (
    dimensions.width < minProductImageWidth ||
    dimensions.height < minProductImageHeight
  ) {
    return {
      ok: false,
      dimensions,
      error: `Product photos must be at least ${minProductImageWidth}x${minProductImageHeight}px for crisp menu cards and social previews.`,
    };
  }

  const aspectRatio = dimensions.width / dimensions.height;
  if (
    aspectRatio < minProductImageAspectRatio ||
    aspectRatio > maxProductImageAspectRatio
  ) {
    return {
      ok: false,
      dimensions,
      error:
        "Use a horizontal product photo close to a 4:3 or 3:2 crop so it fits menu cards, product pages, and previews cleanly.",
    };
  }

  return { ok: true, dimensions };
}
