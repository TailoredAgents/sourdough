import Link from "next/link";
import { AdminDashboard } from "@/components/admin-dashboard";

export const metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <>
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-bold text-[#23443b]">
            L&L Sourdough
          </Link>
          <Link href="/" className="text-sm font-semibold text-stone-700">
            Back to storefront
          </Link>
        </div>
      </div>
      <AdminDashboard />
    </>
  );
}
