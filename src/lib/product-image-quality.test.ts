import { describe, expect, it } from "vitest";
import {
  readImageDimensions,
  validateProductImageQuality,
} from "./product-image-quality";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 17);
  view.setUint8(6, 8);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}

function webpHeader(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const storedWidth = width - 1;
  const storedHeight = height - 1;
  bytes[24] = storedWidth & 0xff;
  bytes[25] = (storedWidth >> 8) & 0xff;
  bytes[26] = (storedWidth >> 16) & 0xff;
  bytes[27] = storedHeight & 0xff;
  bytes[28] = (storedHeight >> 8) & 0xff;
  bytes[29] = (storedHeight >> 16) & 0xff;
  return bytes;
}

describe("product image quality", () => {
  it("reads PNG, JPEG, and WebP dimensions", () => {
    expect(readImageDimensions(pngHeader(1200, 900), "image/png")).toEqual({
      width: 1200,
      height: 900,
    });
    expect(readImageDimensions(jpegHeader(1500, 1000), "image/jpeg")).toEqual({
      width: 1500,
      height: 1000,
    });
    expect(readImageDimensions(webpHeader(1600, 1200), "image/webp")).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it("accepts crisp horizontal storefront product photos", () => {
    expect(validateProductImageQuality(pngHeader(1200, 900), "image/png")).toEqual({
      ok: true,
      dimensions: { width: 1200, height: 900 },
    });
  });

  it("rejects small product photos", () => {
    expect(
      validateProductImageQuality(pngHeader(900, 700), "image/png"),
    ).toEqual({
      ok: false,
      dimensions: { width: 900, height: 700 },
      error:
        "Product photos must be at least 1000x750px for crisp menu cards and social previews.",
    });
  });

  it("rejects product photos that are not a clean horizontal crop", () => {
    expect(
      validateProductImageQuality(pngHeader(1000, 1600), "image/png"),
    ).toEqual({
      ok: false,
      dimensions: { width: 1000, height: 1600 },
      error:
        "Use a horizontal product photo close to a 4:3 or 3:2 crop so it fits menu cards, product pages, and previews cleanly.",
    });
  });
});
