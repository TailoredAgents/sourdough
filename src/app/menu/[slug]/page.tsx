import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ShoppingBag, Truck } from "lucide-react";
import { NotifySignup } from "@/components/notify-signup";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";
import { isAfterWeeklyCutoff } from "@/lib/cutoff";
import { getProductGuidance } from "@/lib/product-guidance";
import { productPath, productSlug, findMenuProductBySlug } from "@/lib/product-slugs";
import {
  getActiveMenuData,
  getActiveWeeklyMenuData,
  getDeliverySettingsData,
} from "@/lib/storefront-data";
import { absoluteImageUrl } from "@/lib/url";
import { formatCurrency } from "@/lib/utils";

type ProductRouteProps = {
  params: Promise<{
    slug: string;
  }>;
};

async function getProductForSlug(slug: string) {
  const menu = await getActiveMenuData();
  return findMenuProductBySlug(menu, slug);
}

export async function generateStaticParams() {
  const menu = await getActiveMenuData();
  return menu.map((item) => ({ slug: productSlug(item) }));
}

export async function generateMetadata({
  params,
}: ProductRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductForSlug(slug);
  if (!product) return {};

  const title = `${product.name} in Canton, GA`;
  const description = `${product.description} Order ${product.name.toLowerCase()} from ${bakery.name} for local delivery around Canton, Georgia.`;
  const fallbackSocialImage = "/images/sourdough-hero-og.jpg";
  const socialImage = absoluteImageUrl(product.imageUrl, fallbackSocialImage);

  return {
    title,
    description,
    alternates: {
      canonical: productPath(product),
    },
    openGraph: {
      title,
      description,
      url: `https://${bakery.domain}${productPath(product)}`,
      siteName: bakery.name,
      images: [
        {
          url: socialImage,
          alt: product.name,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default async function ProductPage({ params }: ProductRouteProps) {
  const { slug } = await params;
  const [product, deliverySettings, weeklyMenu] = await Promise.all([
    getProductForSlug(slug),
    getDeliverySettingsData(),
    getActiveWeeklyMenuData(),
  ]);

  if (!product) notFound();

  const siteUrl = `https://${bakery.domain}`;
  const orderHref = `/#select-${product.id}`;
  const afterCutoff = isAfterWeeklyCutoff(weeklyMenu?.orderCutoffAt);
  const productAction = afterCutoff ? "Request this item" : "Choose this item";
  const guidance = getProductGuidance(product);
  const deliveryZipCopy = deliverySettings.allowedPostalCodes.join(", ");
  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Weekly menu", href: "/#menu" },
    { name: product.name, href: productPath(product) },
  ];
  const productFaqs = [
    {
      question: `How do I order ${product.name}?`,
      answer:
        product.remainingQuantity > 0
          ? `Use the order button on this page to add ${product.name} from the weekly menu, then confirm your ZIP code, delivery address, delivery window, and checkout details.`
          : `${product.name} is sold out this week. Join the bake alert list to hear when future menus open.`,
    },
    {
      question: `Where is ${product.name} available for delivery?`,
      answer: `${product.name} is available for local delivery around Canton, Georgia in selected ZIP codes: ${deliveryZipCopy}. Enter your full delivery address at checkout to confirm eligibility and delivery fee.`,
    },
    {
      question: `What allergens are listed for ${product.name}?`,
      answer: `${product.name} lists these allergens: ${product.allergens.join(", ")}. Products are prepared in a home kitchen and are not represented as allergen-free.`,
    },
    {
      question: `What is ${product.name} best for?`,
      answer: guidance.bestFor,
    },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      buildBreadcrumbList(breadcrumbs, siteUrl),
      {
        "@type": "Product",
        name: product.name,
        description: product.description,
        image: absoluteImageUrl(product.imageUrl, "/images/sourdough-hero.jpg", siteUrl),
        brand: {
          "@type": "Brand",
          name: bakery.name,
        },
        category: product.category === "bread" ? "Sourdough bread" : "Bakery add-on",
        offers: {
          "@type": "Offer",
          price: (product.priceCents / 100).toFixed(2),
          priceCurrency: "USD",
          availability:
            product.remainingQuantity > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/SoldOut",
          url: `${siteUrl}${productPath(product)}`,
          areaServed: deliverySettings.allowedPostalCodes.join(", "),
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${siteUrl}${productPath(product)}#faq`,
        mainEntity: productFaqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };

  return (
    <>
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <main id="main-content" className="bg-[#fffaf2]">
        <section className="border-b border-stone-200 bg-white py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="relative min-h-80 overflow-hidden rounded-md bg-stone-100">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  priority
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <div className={`absolute inset-0 bg-gradient-to-br ${product.imageStyle}`} />
              )}
            </div>

            <div className="flex flex-col justify-center">
              <nav
                aria-label="Breadcrumb"
                className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-600"
              >
                {breadcrumbs.map((item, index) => (
                  <span key={item.href} className="inline-flex items-center gap-2">
                    {index > 0 ? <span className="text-stone-400">/</span> : null}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-stone-950">{item.name}</span>
                    ) : (
                      <Link href={item.href} className="hover:text-[#a94334]">
                        {item.name}
                      </Link>
                    )}
                  </span>
                ))}
              </nav>
              <Link
                href="/#menu"
                className="inline-flex items-center gap-2 text-sm font-bold text-[#a94334]"
              >
                <ArrowLeft size={16} />
                Back to weekly menu
              </Link>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                {product.category === "bread" ? "Sourdough loaf" : "Small-batch add-on"}
              </p>
              <h1 className="mt-3 text-4xl font-black leading-tight text-stone-950 sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
                {product.description}
              </p>
              <p className="mt-4 rounded-md bg-[#fffaf2] px-4 py-3 text-sm leading-6 text-stone-700">
                <span className="font-bold text-stone-950">Best for:</span>{" "}
                {guidance.bestFor}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="rounded-sm bg-[#f7efe3] px-3 py-2 text-xl font-black text-[#23443b]">
                  {formatCurrency(product.priceCents)}
                </span>
                <span className="rounded-sm bg-white px-3 py-2 text-sm font-bold text-[#a94334]">
                  {product.remainingQuantity > 0
                    ? `${product.remainingQuantity} left this week`
                    : "Sold out this week"}
                </span>
              </div>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                {product.remainingQuantity > 0 ? (
                  <Link
                    href={orderHref}
                    data-analytics-event="choose_item_click"
                    data-analytics-product-id={product.id}
                    data-analytics-product-name={product.name}
                    data-analytics-section="product_page"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                  >
                    <ShoppingBag size={18} />
                    {productAction}
                  </Link>
                ) : (
                  <NotifySignup compact source={`sold-out-top-${productSlug(product)}`} />
                )}
                <Link
                  href="/#questions"
                  data-analytics-event="ask_question_click"
                  data-analytics-product-id={product.id}
                  data-analytics-product-name={product.name}
                  data-analytics-section="product_page"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-800 transition hover:bg-stone-50"
                >
                  Ask a question
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
            <article className="rounded-md border border-stone-200 bg-white p-5">
              <CheckCircle2 className="text-[#23443b]" size={22} />
              <h2 className="mt-4 text-xl font-bold text-stone-950">
                Ingredients
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                {product.ingredients.join(", ")}
              </p>
            </article>

            <article className="rounded-md border border-stone-200 bg-white p-5">
              <AlertTriangle className="text-[#a94334]" size={22} />
              <h2 className="mt-4 text-xl font-bold text-stone-950">
                Allergens
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Contains or includes: {product.allergens.join(", ")}. Products are
                prepared in a home kitchen and are not represented as allergen-free.
              </p>
            </article>

            <article className="rounded-md border border-stone-200 bg-white p-5">
              <Truck className="text-[#23443b]" size={22} />
              <h2 className="mt-4 text-xl font-bold text-stone-950">
                Local delivery
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Available for local delivery around Canton, Georgia. Current ZIPs:
                {" "}
                {deliverySettings.allowedPostalCodes.join(", ")}.
              </p>
            </article>
          </div>
        </section>

        <section className="bg-white py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
            <article className="rounded-md border border-stone-200 bg-[#fffaf2] p-5">
              <h2 className="text-xl font-bold text-stone-950">
                Serving ideas
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                {guidance.serving}
              </p>
            </article>
            <article className="rounded-md border border-stone-200 bg-[#fffaf2] p-5">
              <h2 className="text-xl font-bold text-stone-950">
                Storage tip
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                {guidance.storage}
              </p>
            </article>
          </div>
        </section>

        <section id="faq" className="scroll-mt-32 bg-[#fffaf2] py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Product questions
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950">
                Before you choose {product.name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Check delivery, availability, listed allergens, and serving fit
                before adding this item to your weekly order.
              </p>
            </div>
            <div className="divide-y divide-stone-200 rounded-md border border-stone-200 bg-white">
              {productFaqs.map((faq) => (
                <details key={faq.question} className="group p-5">
                  <summary className="cursor-pointer list-none font-bold text-stone-950">
                    <span className="flex items-center justify-between gap-4">
                      {faq.question}
                      <span className="text-[#a94334] transition group-open:rotate-45">
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-stone-700">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#23443b] py-12 text-white">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#f5c28b]">
                Ready to order?
              </p>
              <h2 className="mt-3 text-3xl font-bold">
                {product.remainingQuantity > 0
                  ? afterCutoff
                    ? `Request ${product.name} for this week's bake`
                    : `Add ${product.name} to this week's delivery order`
                  : `${product.name} is sold out this week`}
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-100">
                {product.remainingQuantity > 0
                  ? afterCutoff
                    ? "Return to the weekly order form with this item in view, then confirm your ZIP code, delivery window, and request details."
                    : "Return to the weekly order form with this item in view, then confirm your ZIP code, delivery window, and checkout details."
                  : "Join the bake alert list to hear when future menus open, or ask a question before choosing another item."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_auto] lg:justify-end">
              {product.remainingQuantity > 0 ? (
                <Link
                  href={orderHref}
                  data-analytics-event="choose_item_click"
                  data-analytics-product-id={product.id}
                  data-analytics-product-name={product.name}
                  data-analytics-section="product_page_footer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-base font-bold text-[#23443b] transition hover:bg-stone-100"
                >
                  <ShoppingBag size={18} />
                  {productAction}
                </Link>
              ) : (
                <NotifySignup compact source={`sold-out-${productSlug(product)}`} />
              )}
              <Link
                href="/#questions"
                data-analytics-event="ask_question_click"
                data-analytics-product-id={product.id}
                data-analytics-product-name={product.name}
                data-analytics-section="product_page_footer"
                className="inline-flex h-12 items-center justify-center rounded-md border border-white/35 bg-white/10 px-5 text-base font-bold text-white transition hover:bg-white/20"
              >
                Ask a question
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
