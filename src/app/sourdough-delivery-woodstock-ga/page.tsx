import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, MapPin, ShoppingBag, Truck } from "lucide-react";
import { DeliveryZipChecker } from "@/components/delivery-zip-checker";
import { NotifySignup } from "@/components/notify-signup";
import { ProductUnavailableOverlay } from "@/components/product-unavailable-overlay";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";
import { getCutoffMessage } from "@/lib/cutoff";
import {
  canOrderMenuProduct,
  getMenuProductAvailabilityLabel,
} from "@/lib/menu-availability";
import { getProductGuidance } from "@/lib/product-guidance";
import { productPath } from "@/lib/product-slugs";
import { serviceAreaPath } from "@/lib/service-areas";
import { getStorefrontData } from "@/lib/storefront-data";
import { formatCurrency } from "@/lib/utils";

const pagePath = "/sourdough-delivery-woodstock-ga";
const pageUrl = `https://${bakery.domain}${pagePath}`;
const woodstockZipSet = new Set(["30188", "30189"]);

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sourdough Delivery in Woodstock, GA",
  description:
    "Order naturally leavened sourdough bread and small-batch add-ons for local delivery in Woodstock, Georgia from Luna & Lorelai's Sourdough.",
  alternates: {
    canonical: pagePath,
  },
  openGraph: {
    title: "Sourdough Delivery in Woodstock, GA",
    description:
      "Weekly sourdough preorders, local delivery windows, and small-batch add-ons for Woodstock, Georgia.",
    url: pageUrl,
    siteName: bakery.name,
    images: [
      {
        url: "/images/sourdough-hero-og.jpg",
        width: 1200,
        height: 630,
        alt: "Fresh sourdough bread for local delivery in Woodstock, Georgia",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sourdough Delivery in Woodstock, GA",
    description:
      "Weekly sourdough preorders and local delivery for Woodstock, Georgia.",
    images: ["/images/sourdough-hero-og.jpg"],
  },
};

export default async function WoodstockDeliveryPage() {
  const { menu, weeklyMenu, deliverySettings, deliveryWindows } =
    await getStorefrontData();
  const woodstockPostalCodes = deliverySettings.allowedPostalCodes.filter((zip) =>
    woodstockZipSet.has(zip),
  );
  const serviceZipCopy = woodstockPostalCodes.length
    ? woodstockPostalCodes.join(", ")
    : "30188, 30189";
  const siteUrl = `https://${bakery.domain}`;
  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Sourdough Delivery in Woodstock, GA", href: pagePath },
  ];
  const faqs = [
    {
      question: "Can I order sourdough delivery in Woodstock, GA?",
      answer: `Yes. ${bakery.name} offers weekly local delivery in Woodstock, Georgia for ZIP codes ${serviceZipCopy}.`,
    },
    {
      question: "Which Woodstock ZIP codes are eligible?",
      answer: `The current Woodstock delivery ZIP codes are ${serviceZipCopy}. Enter your ZIP code before ordering so the site can confirm availability and delivery fee.`,
    },
    {
      question: "How do I place a Woodstock delivery order?",
      answer:
        "Choose from the weekly menu, check your ZIP, pick an available delivery window, and complete secure checkout or send an availability request if checkout is closed.",
    },
    {
      question: "Do you ship sourdough outside Georgia?",
      answer:
        "Shipping is not currently available. Orders are for local Georgia delivery around Canton and Woodstock.",
    },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      buildBreadcrumbList(breadcrumbs, siteUrl),
      {
        "@type": "Bakery",
        "@id": `${siteUrl}/#bakery`,
        name: bakery.name,
        url: siteUrl,
        image: `${siteUrl}/images/sourdough-hero.jpg`,
        priceRange: "$$",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Canton",
          addressRegion: "GA",
          addressCountry: "US",
        },
        areaServed: woodstockPostalCodes.map((postalCode) => ({
          "@type": "PostalCodeArea",
          postalCode,
        })),
        servesCuisine: "Bakery",
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: faqs.map((faq) => ({
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
        <section className="relative overflow-hidden bg-stone-950">
          <Image
            src="/images/sourdough-hero.jpg"
            alt="Fresh sourdough loaves for delivery in Woodstock, Georgia"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/82 via-stone-950/52 to-stone-950/20" />
          <div className="relative mx-auto grid min-h-[540px] max-w-7xl items-center px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl text-white">
              <nav
                aria-label="Breadcrumb"
                className="mb-5 flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-200"
              >
                {breadcrumbs.map((item, index) => (
                  <span key={item.href} className="inline-flex items-center gap-2">
                    {index > 0 ? <span className="text-stone-400">/</span> : null}
                    {index === breadcrumbs.length - 1 ? (
                      <span>{item.name}</span>
                    ) : (
                      <Link href={item.href} className="hover:text-white">
                        {item.name}
                      </Link>
                    )}
                  </span>
                ))}
              </nav>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#f5c28b]">
                Woodstock, Georgia sourdough delivery
              </p>
              <h1 className="mt-5 text-5xl font-black leading-tight sm:text-6xl">
                Fresh sourdough delivered locally in Woodstock, GA
              </h1>
              <p className="mt-6 text-lg leading-8 text-stone-100">
                Preorder naturally leavened loaves, cinnamon sourdough, crackers,
                and small-batch add-ons from {bakery.name}.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/#order"
                  data-analytics-event="order_cta_click"
                  data-analytics-label="Order from this week's menu"
                  data-analytics-section="woodstock_delivery_hero"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                >
                  <ShoppingBag size={18} />
                  Order from this week&apos;s menu
                </Link>
                <Link
                  href="/#menu"
                  data-analytics-event="view_menu_click"
                  data-analytics-label="View available loaves"
                  data-analytics-section="woodstock_delivery_hero"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/35 bg-white/10 px-5 text-base font-bold text-white backdrop-blur transition hover:bg-white/20"
                >
                  View available loaves
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-stone-200 bg-white py-6">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 text-sm font-semibold text-stone-700 sm:px-6 md:grid-cols-3 lg:px-8">
            <span className="inline-flex items-center gap-2">
              <MapPin className="text-[#a94334]" size={18} />
              Woodstock ZIPs: {serviceZipCopy}
            </span>
            <span className="inline-flex items-center gap-2">
              <Truck className="text-[#a94334]" size={18} />
              {deliveryWindows.length} delivery windows available
            </span>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="text-[#a94334]" size={18} />
              {getCutoffMessage(weeklyMenu?.orderCutoffAt)}
            </span>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Woodstock delivery check
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Confirm your ZIP before ordering
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                Check your Woodstock ZIP, then continue into the weekly order
                form with the ZIP already filled in.
              </p>
              <div className="mt-6">
                <DeliveryZipChecker source="woodstock-delivery-page" city="Woodstock" />
              </div>
              <div className="mt-5 rounded-md border border-stone-200 bg-white p-5">
                <p className="text-sm font-bold text-stone-950">
                  Woodstock ZIP pages
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {woodstockPostalCodes.map((postalCode) => (
                    <Link
                      key={postalCode}
                      href={serviceAreaPath(postalCode)}
                      className="inline-flex h-9 items-center rounded-md bg-[#fffaf2] px-3 text-sm font-bold text-[#23443b] underline"
                    >
                      ZIP {postalCode}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {menu.slice(0, 4).map((item) => {
                const guidance = getProductGuidance(item);
                return (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm"
                  >
                    {item.imageUrl ? (
                      <Link
                        href={productPath(item)}
                        data-analytics-event="product_detail_click"
                        data-analytics-product-id={item.id}
                        data-analytics-product-name={item.name}
                        data-analytics-section="woodstock_delivery_menu_image"
                        className="relative block h-44 overflow-hidden bg-stone-100"
                      >
                        <Image
                          src={item.imageUrl}
                          alt={item.name}
                          fill
                          sizes="(min-width: 768px) 25vw, 100vw"
                          className="object-cover"
                        />
                        {item.unavailable ? <ProductUnavailableOverlay /> : null}
                      </Link>
                    ) : (
                      <Link
                        href={productPath(item)}
                        data-analytics-event="product_detail_click"
                        data-analytics-product-id={item.id}
                        data-analytics-product-name={item.name}
                        data-analytics-section="woodstock_delivery_menu_image"
                        aria-label={`View ${item.name} details`}
                        className={`relative block h-44 overflow-hidden bg-gradient-to-br ${item.imageStyle}`}
                      >
                        {item.unavailable ? <ProductUnavailableOverlay /> : null}
                      </Link>
                    )}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={productPath(item)}
                          data-analytics-event="product_detail_click"
                          data-analytics-product-id={item.id}
                          data-analytics-product-name={item.name}
                          data-analytics-section="woodstock_delivery_menu_title"
                          className="font-bold text-stone-950 hover:text-[#a94334]"
                        >
                          {item.name}
                        </Link>
                        <span className="rounded-sm bg-[#f7efe3] px-2 py-1 text-sm font-bold text-[#23443b]">
                          {formatCurrency(item.priceCents)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-stone-700">
                        {item.description}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-stone-600">
                        <span className="font-semibold text-stone-950">Best for:</span>{" "}
                        {guidance.bestFor}
                      </p>
                      <p className="mt-3 text-sm font-bold text-[#a94334]">
                        {getMenuProductAvailabilityLabel(item)}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {canOrderMenuProduct(item) ? (
                          <Link
                            href={`/#select-${item.id}`}
                            data-analytics-event="choose_item_click"
                            data-analytics-product-id={item.id}
                            data-analytics-product-name={item.name}
                            data-analytics-section="woodstock_delivery_menu"
                            className="inline-flex h-10 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white transition hover:bg-[#1b352e]"
                          >
                            Choose this item
                          </Link>
                        ) : (
                          <span className="inline-flex h-10 items-center justify-center rounded-md bg-stone-200 px-4 text-sm font-bold text-stone-600">
                            {item.unavailable ? "Currently unavailable" : "Sold out"}
                          </span>
                        )}
                        <Link
                          href={productPath(item)}
                          data-analytics-event="product_detail_click"
                          data-analytics-product-id={item.id}
                          data-analytics-product-name={item.name}
                          data-analytics-section="woodstock_delivery_menu_details"
                          className="text-sm font-bold text-[#23443b] underline"
                        >
                          Details
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Delivery questions
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Woodstock sourdough delivery FAQ
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                These answers cover the local delivery questions customers ask
                before placing a Woodstock sourdough order.
              </p>
              <div className="mt-6">
                <NotifySignup source="woodstock-seo-page" />
              </div>
            </div>
            <div
              id="faq"
              className="scroll-mt-32 divide-y divide-stone-200 rounded-md border border-stone-200 bg-[#fffaf2]"
            >
              {faqs.map((faq) => (
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
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#f5c28b]">
                Weekly Woodstock delivery
              </p>
              <h2 className="mt-3 text-3xl font-bold">
                Ready to reserve fresh sourdough?
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-100">
                Build your order from the current menu, check your Woodstock ZIP,
                and choose an available local delivery window.
              </p>
            </div>
            <Link
              href="/#order"
              data-analytics-event="order_cta_click"
              data-analytics-label="Order from this week's menu"
              data-analytics-section="woodstock_delivery_footer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-base font-bold text-[#23443b] transition hover:bg-stone-100"
            >
              <ShoppingBag size={18} />
              Order this week
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
