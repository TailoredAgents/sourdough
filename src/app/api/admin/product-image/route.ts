import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { validateProductImageQuality } from "@/lib/product-image-quality";
import { getSupabaseAdminClient } from "@/lib/supabase";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;

function safeFileName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() || "jpg";
  const base = name
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${base || "product"}-${Date.now()}.${extension}`;
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin authorization is required." },
      { status: 401 },
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const productId = String(formData.get("productId") || "new-product");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }

  if (!allowedTypes.has(file.type)) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG, or WebP image." },
      { status: 400 },
    );
  }

  if (file.size > maxFileSize) {
    return NextResponse.json(
      { error: "Image must be 5 MB or smaller." },
      { status: 400 },
    );
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const quality = validateProductImageQuality(imageBytes, file.type);
  if (!quality.ok) {
    return NextResponse.json({ error: quality.error }, { status: 400 });
  }

  const safeProductId = productId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const path = `${safeProductId || "new-product"}/${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return NextResponse.json({
    imageUrl: data.publicUrl,
    width: quality.dimensions.width,
    height: quality.dimensions.height,
  });
}
