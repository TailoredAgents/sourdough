import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Confirm Bread Club Sign-In",
  robots: { index: false, follow: false },
};

function isValidMagicToken(token: string) {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

export default async function ConfirmBreadClubAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; access?: string }>;
}) {
  const params = await searchParams;
  const token = params.token || "";
  const valid = isValidMagicToken(token) && params.access !== "invalid";

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="bg-[#fffaf2] px-4 py-14 sm:px-6">
        <section className="mx-auto max-w-xl rounded-md border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#23443b] text-white">
            {valid ? <ShieldCheck size={24} /> : <KeyRound size={24} />}
          </div>
          <h1 className="mt-5 text-3xl font-bold text-stone-950">
            {valid ? "Open your Bread Club" : "This sign-in link is invalid"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-700">
            {valid
              ? "For your security, the email link is not used until you press the button below. Each link works once."
              : "Request a fresh secure link from the Bread Club member page."}
          </p>
          {valid ? (
            <form
              action="/api/bread-club/auth/callback"
              method="post"
              className="mt-6"
            >
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#a94334] px-5 text-sm font-bold text-white"
              >
                <ShieldCheck size={17} />
                Continue securely
              </button>
            </form>
          ) : (
            <Link
              href="/bread-club/manage"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-[#23443b] px-5 text-sm font-bold text-white"
            >
              Request a new link
            </Link>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
