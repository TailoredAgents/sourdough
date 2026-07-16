import { getAiKnowledgeReviewWarnings } from "./admin-ai-knowledge-status";

type WeeklyMenuValidationItem = {
  included: boolean;
  productName?: string;
  availableQuantity: number;
  soldQuantity: number;
  unavailable?: boolean;
};

type WeeklyMenuValidationInput = {
  name: string;
  orderCutoffAt: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
  items: WeeklyMenuValidationItem[];
};

type DeliveryWindowValidationInput = {
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
  remove?: boolean;
};

type DeliveryValidationInput = {
  deliveryFeeDollars: string;
  allowedPostalCodes: string;
  serviceAreaCopy: string;
  windows: DeliveryWindowValidationInput[];
};

type ProductValidationInput = {
  name: string;
  description: string;
  ingredients: string;
  price: string;
  imageStyle: string;
};

type AiKnowledgeValidationInput = {
  title: string;
  body: string;
  approved?: boolean;
};

function isValidDate(value: string) {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

function isWholeNumberInRange(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateWeeklyMenuForm(input: WeeklyMenuValidationInput) {
  if (input.name.trim().length < 2) return "Menu name is required.";
  if (!isValidDate(input.orderCutoffAt)) return "Use a valid order cutoff date.";
  if (!isValidDate(input.startsAt)) return "Use a valid menu start date.";
  if (!isValidDate(input.endsAt)) return "Use a valid menu end date.";
  if (new Date(input.startsAt) >= new Date(input.endsAt)) {
    return "Menu start must be before menu end.";
  }
  if (new Date(input.orderCutoffAt) > new Date(input.startsAt)) {
    return "Order cutoff must be before the menu starts.";
  }

  const includedItems = input.items.filter((item) => item.included);
  if (input.published && !includedItems.length) {
    return "Published menus need at least one included product.";
  }

  for (const item of includedItems) {
    const itemName = item.productName || "Each included product";
    if (!isWholeNumberInRange(item.availableQuantity, 0, 1000)) {
      return `${itemName} needs an available quantity between 0 and 1000.`;
    }
    if (!isWholeNumberInRange(item.soldQuantity, 0, 1000)) {
      return `${itemName} needs a sold quantity between 0 and 1000.`;
    }
    if (!item.unavailable && item.availableQuantity === 0) {
      return `${itemName} needs sellable inventory or must be marked unavailable.`;
    }
    if (item.soldQuantity > item.availableQuantity) {
      return `${itemName} cannot have more sold than available.`;
    }
  }

  return null;
}

export function validateDeliveryForm(input: DeliveryValidationInput) {
  const fee = Number(input.deliveryFeeDollars);
  if (!Number.isFinite(fee) || fee < 0 || fee > 500) {
    return "Delivery fee must be between $0.00 and $500.00.";
  }

  const zipCodes = splitList(input.allowedPostalCodes);
  if (!zipCodes.length) return "Add at least one delivery ZIP code.";
  if (zipCodes.some((zipCode) => !/^\d{5}$/.test(zipCode))) {
    return "Delivery ZIP codes must be 5 digits.";
  }

  const serviceAreaCopy = input.serviceAreaCopy.trim();
  if (serviceAreaCopy.length < 10) return "Service area copy needs at least 10 characters.";
  if (serviceAreaCopy.length > 500) return "Service area copy must stay under 500 characters.";

  for (const window of input.windows.filter((entry) => !entry.remove)) {
    const windowName = window.label.trim() || "Each delivery window";
    if (window.label.trim().length < 2) return "Delivery window label is required.";
    if (!isValidDate(window.startsAt)) return `${windowName} needs a valid start date.`;
    if (!isValidDate(window.endsAt)) return `${windowName} needs a valid end date.`;
    if (new Date(window.startsAt) >= new Date(window.endsAt)) {
      return `${windowName} must start before it ends.`;
    }
    if (!isWholeNumberInRange(window.capacity, 0, 1000)) {
      return `${windowName} capacity must be between 0 and 1000.`;
    }
    if (!isWholeNumberInRange(window.reserved, 0, 1000)) {
      return `${windowName} reserved spots must be between 0 and 1000.`;
    }
    if (window.reserved > window.capacity) {
      return `${windowName} cannot reserve more spots than capacity.`;
    }
  }

  const reservedRemovedWindow = input.windows.find(
    (entry) => entry.remove && entry.reserved > 0,
  );
  if (reservedRemovedWindow) {
    return `${reservedRemovedWindow.label || "Delivery window"} has reserved orders and cannot be removed.`;
  }

  return null;
}

export function validateProductForm(input: ProductValidationInput) {
  if (input.name.trim().length < 2) return "Product name is required.";
  if (input.description.trim().length < 10) {
    return "Product description needs at least 10 characters.";
  }
  if (!splitList(input.ingredients).length) return "Add at least one ingredient.";

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0 || price > 500) {
    return "Product price must be between $0.00 and $500.00.";
  }
  if (input.imageStyle.trim().length < 3) return "Product color style is required.";

  return null;
}

export function validateAiKnowledgeForm(input: AiKnowledgeValidationInput) {
  if (input.title.trim().length < 2) return "Fact title is required.";
  if (input.body.trim().length < 10) return "Approved fact needs at least 10 characters.";
  const reviewWarning = getAiKnowledgeReviewWarnings({
    approved: Boolean(input.approved),
    body: input.body,
  })[0];
  if (reviewWarning) return reviewWarning;
  return null;
}
