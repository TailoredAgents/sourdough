import Link from "next/link";
import { AdminDashboard } from "@/components/admin-dashboard";
import { requireAdmin } from "@/lib/admin-auth";
import { getAiKnowledgeEntriesData } from "@/lib/ai-knowledge-admin";
import { getCustomerMessagesPageData } from "@/lib/customer-messages";
import { getAdminOrdersData } from "@/lib/order-admin";
import { getStorefrontData, getWeeklyMenusData } from "@/lib/storefront-data";

export const metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  const [
    { deliverySettings, deliveryWindows, menu, orderingWeeks, products, weeklyMenu },
    customerMessagesPage,
    aiKnowledgeEntries,
    orders,
    weeklyMenus,
  ] = await Promise.all([
    getStorefrontData(),
    getCustomerMessagesPageData(),
    getAiKnowledgeEntriesData(),
    getAdminOrdersData(),
    getWeeklyMenusData(),
  ]);

  return (
    <>
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:px-6 lg:px-8">
          <Link href="/" className="w-full font-bold text-[#23443b] sm:w-auto">
            Luna &amp; Lorelai&apos;s Sourdough
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="hidden text-xs text-stone-500 sm:inline">
              {admin.email}
            </span>
            <Link href="/" className="text-sm font-semibold text-stone-700">
              Back to storefront
            </Link>
            <Link
              href="/admin/bread-club"
              className="text-sm font-semibold text-[#23443b]"
            >
              Bread Club
            </Link>
            <form action="/auth/logout" method="post">
              <button className="text-sm font-semibold text-[#a94334]" type="submit">
                Logout
              </button>
            </form>
          </div>
        </div>
      </div>
      <AdminDashboard
        aiKnowledgeEntries={aiKnowledgeEntries}
        customerMessages={customerMessagesPage.messages}
        customerMessagesHasMore={customerMessagesPage.hasMore}
        customerMessagesTotal={customerMessagesPage.total}
        deliverySettings={deliverySettings}
        deliveryWindows={deliveryWindows}
        menu={menu}
        orderingWeeks={orderingWeeks}
        orders={orders}
        products={products}
        weeklyMenu={weeklyMenu}
        weeklyMenus={weeklyMenus}
      />
    </>
  );
}
