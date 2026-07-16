import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, MapPin, ShoppingBag, Truck } from "lucide-react";
import { NotifySignup } from "@/components/notify-signup";
import { ProductUnavailableOverlay } from "@/components/product-unavailable-overlay";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";
import { normalizePostalCode } from "@/lib/delivery";
import {
  canOrderMenuProduct,
  getMenuProductAvailabilityLabel,
} from "@/lib/menu-availability";
import {
  isAllowedServiceArea,
  serviceAreaDeliveryPagePath,
  serviceAreaDescription,
  serviceAreaName,
  serviceAreaPath,
  serviceAreaTitle,
} from "@/lib/service-areas";
import { getProductGuidance } from "@/lib/product-guidance";
import { productPath } from "@/lib/product-slugs";
import {
  getActiveMenuData,
  getDeliverySettingsData,
} from "@/lib/storefront-data";
import { formatCurrency } from "@/lib/utils";

type ServiceAreaPageProps = {
  params: Promise<{
    zip: string;
  }>;
};

async function getServiceArea(zip: string) {
  const postalCode = normalizePostalCode(zip);
  const deliverySettings = await getDeliverySettingsData();

  if (!postalCode || !isAllowedServiceArea(postalCode, deliverySettings)) {
    return null;
  }

  return {
    postalCode,
    deliverySettings,
  };
}

export async function generateStaticParams() {
  const deliverySettings = await getDeliverySettingsData();
  return deliverySettings.allowedPostalCodes.map((zip) => ({ zip }));
}

export async function generateMetadata({
  params,
}: ServiceAreaPageProps): Promise<Metadata> {
  const { zip } = await params;
  const serviceArea = await getServiceArea(zip);
  if (!serviceArea) return {};

  const title = serviceAreaTitle(serviceArea.postalCode);
  const description = serviceAreaDescription(serviceArea.postalCode);
  const path = serviceAreaPath(serviceArea.postalCode);

  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: `https://${bakery.domain}${path}`,
      siteName: bakery.name,
      images: [
        {
          url: "/images/sourdough-hero-og.jpg",
          width: 1200,
          height: 630,
          alt: `${bakery.name} sourdough delivery in ZIP ${serviceArea.postalCode}`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/sourdough-hero-og.jpg"],
    },
  };
}

