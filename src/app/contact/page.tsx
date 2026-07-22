import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircleQuestion, ShoppingBag, Truck } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { buildBreadcrumbList } from "@/lib/breadcrumbs";

const contactDescription =
  "Contact Luna & Lorelai's Sourdough for local delivery questions, order updates, ingredient questions, and Canton or Woodstock sourdough preorder help.";

export const metadata: Metadata = {
  title: "Contact",
  description: contactDescription,
  alternates: {
    canonical: "/contact",
  },
  openGraph: {
    title: "Contact Luna & Lorelai's Sourdough",
    description: contactDescription,
    url: `https://${bakery.domain}/contact`,
    siteName: bakery.name,
    images: [
      {
        url: "/images/sourdough-hero-og.jpg",
        width: 1200,
        height: 630,
        alt: "Fresh sourdough loaves from Luna & Lorelai's Sourdough",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact Luna & Lorelai's Sourdough",
    description: contactDescription,
    images: ["/images/sourdough-hero-og.jpg"],
  },
};

const contactReasons = [
  {
    title: "Before you order",
    body: "Ask about current menu items, listed ingredients, allergens, delivery ZIPs, or which loaf fits your plans.",
    icon: MessageCircleQuestion,
  },
  {
    title: "Delivery details",
    body: "Send apartment, gate, porch, or address corrections as soon as possible so delivery can be handled smoothly.",
    icon: Truck,
  },
  {
    title: "Order help",
    body: "Include your name, order email, Sunday delivery date, and what needs attention so the bakery can review it quickly.",
    icon: ShoppingBag,
  },
];

export default function ContactPage() {
  const siteUrl = `https://${bakery.domain}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      buildBreadcrumbList(
        [
          { name: "Home", href: "/" },
          { name: "Contact", href: "/contact" },
        ],
        siteUrl,
      ),
      {
        "@type": "ContactPage",
        "@id": `${siteUrl}/contact`,
        name: `Contact ${bakery.name}`,
        description: contactDescription,
        url: `${siteUrl}/contact`,
        about: {
          "@type": "Bakery",
          "@id": `${siteUrl}/#bakery`,
          name: bakery.name,
          email: bakery.orderEmail,
          areaServed: ["Canton, GA", "Woodstock, GA"],
          address: {
            "@type": "PostalAddress",
            addressLocality: "Canton",
            addressRegion: "GA",
            addressCountry: "US",
          },
        },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: bakery.orderEmail,
          areaServed: ["Canton, GA", "Woodstock, GA"],
          availableLanguage: "English",
        },
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
        <section className="border-b border-stone-200 bg-white py-14">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
              Contact the bakery
            </p>
            <h1 className="mt-3 text-4xl font-bold text-stone-950 sm:text-5xl">
              Questions about sourdough, delivery, or an order?
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-stone-700">
              Email {bakery.name} for local delivery questions, order updates,
              ingredient questions, and weekly preorder help around Canton and
              Woodstock, Georgia.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${bakery.orderEmail}`}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#23443b] px-5 text-base font-bold text-white transition hover:bg-[#1b352e]"
              >
                <Mail size={18} />
                {bakery.orderEmail}
              </a>
              <Link
                href="/#order"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-800 transition hover:bg-stone-50"
              >
                <ShoppingBag size={18} />
                Start an order
              </Link>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-5 px-4 sm:px-6 md:grid-cols-3 lg:px-8">
            {contactReasons.map((reason) => {
              const Icon = reason.icon;
              return (
                <article
                  key={reason.title}
                  className="rounded-md border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <Icon className="text-[#a94334]" size={22} />
                  <h2 className="mt-4 text-xl font-bold text-stone-950">
                    {reason.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    {reason.body}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="bg-white py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl gap-6 px-4 sm:px-6 md:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                What to include
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950">
                Help us answer quickly
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                For order-specific questions, include the email used at
                checkout, selected Sunday delivery time, and the correction or
                question. For allergy or ingredient questions, name the product
                you are considering before ordering.
              </p>
            </div>
            <div className="rounded-md border border-stone-200 bg-[#fffaf2] p-5">
              <p className="font-bold text-stone-950">Helpful links</p>
              <div className="mt-4 grid gap-3 text-sm font-semibold text-[#23443b]">
                <Link href="/#menu" className="underline">
                  View this week&apos;s menu
                </Link>
                <Link href="/sourdough-delivery-canton-ga" className="underline">
                  Check Canton delivery details
                </Link>
                <Link href="/sourdough-delivery-woodstock-ga" className="underline">
                  Check Woodstock delivery details
                </Link>
                <Link href="/policies/allergen-cottage-food" className="underline">
                  Read allergen and cottage-food notice
                </Link>
                <Link href="/policies/terms" className="underline">
                  Read order terms
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
