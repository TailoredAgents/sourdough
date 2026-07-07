import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default function OrderSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4">
      <div className="max-w-lg rounded-md border border-stone-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto text-[#23443b]" size={44} />
        <h1 className="mt-5 text-3xl font-bold text-stone-950">
          Order received
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          Thank you for supporting Luna &amp; Lorelai&apos;s Sourdough. If this was a demo checkout,
          no payment was collected. With Stripe configured, this page appears
          after secure payment.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
