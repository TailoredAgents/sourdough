export type ProductCategory = "bread" | "add-on";

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  description: string;
  ingredients: string[];
  allergens: string[];
  priceCents: number;
  imageStyle: string;
  active: boolean;
};

export type WeeklyMenuItem = {
  productId: string;
  availableQuantity: number;
  soldQuantity: number;
  featured?: boolean;
};

export type DeliveryWindow = {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
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
  cart: CartItem[];
  customer: CustomerDetails;
  address: DeliveryAddress;
  deliveryWindowId: string;
  notes?: string;
};

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "baking"
  | "out_for_delivery"
  | "delivered"
  | "canceled";
