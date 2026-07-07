import Image from "next/image";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import { CustomerChat } from "@/components/customer-chat";
import { OrderBuilder } from "@/components/order-builder";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { bakery } from "@/lib/bakery-data";
import { getCutoffMessage, isAfterWeeklyCutoff } from "@/lib/cutoff";
import { getStorefrontData } from "@/lib/storefront-data";
import { formatCurrency } from "@/lib/utils";

export default async function Home() {
  const { menu, deliveryWindows } = await getStorefrontData();
  const afterCutoff = isAfterWeeklyCutoff();

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-stone-950">
          <Image
            src="/images/sourdough-hero.png"
            alt="Fresh sourdough loaves on a warm bakery counter"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-stone-950/78 via-stone-950/45 to-stone-950/10" />
          <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center px-4 py-16 sm:px-6 lg:px-8">
            <div className="max-w-2xl text-white">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#f5c28b]">
                Weekly bake drops in Canton, GA
              </p>
              <h1 className="mt-5 text-5xl font-black leading-[1.02] sm:text-6xl lg:text-7xl">
                {bakery.name}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-stone-100">
                Naturally leavened bread and small-batch add-ons delivered locally
                from a beginning cottage bakery with a careful weekly rhythm.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#order"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-[#a94334] px-5 text-base font-bold text-white transition hover:bg-[#8d372a]"
                >
                  Order this week
                </a>
                <a
                  href="#questions"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/35 bg-white/10 px-5 text-base font-bold text-white backdrop-blur transition hover:bg-white/20"
                >
                  Ask a question
                </a>
              </div>
              <div className="mt-8 grid gap-3 text-sm text-stone-100 sm:grid-cols-3">
                <span className="inline-flex items-center gap-2">
                  <CalendarClock size={18} /> Thursday cutoff
                </span>
                <span className="inline-flex items-center gap-2">
                  <Truck size={18} /> Local delivery
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck size={18} /> Stripe checkout
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#23443b] py-4 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span>{getCutoffMessage()}</span>
            <span>{bakery.deliveryPromise}</span>
          </div>
        </section>

        <section id="menu" className="bg-[#fffaf2] py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                  This week&apos;s menu
                </p>
                <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                  Bread plus small add-ons
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-stone-700">
                Every listing includes ingredients and allergens. The kitchen
                should not claim allergen-free preparation unless the legal
                process supports it.
              </p>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {menu.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm"
                >
                  {item.imageUrl ? (
                    <div className="relative h-44 bg-stone-100">
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className={`h-44 bg-gradient-to-br ${item.imageStyle}`} />
                  )}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-xl font-bold text-stone-950">
                        {item.name}
                      </h3>
                      <span className="shrink-0 rounded-sm bg-[#f7efe3] px-2 py-1 text-sm font-bold text-[#23443b]">
                        {formatCurrency(item.priceCents)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-700">
                      {item.description}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-stone-600">
                        Allergens: {item.allergens.join(", ")}
                      </span>
                      <span className="font-bold text-[#a94334]">
                        {item.remainingQuantity} left
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Products are prepared in a home kitchen as part of a planned
              Georgia cottage food business. Review listed ingredients and
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

        <section id="delivery" className="bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Delivery plan
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950 sm:text-4xl">
                Built around a manageable bake week
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                Orders close Thursday at 8:00 PM for next week. After the cutoff,
                customers can still send a request, but checkout pauses so the
                baker can protect capacity.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["1", "Order by Thursday", "Choose loaves, add-ons, and a delivery window."],
                ["2", "Bake drop fills", "Inventory counts down as customers reserve."],
                ["3", "Local delivery", "Delivery is checked against the Canton radius."],
              ].map(([step, title, body]) => (
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

        <section className="bg-[#f7efe3] py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
            <div className="lg:col-span-1">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
                Launch checklist
              </p>
              <h2 className="mt-3 text-3xl font-bold text-stone-950">
                Before going live
              </h2>
            </div>
            <div className="grid gap-3 lg:col-span-2">
              {bakery.complianceNotes.map((note) => (
                <div key={note} className="flex gap-3 rounded-md bg-white p-4">
                  <CheckCircle2 className="mt-0.5 text-[#23443b]" size={20} />
                  <p className="text-sm leading-6 text-stone-700">{note}</p>
                </div>
              ))}
              <div className="flex gap-3 rounded-md bg-white p-4">
                <MapPin className="mt-0.5 text-[#23443b]" size={20} />
                <p className="text-sm leading-6 text-stone-700">
                  Configure the exact delivery radius, delivery fee, and
                  delivery windows before accepting live payments.
                </p>
              </div>
            </div>
          </div>
        </section>

        <CustomerChat />

        <section className="bg-[#23443b] py-12 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div>
              <Sparkles size={22} className="text-[#f5c28b]" />
              <h2 className="mt-3 text-2xl font-bold">
                Ready for next week&apos;s bake?
              </h2>
              <p className="mt-1 text-sm text-stone-100">
                {bakery.name} is starting locally and intentionally.
              </p>
            </div>
            <a
              href="#order"
              className="inline-flex h-12 items-center justify-center rounded-md bg-white px-5 font-bold text-[#23443b] transition hover:bg-stone-100"
            >
              Build an order
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
