import Link from "next/link";

export const metadata = {
  title: "Not Authorized",
};

export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf2] px-4">
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#a94334]">
          Access denied
        </p>
        <h1 className="mt-3 text-3xl font-bold text-stone-950">
          This account is not an admin
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-700">
          Ask the site owner to add this email to `ADMIN_EMAILS` or to the
          `admin_users` table.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/admin/login"
            className="inline-flex h-11 items-center justify-center rounded-md bg-[#23443b] px-4 text-sm font-bold text-white"
          >
            Try another email
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-bold text-stone-700"
          >
            Storefront
          </Link>
        </div>
      </div>
    </main>
  );
}
