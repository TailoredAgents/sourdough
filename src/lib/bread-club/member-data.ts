import { getSupabaseAdminClient } from "@/lib/supabase";
import type { DeliveryAddress } from "@/lib/types";
import { getBreadClubCatalogData } from "./data";
import type {
  BreadClubMemberData,
  BreadClubMemberFulfillment,
  BreadClubSelection,
} from "./types";

function singleRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function getBreadClubMemberData(
  membershipId: string,
): Promise<BreadClubMemberData | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("bread_club_memberships")
    .select(
      "id, customer_id, plan_id, status, route_fee_cents, route_band_key, delivery_address, delivery_instructions, cancel_at_period_end, first_delivery_at, stripe_customer_id, stripe_subscription_id, current_cycle_id",
    )
    .eq("id", membershipId)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) return null;

  const [catalog, customerResult, cycleResult, fulfillmentResult, creditResult] =
    await Promise.all([
      getBreadClubCatalogData(),
      supabase
        .from("customers")
        .select("name, email, phone")
        .eq("id", membership.customer_id)
        .maybeSingle(),
      membership.current_cycle_id
        ? supabase
            .from("bread_club_cycles")
            .select(
              "id, cycle_number, status, period_start, period_end, skip_count, total_cents",
            )
            .eq("id", membership.current_cycle_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("bread_club_fulfillments")
        .select(
          "id, status, weekly_menu_id, delivery_window_id, order_id, selection, weekly_menus(name, order_cutoff_at), delivery_windows(label, starts_at)",
        )
        .eq("membership_id", membershipId)
        .in("status", ["pending_payment", "scheduled", "skipped"])
        .order("created_at", { ascending: true }),
      supabase
        .from("bread_club_rollover_credits")
        .select(
          "id, quantity, delivery_fee_credit_cents, status, expires_at",
        )
        .eq("membership_id", membershipId)
        .order("created_at", { ascending: false }),
    ]);
  if (customerResult.error) throw new Error(customerResult.error.message);
  if (cycleResult.error) throw new Error(cycleResult.error.message);
  if (fulfillmentResult.error) throw new Error(fulfillmentResult.error.message);
  if (creditResult.error) throw new Error(creditResult.error.message);

  const plan = catalog.plans.find(
    (item) => item.id === String(membership.plan_id),
  );
  if (!plan) throw new Error("Bread Club plan data is unavailable.");

  const fulfillmentRows = fulfillmentResult.data || [];
  const orderIds = fulfillmentRows
    .map((row) => row.order_id)
    .filter((id): id is string => Boolean(id));
  const menuIds = fulfillmentRows.map((row) =>
    String(row.weekly_menu_id),
  );
  const [itemResult, menuItemResult] = await Promise.all([
    orderIds.length
      ? supabase
          .from("order_items")
          .select("order_id, product_id, quantity, products(name)")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
    menuIds.length
      ? supabase
          .from("weekly_menu_items")
          .select(
            "weekly_menu_id, product_id, available_quantity, sold_quantity, unavailable, products(name, active, category, price_cents)",
          )
          .in("weekly_menu_id", menuIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemResult.error) throw new Error(itemResult.error.message);
  if (menuItemResult.error) throw new Error(menuItemResult.error.message);

  const eligibleIds = new Set(
    plan.eligibleProducts.map((product) => product.id),
  );
  const fulfillments = fulfillmentRows.map<BreadClubMemberFulfillment>(
    (row) => {
      const weeklyMenu = singleRelation(row.weekly_menus);
      const window = singleRelation(row.delivery_windows);
      const selection = Array.isArray(row.selection)
        ? (row.selection as Array<{
            product_id?: string;
            productId?: string;
            quantity?: number;
          }>).map<BreadClubSelection>((item) => ({
            productId: String(item.product_id || item.productId || ""),
            quantity: Number(item.quantity || 0),
          }))
        : [];

      return {
        id: String(row.id),
        status: row.status as BreadClubMemberFulfillment["status"],
        weeklyMenuId: String(row.weekly_menu_id),
        weeklyMenuName: String(weeklyMenu?.name || "Sunday delivery"),
        cutoffAt: String(weeklyMenu?.order_cutoff_at || ""),
        deliveryWindowId: String(row.delivery_window_id),
        deliveryLabel: String(
          window?.label || "Sunday 3:00-6:00 PM",
        ),
        deliveryStartsAt: String(window?.starts_at || ""),
        selection,
        items: (itemResult.data || [])
          .filter((item) => item.order_id === row.order_id)
          .map((item) => ({
            productId: String(item.product_id),
            productName: String(
              singleRelation(item.products)?.name || "Bread Club loaf",
            ),
            quantity: Number(item.quantity),
          })),
        availableProducts: (menuItemResult.data || [])
          .filter(
            (item) =>
              String(item.weekly_menu_id) === String(row.weekly_menu_id) &&
              eligibleIds.has(String(item.product_id)),
          )
          .map((item) => {
            const product = singleRelation(item.products);
            return {
              id: String(item.product_id),
              name: String(product?.name || "Bread"),
              remainingQuantity: Math.max(
                Number(item.available_quantity) -
                  Number(item.sold_quantity),
                0,
              ),
              unavailable:
                Boolean(item.unavailable) || product?.active === false,
            };
          }),
        availableAddons: (menuItemResult.data || [])
          .filter((item) => {
            const product = singleRelation(item.products);
            return (
              String(item.weekly_menu_id) === String(row.weekly_menu_id) &&
              product?.category === "add-on"
            );
          })
          .map((item) => {
            const product = singleRelation(item.products);
            return {
              id: String(item.product_id),
              name: String(product?.name || "Add-on"),
              remainingQuantity: Math.max(
                Number(item.available_quantity) -
                  Number(item.sold_quantity),
                0,
              ),
              priceCents: Number(product?.price_cents || 0),
              unavailable:
                Boolean(item.unavailable) || product?.active === false,
            };
          }),
      };
    },
  );
  const customer = customerResult.data;
  const cycle = cycleResult.data;

  return {
    id: String(membership.id),
    status: membership.status as BreadClubMemberData["status"],
    customerName: String(customer?.name || "Bread Club member"),
    customerEmail: String(customer?.email || ""),
    customerPhone: customer?.phone ? String(customer.phone) : null,
    plan,
    routeFeeCents: Number(membership.route_fee_cents),
    routeBandKey: String(membership.route_band_key),
    deliveryAddress: membership.delivery_address as DeliveryAddress,
    deliveryInstructions: membership.delivery_instructions
      ? String(membership.delivery_instructions)
      : null,
    cancelAtPeriodEnd: Boolean(membership.cancel_at_period_end),
    firstDeliveryAt: String(membership.first_delivery_at),
    stripeCustomerId: membership.stripe_customer_id
      ? String(membership.stripe_customer_id)
      : null,
    stripeSubscriptionId: membership.stripe_subscription_id
      ? String(membership.stripe_subscription_id)
      : null,
    currentCycle: cycle
      ? {
          id: String(cycle.id),
          cycleNumber: Number(cycle.cycle_number),
          status: String(cycle.status),
          periodStart: String(cycle.period_start),
          periodEnd: String(cycle.period_end),
          skipCount: Number(cycle.skip_count),
          totalCents: Number(cycle.total_cents),
        }
      : null,
    fulfillments,
    credits: (creditResult.data || []).map((credit) => ({
      id: String(credit.id),
      quantity: Number(credit.quantity),
      deliveryFeeCreditCents: Number(
        credit.delivery_fee_credit_cents,
      ),
      status: credit.status as BreadClubMemberData["credits"][number]["status"],
      expiresAt: String(credit.expires_at),
    })),
  };
}
