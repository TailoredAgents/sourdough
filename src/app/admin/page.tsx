import Link from "next/link";
import { AdminDashboard } from "@/components/admin-dashboard";
import { requireAdmin } from "@/lib/admin-auth";
import { getAiKnowledgeEntriesData } from "@/lib/ai-knowledge-admin";
import { getCustomerMessagesData } from "@/lib/customer-messages";
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
    { deliverySettings, deliveryWindows, menu, products, weeklyMenu },
    customerMessages,
    aiKnowledgeEntries,
    orders,
    weeklyMenus,
  ] = await Promise.all([
    getStorefrontData(),
    getCustomerMessagesData(),
    getAiKnowledgeEntriesData(),
    getAdminOrdersData(),
    getWeeklyMenusData(),
  ]);

  return (
    <>
      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-bold text-[#23443b]">
            Luna &amp; Lorelai&apos;s Sourdough
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-stone-500 sm:inline">
              {admin.email}
            </span>
            <Link href="/" className="text-sm font-semibold text-stone-700">
              Back to storefront
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
        customerMessages={customerMessages}
        deliverySettings={deliverySettings}
        deliveryWindows={deliveryWindows}
        menu={menu}
        orders={orders}
        products={products}
        weeklyMenu={weeklyMenu}
        weeklyMenus={weeklyMenus}
      />
    </>
  );
}
