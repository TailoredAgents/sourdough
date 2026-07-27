import Link from "next/link";
import { BreadClubAdminDashboard } from "@/components/bread-club-admin-dashboard";
import { requireAdmin } from "@/lib/admin-auth";
import { getBreadClubAdminData } from "@/lib/bread-club/admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bread Club Admin",
  robots: { index: false, follow: false },
};

export default async function BreadClubAdminPage() {
  const admin = await requireAdmin();
  const data = await getBreadClubAdminData();

  return (
    <>
      <header className="border-b border-stone-200 bg-white print:hidden">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <Link href="/admin" className="font-bold text-[#23443b]">
            Luna &amp; Lorelai&apos;s Sourdough admin
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-stone-500 sm:inline">
              {admin.email}
            </span>
            <Link href="/admin" className="text-sm font-semibold text-stone-700">
              Main admin
            </Link>
            <Link
              href="/bread-club?preview=1"
              className="text-sm font-semibold text-[#23443b]"
            >
              Owner checkout test
            </Link>
            <Link href="/" className="text-sm font-semibold text-stone-700">
              Storefront
            </Link>
            <form action="/auth/logout" method="post">
              <button className="text-sm font-semibold text-[#a94334]" type="submit">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>
      <BreadClubAdminDashboard initialData={data} />
    </>
  );
}
