import { readFileSync, existsSync } from "node:fs";
import process from "node:process";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function metadata(product) {
  return {
    supabase_product_id: product.id,
    slug: product.slug,
    category: product.category,
  };
}

async function findStripeProductId(stripe, product) {
  if (product.stripe_product_id) {
    try {
      const existingProduct = await stripe.products.retrieve(product.stripe_product_id);
      if (!existingProduct.deleted) return existingProduct.id;
    } catch (error) {
      console.warn(
        `[stripe:catalog] saved product missing for ${product.name}: ${error.message}`,
      );
    }
  }

  const search = await stripe.products.search({
    query: `metadata['supabase_product_id']:'${product.id}'`,
    limit: 1,
  });

  return search.data[0]?.id ?? null;
}

async function findReusablePriceId(stripe, stripeProductId, priceCents) {
  const prices = await stripe.prices.list({
    product: stripeProductId,
    active: true,
    limit: 100,
  });

  const matchingPrice = prices.data.find(
    (price) =>
      price.currency === "usd" &&
      price.unit_amount === priceCents &&
      price.type === "one_time",
  );

  return matchingPrice?.id ?? null;
}

async function findCurrentSavedPriceId(stripe, product, stripeProductId) {
  if (!product.stripe_price_id || product.stripe_price_cents !== product.price_cents) {
    return null;
  }

  try {
    const price = await stripe.prices.retrieve(product.stripe_price_id);
    const priceProductId =
      typeof price.product === "string" ? price.product : price.product?.id;
    const matchesProduct = priceProductId === stripeProductId;

    return price.currency === "usd" &&
      price.unit_amount === product.price_cents &&
      price.type === "one_time" &&
      matchesProduct
      ? price.id
      : null;
  } catch (error) {
    console.warn(
      `[stripe:catalog] saved price missing for ${product.name}: ${error.message}`,
    );
    return null;
  }
}

loadEnvFile(".env.local");

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2026-06-24.dahlia",
});
const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const { data, error } = await supabase
  .from("products")
  .select(
    "id, slug, name, category, description, price_cents, active, stripe_product_id, stripe_price_id, stripe_price_cents",
  )
  .order("name", { ascending: true });

if (error) throw new Error(error.message);

const products = data ?? [];
const results = [];

for (const product of products) {
  let createdProduct = false;
  let createdPrice = false;
  let stripeProductId = await findStripeProductId(stripe, product);

  if (!stripeProductId) {
    const created = await stripe.products.create({
      name: product.name,
      description: product.description,
      active: product.active,
      metadata: metadata(product),
    });
    stripeProductId = created.id;
    createdProduct = true;
  } else {
    await stripe.products.update(stripeProductId, {
      name: product.name,
      description: product.description,
      active: product.active,
      metadata: metadata(product),
    });
  }

  let stripePriceId = product.active
    ? await findCurrentSavedPriceId(stripe, product, stripeProductId)
    : product.stripe_price_id;

  if (product.active && !stripePriceId) {
    stripePriceId = await findReusablePriceId(stripe, stripeProductId, product.price_cents);

    if (!stripePriceId) {
      const created = await stripe.prices.create({
        product: stripeProductId,
        currency: "usd",
        unit_amount: product.price_cents,
        nickname: product.name,
        metadata: metadata(product),
      });
      stripePriceId = created.id;
      createdPrice = true;
    }
  }

  if (product.active && stripePriceId) {
    await stripe.products.update(stripeProductId, {
      default_price: stripePriceId,
    });
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      stripe_price_cents:
        product.active && stripePriceId ? product.price_cents : product.stripe_price_cents,
      stripe_synced_at: new Date().toISOString(),
    })
    .eq("id", product.id);

  if (updateError) throw new Error(updateError.message);

  results.push({
    name: product.name,
    active: product.active,
    price: `$${(product.price_cents / 100).toFixed(2)}`,
    stripeProductId,
    stripePriceId,
    createdProduct,
    createdPrice,
  });
}

console.table(results);
console.log(`Synced ${results.length} Stripe catalog products.`);
