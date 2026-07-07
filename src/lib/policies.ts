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

export const policyLastUpdated = "July 7, 2026";

export const policyPages: PolicyPage[] = [
  {
    slug: "allergen-cottage-food",
    title: "Allergen and Cottage Food Notice",
    description:
      "How Luna & Lorelai's Sourdough communicates ingredients, allergens, and Georgia cottage food status.",
    sections: [
      {
        heading: "Ingredient and allergen information",
        body: [
          "Each product listing includes the ingredients and allergens currently known for that product. Customers should review the product card before ordering and contact Luna & Lorelai's Sourdough with questions.",
          "Products may contain or come into contact with wheat, milk, eggs, soy, tree nuts, peanuts, sesame, or other allergens depending on ingredients used in the home kitchen. Luna & Lorelai's Sourdough does not claim allergen-free preparation.",
        ],
      },
      {
        heading: "Cottage food status",
        body: [
          "Luna & Lorelai's Sourdough is being prepared as a Georgia cottage food business for direct local sales. Georgia Department of Agriculture materials state that cottage food operators may sell certain non-potentially hazardous foods, including loaf breads, and that online sales to end consumers within Georgia are allowed.",
          "Before live sales, Luna & Lorelai's Sourdough still needs owner confirmation of training, label text, local business rules, and any other launch requirements.",
        ],
      },
      {
        heading: "Labeling",
        body: [
          "Final packaged products should include the required cottage food label, product name, business information, ingredients, allergens, net weight or quantity when applicable, and any required home-kitchen disclosure.",
          "Website text is informational and does not replace the label on the delivered product.",
        ],
      },
    ],
  },
  {
    slug: "refunds-cancellations",
    title: "Refund and Cancellation Policy",
    description:
      "How cancellations, missed delivery, sold-out items, and refunds are handled.",
    sections: [
      {
        heading: "Weekly bake timing",
        body: [
          "Orders are planned around a weekly bake schedule. The normal cutoff is Thursday at 8:00 PM for the next bake window.",
          "After the cutoff, customers may send a last-minute request, but Luna & Lorelai's Sourdough may decline it if the bake schedule or delivery route is already full.",
        ],
      },
      {
        heading: "Cancellations",
        body: [
          "Customers should request cancellation as early as possible. Once ingredients are prepared, dough is mixed, or baking has begun, the order may not be refundable.",
          "If Luna & Lorelai's Sourdough needs to cancel because of illness, unsafe weather, inventory error, or another issue, the customer will be contacted about a refund or alternate delivery plan.",
        ],
      },
      {
        heading: "Refunds",
        body: [
          "Refunds, when approved, are returned through the original payment method once online payment is active.",
          "Perishable bakery products cannot usually be returned after delivery. If something is wrong with an order, customers should contact Luna & Lorelai's Sourdough as soon as possible with the order details.",
        ],
      },
      {
        heading: "Delivery problems",
        body: [
          "Customers are responsible for entering a reachable delivery address, accurate contact information, and any needed delivery instructions.",
          "If delivery cannot be completed because the address is wrong, access is blocked, or the customer cannot be reached, Luna & Lorelai's Sourdough will review the situation before deciding whether a refund, redelivery, or pickup option is possible.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    description:
      "What customer information Luna & Lorelai's Sourdough collects and how it is used.",
    sections: [
      {
        heading: "Information collected",
        body: [
          "Luna & Lorelai's Sourdough collects information needed to handle orders and requests, including name, email, phone number, delivery address, order details, notes, and messages sent through the site.",
          "When online payment is active, payment details are handled by Stripe Checkout. Luna & Lorelai's Sourdough should not receive or store full card numbers.",
        ],
      },
      {
        heading: "How information is used",
        body: [
          "Customer information is used to confirm orders, check delivery eligibility, prepare bakery items, deliver orders, respond to questions, and maintain business records.",
          "Approved bakery facts and current menu data may be used by the site chat assistant, but the chat should not make unsupported promises or handle payments.",
        ],
      },
      {
        heading: "Service providers",
        body: [
          "The site is built with services such as Supabase for database and storage, Stripe for payment checkout once enabled, Resend for email, OpenAI for controlled drafting/chat features, and Render for hosting.",
          "These services process information only as needed to run the site and bakery workflow.",
        ],
      },
      {
        heading: "Contact and changes",
        body: [
          "Customers can contact Luna & Lorelai's Sourdough to ask about their information or request corrections.",
          "This policy may be updated as the bakery moves from testing to live sales.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Order Terms",
    description:
      "The basic terms customers agree to when placing an order or request.",
    sections: [
      {
        heading: "Local delivery only",
        body: [
          "Luna & Lorelai's Sourdough is planned for local Georgia delivery from Canton, GA. The v1 site does not offer shipping or out-of-state delivery.",
          "Delivery radius, delivery fee, and available delivery windows are set by the bakery owner and may change by week.",
        ],
      },
      {
        heading: "Inventory and order acceptance",
        body: [
          "Menu quantities are limited. An item may become unavailable if inventory sells out or if a checkout session is not completed.",
          "A submitted last-minute request is not a confirmed order until Luna & Lorelai's Sourdough responds and confirms availability.",
        ],
      },
      {
        heading: "Customer responsibilities",
        body: [
          "Customers are responsible for providing accurate contact information, delivery address, delivery instructions, and product selections.",
          "Customers with food allergies or dietary restrictions should review ingredient and allergen information before ordering and contact the bakery with questions.",
        ],
      },
      {
        heading: "Site information",
        body: [
          "The website and AI assistant provide general bakery information from approved content and current menu data. They do not provide legal, medical, tax, or allergen-safety advice.",
          "Luna & Lorelai's Sourdough may update menu items, prices, policies, delivery windows, and availability at any time before an order is accepted.",
        ],
      },
    ],
  },
];

export const officialComplianceLinks = [
  {
    label: "Georgia Department of Agriculture Cottage Food",
    href: "https://www.agr.georgia.gov/cottage-food",
  },
  {
    label: "Georgia Cottage Food FAQ",
    href: "https://www.agr.georgia.gov/cottage-food-faq",
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
