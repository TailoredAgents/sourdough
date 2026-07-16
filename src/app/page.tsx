import Image from "next/image";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { CustomerChat } from "@/components/customer-chat";
import { DeliveryZipChecker } from "@/components/delivery-zip-checker";
import { NotifySignup } from "@/components/notify-signup";
import { OrderBuilder } from "@/components/order-builder";
import { ProductUnavailableOverlay } from "@/components/product-unavailable-overlay";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { getCutoffMessage, isAfterWeeklyCutoff } from "@/lib/cutoff";
import {
  canOrderMenuProduct,
  getMenuProductAvailabilityLabel,
} from "@/lib/menu-availability";
import { getProductGuidance } from "@/lib/product-guidance";
import { productPath } from "@/lib/product-slugs";
import { getStorefrontData } from "@/lib/storefront-data";
import { absoluteImageUrl } from "@/lib/url";
import { formatCurrency } from "@/lib/utils";

export default async function Home() {
  const { menu, deliveryWindows, weeklyMenu, deliverySettings } = await getStorefrontData();
  const afterCutoff = isAfterWeeklyCutoff(weeklyMenu?.orderCutoffAt);
  const siteUrl = `https://${bakery.domain}`;
  const cutoffMessage = getCutoffMessage(weeklyMenu?.orderCutoffAt);
  const orderAction = afterCutoff ? "Send a request" : "Order this week";
  const serviceZipCopy = deliverySettings.allowedPostalCodes.join(", ");
  const customerHighlights = [
    [
      "Naturally leavened",
      "Slow-fermented loaves with a crisp crust, tender crumb, and real sourdough character.",
    ],
    [
      "Clear weekly quantities",
      "See what is left before you order, so sold-out items never feel like a surprise.",
    ],
    [
      "Local delivery windows",
      "Pick an available delivery window and add porch, gate, or drop-off notes at checkout.",
    ],
  ];
  const faqs = [
    {
      question: "Where do you deliver?",
      answer: `Local delivery is available around Canton and Woodstock, Georgia in selected ZIP codes: ${serviceZipCopy}. Enter your ZIP code at checkout to confirm availability and delivery fee.`,
    },
    {
      question: "When should I order?",
      answer:
        "Order while the weekly menu is open and before the posted cutoff. If checkout is closed, you can still send an availability request from the order form.",
    },
    {
      question: "Can I see ingredients and allergens before ordering?",
      answer:
        "Yes. Each menu item lists ingredients and allergens. Products are prepared in a home kitchen and are not represented as allergen-free.",
    },
    {
      question: "Do you ship sourdough?",
      answer:
        "Shipping is not currently available. Orders are for local Georgia delivery in the Canton and Woodstock area.",
    },
    {
      question: "How can I ask a question before ordering?",
      answer: `Use the question box on this page or email ${bakery.orderEmail}. For order-specific details, add a note before checkout so the bakery can review it with your order.`,
    },
  ];
  const orderSteps = [
    [
      "1",
      "Build your order",
      "Choose loaves, add-ons, and quantities while they are available.",
    ],
    [
      "2",
      "Confirm delivery",
      "Enter your ZIP code and pick an available delivery window.",
    ],
    afterCutoff
      ? [
          "3",
          "Send your request",
          "Submit your details and we will reply with current availability.",
        ]
      : [
          "3",
          "Check out securely",
          "Pay online and receive your order confirmation by email.",
        ],
  ];
  const selectionGuide = menu.slice(0, 4).map((item) => {
    const guidance = getProductGuidance(item);
    return {
      id: item.id,
      name: item.name,
      href: `#select-${item.id}`,
      detailsHref: productPath(item),
      price: formatCurrency(item.priceCents),
      remainingQuantity: item.remainingQuantity,
      canOrder: canOrderMenuProduct(item),
      bestFor: guidance.bestFor,
      status: getMenuProductAvailabilityLabel(item),
    };
  });
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        "@id": `${siteUrl}/#faq`,
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
      {
        "@type": "Bakery",
        "@id": `${siteUrl}/#bakery`,
        name: bakery.name,
        url: siteUrl,
        image: `${siteUrl}/images/sourdough-hero.jpg`,
        logo: `${siteUrl}/images/luna-lorelais-logo-square-180.png`,
        email: bakery.orderEmail,
        priceRange: "$$",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: bakery.orderEmail,
          areaServed: ["Canton, GA", "Woodstock, GA"],
          availableLanguage: "English",
        },
        address: {
          "@type": "PostalAddress",
          addressLocality: "Canton",
          addressRegion: "GA",
          addressCountry: "US",
        },
        areaServed: deliverySettings.allowedPostalCodes.map((postalCode) => ({
          "@type": "PostalCodeArea",
          postalCode,
        })),
        servesCuisine: "Bakery",
        makesOffer: menu.map((item) => ({
          "@type": "Offer",
          itemOffered: {
            "@type": "Product",
            name: item.name,
            description: item.description,
          },
          price: (item.priceCents / 100).toFixed(2),
          priceCurrency: "USD",
          availability:
            canOrderMenuProduct(item)
              ? "https://schema.org/InStock"
              : item.unavailable
                ? "https://schema.org/OutOfStock"
                : "https://schema.org/SoldOut",
        })),
      },
      {
        "@type": "ItemList",
        "@id": `${siteUrl}/#weekly-menu`,
        name: "Weekly sourdough menu",
        itemListElement: menu.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Product",
            name: item.name,
            description: item.description,
            image: absoluteImageUrl(item.imageUrl, "/images/sourdough-hero.jpg", siteUrl),
            offers: {
              "@type": "Offer",
              price: (item.priceCents / 100).toFixed(2),
              priceCurrency: "USD",
              availability:
                canOrderMenuProduct(item)
                  ? "https://schema.org/InStock"
                  : item.unavailable
                    ? "https://schema.org/OutOfStock"
                    : "https://schema.org/SoldOut",
              url: `${siteUrl}${productPath(item)}`,
            },
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
      <main id="main-content">
        <section className="relative min-h-[calc(100svh-12rem)] overflow-hidden bg-stone-950 sm:min-h-[calc(100svh-10rem)]">
          <Image
            src="/images/sourdough-hero.jpg"
            alt="Fresh sourdough loaves on a warm bakery counter"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/78 via-stone-950/45 to-stone-950/10" />
          <div className="relative mx-auto flex min-h-[calc(100svh-12rem)] max-w-7xl items-center px-4 py-16 sm:min-h-[calc(100svh-10rem)] sm:px-6 lg:px-8">
            <div className="max-w-2xl text-white">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#f5c28b]">
                Local sourdough delivery in Canton & Woodstock, GA
              </p>
              <h1 className="mt-5 text-5xl font-black leading-[1.02] sm:text-6xl lg:text-7xl">
                {bakery.name}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-stone-100">
                Order naturally leavened sourdough loaves and small-batch add-ons
                for weekly local delivery around Canton and Woodstock.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#order"
                  data-analytics-event="order_cta_click"
                  data-analytics-label={orderAction}
                  data-analytics-section="hero"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                >
                  {orderAction}
                </a>
                <a
                  href="#menu"
                  data-analytics-event="view_menu_click"
                  data-analytics-label="View this week's menu"
                  data-analytics-section="hero"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/35 bg-white/10 px-5 text-base font-bold text-white backdrop-blur transition hover:bg-white/20"
                >
                  View this week&apos;s menu
                </a>
              </div>
              <div className="mt-8 grid gap-3 text-sm text-stone-100 sm:grid-cols-3">
                <span className="inline-flex items-center gap-2">
                  <CalendarClock size={18} /> Weekly preorders
                </span>
                <span className="inline-flex items-center gap-2">
                  <MapPin size={18} /> ZIPs {serviceZipCopy}
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck size={18} />{" "}
                  {afterCutoff ? "Requests open" : "Secure checkout"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#23443b] py-4 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span>{cutoffMessage}</span>
            <span>{bakery.deliveryPromise}</span>
          </div>
        </section>

        <section id="menu" className="scroll-mt-32 bg-[#fffaf2] py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                  This week&apos;s menu
                </p>
                <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                  Choose your bread and add-ons
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-stone-700">
                Prices, remaining quantities, and allergens are listed up front.
                {` ${deliverySettings.serviceAreaCopy}`}
              </p>
            </div>

            {menu.length ? (
              <>
                <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {menu.map((item) => {
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
                            data-analytics-section="menu_card_image"
                            className="relative block h-44 overflow-hidden bg-stone-100"
                          >
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              fill
                              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
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
                            data-analytics-section="menu_card_image"
                            aria-label={`View ${item.name} details`}
                            className={`relative block h-44 overflow-hidden bg-gradient-to-br ${item.imageStyle}`}
                          >
                            {item.unavailable ? <ProductUnavailableOverlay /> : null}
                          </Link>
                        )}
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <Link
                              href={productPath(item)}
                              data-analytics-event="product_detail_click"
                              data-analytics-product-id={item.id}
                              data-analytics-product-name={item.name}
                              data-analytics-section="menu_card_title"
                              className="text-xl font-bold text-stone-950 hover:text-[#a94334]"
                            >
                              {item.name}
                            </Link>
                            <span className="shrink-0 rounded-sm bg-[#f7efe3] px-2 py-1 text-sm font-bold text-[#23443b]">
                              {formatCurrency(item.priceCents)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-stone-700">
                            {item.description}
                          </p>
                          <p className="mt-3 rounded-sm bg-[#fffaf2] px-3 py-2 text-sm leading-6 text-stone-700">
                            <span className="font-bold text-stone-950">Best for:</span>{" "}
                            {guidance.bestFor}
                          </p>
                          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                            <span className="text-stone-600">
                              Allergens: {item.allergens.join(", ")}
                            </span>
                            <span className="font-bold text-[#a94334]">
                              {getMenuProductAvailabilityLabel(item)}
                            </span>
                          </div>
                          {canOrderMenuProduct(item) ? (
                            <a
                              href={`#select-${item.id}`}
                              data-analytics-event="choose_item_click"
                              data-analytics-product-id={item.id}
                              data-analytics-product-name={item.name}
                              data-analytics-section="menu_card"
                              className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white transition hover:bg-[#1b352e]"
                            >
                              Choose this item
                            </a>
                          ) : (
                            <span className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-stone-200 px-4 text-sm font-bold text-stone-600">
                              {item.unavailable ? "Currently unavailable" : "Sold out this week"}
                            </span>
                          )}
                          <Link
                            href={productPath(item)}
                            data-analytics-event="product_detail_click"
                            data-analytics-product-id={item.id}
                            data-analytics-product-name={item.name}
                            data-analytics-section="menu_card_details"
                            className="ml-3 inline-flex h-10 items-center justify-center text-sm font-bold text-[#23443b] underline"
                          >
                            View details
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {selectionGuide.length ? (
                  <div className="mt-8 rounded-md border border-stone-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                          Quick pick guide
                        </p>
                        <h3 className="mt-2 text-2xl font-bold text-stone-950">
                          Not sure what to order?
                        </h3>
                      </div>
                      <p className="max-w-xl text-sm leading-6 text-stone-700">
                        Compare the best uses, price, and weekly quantity before
                        adding items to your order.
                      </p>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {selectionGuide.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-3 rounded-md border border-stone-200 bg-[#fffaf2] p-4 sm:grid-cols-[1fr_auto]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={item.detailsHref}
                                data-analytics-event="product_detail_click"
                                data-analytics-product-id={item.id}
                                data-analytics-product-name={item.name}
                                data-analytics-section="quick_pick"
                                className="font-bold text-stone-950 hover:text-[#a94334]"
                              >
                                {item.name}
                              </Link>
                              <span className="rounded-sm bg-white px-2 py-1 text-xs font-bold text-[#23443b]">
                                {item.price}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-stone-700">
                              {item.bestFor}
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[#a94334]">
                              {item.status}
                            </p>
                          </div>
                          {item.canOrder ? (
                            <a
                              href={item.href}
                              data-analytics-event="choose_item_click"
                              data-analytics-product-id={item.id}
                              data-analytics-product-name={item.name}
                              data-analytics-section="quick_pick"
                              className="inline-flex h-10 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white transition hover:bg-[#1b352e]"
                            >
                              Choose
                            </a>
                          ) : (
                            <span className="inline-flex h-10 items-center justify-center rounded-md bg-stone-200 px-4 text-sm font-bold text-stone-600">
                              {item.status}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-8 rounded-md border border-stone-200 bg-white p-5 text-sm leading-6 text-stone-700">
                Ordering is not open yet. Join the bake alert list below and
                we&apos;ll email you when the next menu opens.
              </div>
            )}

            <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Products are prepared in a home kitchen under Georgia cottage
              food rules. Review listed ingredients and
              allergens before ordering; {bakery.name} does not claim
              allergen-free preparation. See the{" "}
              <Link
                href="/policies/allergen-cottage-food"
                className="font-bold underline"
              >
                allergen and cottage food notice
              </Link>
              .
            </div>
          </div>
        </section>

        <section id="delivery" className="scroll-mt-32 bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                How ordering works
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Pick your items, choose delivery, checkout
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                Preorder while this week&apos;s menu is open. If online checkout is
                closed, you can still send a request and we&apos;ll reply with
                availability before anything is confirmed.
              </p>
              <div className="mt-6 max-w-lg">
                <DeliveryZipChecker source="homepage-ordering-section" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {orderSteps.map(([step, title, body]) => (
                <div
                  key={step}
                  className="rounded-md border border-stone-200 bg-[#fffaf2] p-5"
                >
                  <span className="flex size-9 items-center justify-center rounded-md bg-[#23443b] font-bold text-white">
                    {step}
                  </span>
                  <h3 className="mt-4 font-bold text-stone-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-700">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <OrderBuilder
          deliveryWindows={deliveryWindows}
          afterCutoff={afterCutoff}
          menu={menu}
        />

        <section className="bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Never miss a bake
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Get notified when the next menu opens
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                If this week&apos;s checkout is closed, sold out, or you&apos;re
                comparing options, join the bake alert list. It keeps future
                menus easy to catch without checking the site every day.
              </p>
            </div>
            <NotifySignup source="homepage-bake-alert-section" />
          </div>
        </section>

        <section className="bg-[#fffaf2] py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Local bread, simple ordering
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Fresh sourdough without guessing
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                The weekly menu shows prices, availability, delivery details, and
                allergen information before checkout. You can choose quickly and
                still know exactly what happens next.
              </p>
              <div className="mt-6 rounded-md border border-stone-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-1 shrink-0 text-[#a94334]" size={20} />
                  <div>
                    <h3 className="font-bold text-stone-950">
                      Canton and Woodstock delivery
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      Current delivery ZIP codes: {serviceZipCopy}. Enter your
                      ZIP at checkout to confirm delivery and see the fee.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {customerHighlights.map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-md border border-stone-200 bg-white p-5"
                >
                  <CheckCircle2 className="text-[#23443b]" size={20} />
                  <h3 className="mt-3 font-bold text-stone-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-700">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-32 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Sourdough ordering FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
              Common questions before you order
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

        <CustomerChat />

        <section className="bg-[#23443b] py-12 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div>
              <Sparkles size={22} className="text-[#f5c28b]" />
              <h2 className="mt-3 text-2xl font-bold">
                Ready for fresh sourdough?
              </h2>
              <p className="mt-1 text-sm text-stone-100">
                Choose from this week&apos;s menu and reserve local delivery.
              </p>
            </div>
            <a
              href="#order"
              data-analytics-event="order_cta_click"
              data-analytics-label={orderAction}
              data-analytics-section="footer_cta"
              className="inline-flex h-12 items-center justify-center rounded-md bg-white px-5 font-bold text-[#23443b] transition hover:bg-stone-100"
            >
              {orderAction}
            </a>
            <div className="w-full max-w-xl">
              <NotifySignup compact source="footer-cta" />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