export default async function ServiceAreaPage({ params }: ServiceAreaPageProps) {
  const { zip } = await params;
  const serviceArea = await getServiceArea(zip);
  if (!serviceArea) notFound();

  const { postalCode, deliverySettings } = serviceArea;
  const menu = await getActiveMenuData();
  const siteUrl = `https://${bakery.domain}`;
  const pagePath = serviceAreaPath(postalCode);
  const pageTitle = serviceAreaTitle(postalCode);
  const description = serviceAreaDescription(postalCode);
  const orderHref = `/?zip=${encodeURIComponent(postalCode)}#order`;
  const deliveryPagePath = serviceAreaDeliveryPagePath(postalCode);
  const deliveryAreaName = serviceAreaName(postalCode);
  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: `${deliveryAreaName} delivery`, href: deliveryPagePath },
    { name: `ZIP ${postalCode}`, href: pagePath },
  ];
  const faqs = [
    {
      question: `Does ${bakery.name} deliver sourdough to ZIP ${postalCode}?`,
      answer: `Yes. ZIP ${postalCode} is currently listed in the local delivery area for weekly sourdough preorders.`,
    },
    {
      question: "How do I order for this ZIP?",
      answer:
        "Use the weekly order form, confirm the delivery ZIP and fee, choose an available delivery window, and complete checkout or send an availability request if checkout is closed.",
    },
    {
      question: "Can every address in this ZIP receive delivery?",
      answer:
        "The site confirms delivery eligibility before checkout. Enter the full delivery address in the order form so the bakery can review the details.",
    },
    {
      question: "Is shipping available outside the delivery area?",
      answer:
        "Shipping is not currently available. Orders are for local Georgia delivery in the configured ZIP codes around Canton and Woodstock.",
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
        email: bakery.orderEmail,
        image: `${siteUrl}/images/sourdough-hero.jpg`,
        address: {
          "@type": "PostalAddress",
          addressLocality: "Canton",
          addressRegion: "GA",
          addressCountry: "US",
        },
        areaServed: {
          "@type": "PostalCodeArea",
          postalCode,
        },
        priceRange: "$$",
        servesCuisine: "Bakery",
      },
      {
        "@type": "FAQPage",
        "@id": `${siteUrl}${pagePath}#faq`,
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
        <section className="border-b border-stone-200 bg-white py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="relative min-h-80 overflow-hidden rounded-md bg-stone-100">
              <Image
                src="/images/sourdough-hero.jpg"
                alt={`Fresh sourdough for delivery in ZIP ${postalCode}`}
                fill
                priority
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover"
              />
            </div>
            <div className="flex flex-col justify-center">
              <nav
                aria-label="Breadcrumb"
                className="mb-5 flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-600"
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
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                {deliveryAreaName} sourdough delivery
              </p>
              <h1 className="mt-3 text-4xl font-black leading-tight text-stone-950 sm:text-5xl">
                {pageTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
                {description} Check the weekly menu, confirm delivery, and
                reserve an available delivery window while quantities remain.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
                  <MapPin className="text-[#a94334]" size={20} />
                  <p className="mt-2 text-sm font-bold text-stone-950">
                    ZIP {postalCode}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-700">
                    Currently eligible for local delivery checks.
                  </p>
                </div>
                <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
                  <Truck className="text-[#23443b]" size={20} />
                  <p className="mt-2 text-sm font-bold text-stone-950">
                    {formatCurrency(deliverySettings.deliveryFeeCents)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-700">
                    Delivery fee shown before checkout.
                  </p>
                </div>
                <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-4">
                  <CheckCircle2 className="text-[#23443b]" size={20} />
                  <p className="mt-2 text-sm font-bold text-stone-950">
                    Weekly preorder
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-700">
                    Choose from the current weekly menu.
                  </p>
                </div>
              </div>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={orderHref}
                  data-analytics-event="order_cta_click"
                  data-analytics-label={`Order for ZIP ${postalCode}`}
                  data-analytics-section="service_area_hero"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                >
                  <ShoppingBag size={18} />
                  Order for ZIP {postalCode}
                </Link>
                <Link
                  href={deliveryPagePath}
                  className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-800 transition hover:bg-stone-50"
                >
                  View delivery details
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Weekly menu
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950">
                Available for ZIP {postalCode} delivery
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Product cards show price, remaining quantity, ingredients, and
                allergens before checkout. The order form will prefill ZIP{" "}
                {postalCode} from this page.
              </p>
              <div className="mt-6">
                <NotifySignup source={`service-area-${postalCode}`} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {menu.slice(0, 4).map((item) => {
                const guidance = getProductGuidance(item);
                const chooseHref = `/?zip=${encodeURIComponent(postalCode)}#select-${item.id}`;
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
                        data-analytics-section="service_area_menu_image"
                        className="relative block h-36 overflow-hidden bg-stone-100"
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
                        data-analytics-section="service_area_menu_image"
                        aria-label={`View ${item.name} details`}
                        className={`relative block h-36 overflow-hidden bg-gradient-to-br ${item.imageStyle}`}
                      >
                        {item.unavailable ? <ProductUnavailableOverlay /> : null}
                      </Link>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={productPath(item)}
                          data-analytics-event="product_detail_click"
                          data-analytics-product-id={item.id}
                          data-analytics-product-name={item.name}
                          data-analytics-section="service_area_menu_title"
                          className="font-bold text-stone-950 hover:text-[#a94334]"
                        >
                          {item.name}
                        </Link>
                        <span className="shrink-0 rounded-sm bg-[#f7efe3] px-2 py-1 text-sm font-bold text-[#23443b]">
                          {formatCurrency(item.priceCents)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-stone-700">
                        {guidance.bestFor}
                      </p>
                      <p className="mt-3 text-sm font-bold text-[#a94334]">
                        {getMenuProductAvailabilityLabel(item)}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {canOrderMenuProduct(item) ? (
                          <Link
                            href={chooseHref}
                            data-analytics-event="choose_item_click"
                            data-analytics-product-id={item.id}
                            data-analytics-product-name={item.name}
                            data-analytics-section="service_area_menu"
                            className="inline-flex h-10 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white transition hover:bg-[#1b352e]"
                          >
                            Choose for ZIP {postalCode}
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
                          data-analytics-section="service_area_menu_details"
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

        <section id="faq" className="scroll-mt-32 bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              ZIP {postalCode} delivery FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold text-stone-950">
              Before you order
            </h2>
            <div className="mt-8 divide-y divide-stone-200 rounded-md border border-stone-200 bg-[#fffaf2]">
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
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#f5c28b]">
                Ready for local delivery?
              </p>
              <h2 className="mt-3 text-3xl font-bold">
                Start an order for ZIP {postalCode}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-100">
                Your ZIP will be filled in when you open the weekly order form.
              </p>
            </div>
            <Link
              href={orderHref}
              data-analytics-event="order_cta_click"
              data-analytics-label={`Order for ZIP ${postalCode}`}
              data-analytics-section="service_area_footer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-base font-bold text-[#23443b] transition hover:bg-stone-100"
            >
              <ShoppingBag size={18} />
              Order for ZIP {postalCode}
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
