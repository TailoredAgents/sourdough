import { bakery } from "./bakery-data";

export type PolicySection = {
  heading: string;
  body: string[];
};

export type PolicyPage = {
  slug: string;
  title: string;
  description: string;
  sections: PolicySection[];
};

export const policyLastUpdated = "July 15, 2026";
export const policyLastUpdatedIso = "2026-07-15";

export const policyPages: PolicyPage[] = [
  {
    slug: "allergen-cottage-food",
    title: "Allergen and Cottage Food Notice",
    description:
      "Ingredient, allergen, and Georgia cottage-food information for local bakery orders.",
    sections: [
      {
        heading: "Ingredient and allergen information",
        body: [
          `Each product page lists the ingredients and allergens currently known for that item. Please review the product listing before ordering and email ${bakery.orderEmail} with questions before checkout.`,
          `Products may contain or come into contact with wheat, milk, eggs, soy, tree nuts, peanuts, sesame, or other allergens used in a home kitchen. ${bakery.name} does not make allergen-free claims or promise separation from allergens.`,
        ],
      },
      {
        heading: "Cottage food status",
        body: [
          `${bakery.name} prepares non-potentially hazardous cottage-food bakery items in a Georgia home kitchen for local customer orders.`,
          "Online ordering is available for local Georgia delivery only. Shipping and out-of-state delivery are not currently available.",
        ],
      },
      {
        heading: "Labeling",
        body: [
          "Delivered products include required cottage-food label information, including product name, business contact information, ingredients, allergen declarations, quantity or net weight when applicable, and the required home-kitchen disclosure.",
          "Website text is provided for ordering convenience and does not replace the label on the delivered product. Customers with allergy or ingredient concerns should review both the website listing and the delivered label.",
        ],
      },
    ],
  },
  {
    slug: "refunds-cancellations",
    title: "Refund and Cancellation Policy",
    description:
      "How order changes, cancellations, missed delivery, bakery errors, and refunds are handled.",
    sections: [
      {
        heading: "Weekly bake timing",
        body: [
          "Orders are planned around a weekly bake and delivery schedule. The current order cutoff is posted on the weekly menu and shown before checkout.",
          `After the cutoff, customers may submit an availability request, but the request is not confirmed unless ${bakery.name} responds and accepts it.`,
        ],
      },
      {
        heading: "Cancellations",
        body: [
          `Customers may request cancellation by emailing ${bakery.orderEmail}. Cancellations received before the posted order cutoff are eligible for refund to the original payment method.`,
          `After the posted cutoff, ingredients, dough, and delivery planning may already be committed. Refunds after the cutoff are discretionary unless ${bakery.name} cancels the order, cannot fulfill it, or made an order error.`,
        ],
      },
      {
        heading: "Refunds",
        body: [
          "Approved refunds are returned through the original payment method. Stripe or the customer's bank may take additional time to post the refund after it is issued.",
          `Perishable bakery products generally cannot be returned after delivery. If an item is missing, incorrect, damaged, or not as expected, email ${bakery.orderEmail} as soon as possible with the order details so the bakery can review it.`,
        ],
      },
      {
        heading: "Delivery problems",
        body: [
          "Customers are responsible for entering a reachable local delivery address, accurate contact information, and any access notes needed to complete delivery.",
          `If delivery cannot be completed because the address is wrong, access is blocked, or the customer cannot be reached, ${bakery.name} will review the situation before deciding whether a refund, credit, redelivery, or separately arranged pickup is appropriate.`,
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    description:
      "What customer information is collected, how it is used, and how customers can request corrections.",
    sections: [
      {
        heading: "Information collected",
        body: [
          `${bakery.name} collects information needed to handle orders and customer requests, including name, email, phone number, delivery address, order details, delivery instructions, order notes, messages, and chat or request content sent through the site.`,
          `When online payment is used, payment checkout is handled by Stripe. ${bakery.name} does not receive or store full card numbers.`,
        ],
      },
      {
        heading: "How information is used",
        body: [
          "Customer information is used to confirm orders, check delivery eligibility, prepare bakery items, deliver orders, respond to questions, send order updates, prevent abuse, and maintain business records.",
          "Current menu, order, and bakery information may be used by site tools such as the chat assistant. The chat assistant cannot handle payments, change orders, or provide medical, legal, tax, or allergen-safety advice.",
        ],
      },
      {
        heading: "Service providers",
        body: [
          "The site uses service providers for hosting, database storage, payment checkout, email delivery, AI-assisted customer support, analytics or abuse prevention, and related business tools.",
          "These providers process customer information only as needed to run the site, fulfill bakery orders, protect the service, and support customer communication.",
        ],
      },
      {
        heading: "Contact and changes",
        body: [
          `Customers can email ${bakery.orderEmail} to ask about their information, request a correction, or request deletion where business, tax, payment, legal, or fraud-prevention records do not need to be retained.`,
          "This policy may be updated as bakery services, delivery areas, or ordering options change.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Order Terms",
    description:
      "The customer terms for placing a local delivery order or request.",
    sections: [
      {
        heading: "Local delivery only",
        body: [
          `${bakery.name} offers local Georgia delivery from Canton, GA. The site does not offer shipping or out-of-state delivery.`,
          "Delivery eligibility is checked by Georgia ZIP code. Allowed ZIP codes, delivery fees, and available delivery windows may change by week.",
          `Pickup is not a standard checkout option. If pickup is available for a specific order, it must be separately arranged and confirmed by ${bakery.name}.`,
        ],
      },
      {
        heading: "Inventory and order acceptance",
        body: [
          "Menu quantities are limited. An item may become unavailable if inventory sells out, a checkout session is not completed, or an order cannot be fulfilled as submitted.",
          `A paid checkout confirmation means the order has been received for the selected delivery window. A submitted availability request is not a confirmed order until ${bakery.name} responds and accepts it.`,
        ],
      },
      {
        heading: "Customer responsibilities",
        body: [
          "Customers are responsible for providing accurate contact information, delivery address, delivery instructions, and product selections.",
          `Customers with food allergies, sensitivities, or dietary restrictions should review ingredient and allergen information before ordering and email ${bakery.orderEmail} with questions before checkout.`,
        ],
      },
      {
        heading: "Site information",
        body: [
          "The website and AI assistant provide general bakery information from approved content and current menu data. They do not provide legal, medical, tax, or allergen-safety advice.",
          `${bakery.name} may update menu items, prices, policies, delivery windows, delivery areas, and availability before an order is accepted.`,
        ],
      },
    ],
  },
];

export const officialComplianceLinks = [
  {
    label: "Georgia Department of Agriculture Cottage Food",
    href: "https://agr.georgia.gov/cottage-food",
  },
  {
    label: "Georgia Cottage Food FAQ",
    href: "https://agr.georgia.gov/cottage-food-faq",
  },
  {
    label: "Georgia Sales and Use Tax",
    href: "https://dor.georgia.gov/taxes/sales-use-tax",
  },
  {
    label: "Canton Business License Information",
    href: "https://www.cantonga.gov/business/start-a-business/business-license-information",
  },
  {
    label: "Cherokee County Home Occupation Tax Certificate",
    href: "https://cherokeecountyga.gov/DSC/business-licenses/Home-Occupation-Tax-Certificate/",
  },
];

export function getPolicyPage(slug: string) {
  return policyPages.find((page) => page.slug === slug);
}
