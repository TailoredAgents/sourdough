import { getStripe } from "./stripe";
import { getSupabaseAdminClient } from "./supabase";

type ProductCatalogRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  price_cents: number;
  active: boolean;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_cents: number | null;
};

export type StripeCatalogSyncItem = {
  productId: string;
  name: string;
  active: boolean;
  priceCents: number;
  stripeProductId: string;
  stripePriceId: string | null;
  createdProduct: boolean;
  createdPrice: boolean;
};

function productMetadata(product: ProductCatalogRow) {
  return {
    supabase_product_id: product.id,
    slug: product.slug,
    category: product.category,
  };
}

async function findStripeProductId(product: ProductCatalogRow) {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

  if (product.stripe_product_id) {
    try {
      const existingProduct = await stripe.products.retrieve(product.stripe_product_id);
      if (!existingProduct.deleted) return existingProduct.id;
    } catch (error) {
      console.warn("[stripe:catalog] saved Stripe product not found", {
        productId: product.id,
        stripeProductId: product.stripe_product_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const search = await stripe.products.search({
    query: `metadata['supabase_product_id']:'${product.id}'`,
    limit: 1,
  });

  return search.data[0]?.id ?? null;
}

async function findReusablePriceId(stripeProductId: string, priceCents: number) {
  const stripe = getStripe();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

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

export async function syncStripeProductCatalog(): Promise<StripeCatalogSyncItem[]> {
  const stripe = getStripe();
  const supabase = getSupabaseAdminClient();

  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!supabase) throw new Error("Supabase admin client is not configured.");

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, name, category, description, price_cents, active, stripe_product_id, stripe_price_id, stripe_price_cents",
    )
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const products = (data ?? []) as ProductCatalogRow[];
  const results: StripeCatalogSyncItem[] = [];

  for (const product of products) {
    let createdProduct = false;
    let createdPrice = false;
    let stripeProductId = await findStripeProductId(product);

    if (!stripeProductId) {
      const created = await stripe.products.create({
        name: product.name,
        description: product.description,
        active: product.active,
        metadata: productMetadata(product),
      });
      stripeProductId = created.id;
      createdProduct = true;
    } else {
      await stripe.products.update(stripeProductId, {
        name: product.name,
        description: product.description,
        active: product.active,
        metadata: productMetadata(product),
      });
    }

    let stripePriceId: string | null = product.stripe_price_id;
    const hasCurrentSavedPrice =
      product.stripe_price_id && product.stripe_price_cents === product.price_cents;

    if (product.active && !hasCurrentSavedPrice) {
      stripePriceId = await findReusablePriceId(stripeProductId, product.price_cents);

      if (!stripePriceId) {
        const created = await stripe.prices.create({
          product: stripeProductId,
          currency: "usd",
          unit_amount: product.price_cents,
          nickname: product.name,
          metadata: productMetadata(product),
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

    const update = {
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      stripe_price_cents: product.active && stripePriceId ? product.price_cents : product.stripe_price_cents,
      stripe_synced_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("products")
      .update(update)
      .eq("id", product.id);

    if (updateError) throw new Error(updateError.message);

    results.push({
      productId: product.id,
      name: product.name,
      active: product.active,
      priceCents: product.price_cents,
      stripeProductId,
      stripePriceId,
      createdProduct,
      createdPrice,
    });
  }

  return results;
}
