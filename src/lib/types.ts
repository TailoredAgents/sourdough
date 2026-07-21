export type ProductCategory = "bread" | "add-on";

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  description: string;
  ingredients: string[];
  allergens: string[];
  priceCents: number;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  stripePriceCents?: number | null;
  stripeSyncedAt?: string | null;
  imageUrl: string | null;
  imageStyle: string;
  active: boolean;
};

export type WeeklyMenuItem = {
  productId: string;
  availableQuantity: number;
  soldQuantity: number;
  featured?: boolean;
  unavailable?: boolean;
};

export type WeeklyMenu = {
  id: string;
  name: string;
  orderCutoffAt: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
  items: MenuProduct[];
};

export type WeeklyMenuSummary = Omit<WeeklyMenu, "items"> & {
  itemCount: number;
};

export type MenuProduct = Product &
  WeeklyMenuItem & {
    remainingQuantity: number;
  };

export type DeliveryWindow = {
  id: string;
  weeklyMenuId?: string;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
};

export type OrderingWeek = {
  weeklyMenu: WeeklyMenu;
  menu: MenuProduct[];
  deliveryWindows: DeliveryWindow[];
};

export type CustomerMessage = {
  id: string;
  orderId: string | null;
  customerEmail: string | null;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
};

export type CustomerMessageReply = {
  id: string;
  customerMessageId: string;
  adminEmail: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  providerId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type AiKnowledgeEntry = {
  id: string;
  title: string;
  body: string;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CartItem = {
  productId: string;
  quantity: number;
};

export type CustomerDetails = {
  name: string;
  email: string;
  phone: string;
};

export type DeliveryAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
};

export type CheckoutRequest = {
  weeklyMenuId: string;
  cart: CartItem[];
  customer: CustomerDetails;
  address: DeliveryAddress;
  deliveryWindowId: string;
  deliveryInstructions?: string;
  notes?: string;
  nextWeekOk?: boolean;
  acknowledgedTerms: true;
};

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "pending_approval_payment"
  | "pending_approval"
  | "paid"
  | "baking"
  | "out_for_delivery"
  | "delivered"
  | "canceled";

export type AdminOrderMoveWindow = {
  id: string;
  label: string;
  weeklyMenuId: string;
  weeklyMenuName: string;
  startsAt: string;
  capacity: number;
  reserved: number;
};

export type AdminOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
};

export type AdminOrder = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  weeklyMenuId: string | null;
  weeklyMenuName: string | null;
  deliveryWindowLabel: string | null;
  status: OrderStatus;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  deliveryAddress: DeliveryAddress & {
    email?: string;
    phone?: string;
  };
  deliveryMiles: number | null;
  deliveryInstructions: string | null;
  deliveryCheck: Record<string, unknown> | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  stripeCheckoutSessionId: string | null;
  checkoutCancelToken: string | null;
  nextWeekOk: boolean | null;
  approvalMode: string | null;
  approvedAt: string | null;
  deniedAt: string | null;
  refundedAt: string | null;
  stripeRefundId: string | null;
  adminDecisionNote: string | null;
  items: AdminOrderItem[];
  moveWindows: AdminOrderMoveWindow[];
};
