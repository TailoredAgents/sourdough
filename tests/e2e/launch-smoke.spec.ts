import { expect, test } from "@playwright/test";

test("storefront renders menu or ordering unavailable state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Luna & Lorelai/i })).toBeVisible();
  await expect(
    page.locator('img[src*="sourdough-hero.jpg"]').first(),
  ).toBeVisible();
  await expect(
    page.getByText(/left this week|Ordering is not open yet/).first(),
  ).toBeVisible();
});

test("manifest exposes customer-facing app metadata", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.name).toBe("Luna & Lorelai's Sourdough");
  expect(manifest.start_url).toBe("/");
  expect(manifest.theme_color).toBe("#23443b");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "/images/luna-lorelais-logo-square-180.png",
        sizes: "180x180",
        type: "image/png",
      }),
    ]),
  );
});

test("sitemap exposes customer routes with freshness metadata", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);

  const sitemap = await response.text();
  expect(sitemap).toContain("<loc>https://landlsourdough.com</loc>");
  expect(sitemap).toContain(
    "<loc>https://landlsourdough.com/sourdough-delivery-canton-ga</loc>",
  );
  expect(sitemap).toContain(
    "<loc>https://landlsourdough.com/sourdough-delivery-woodstock-ga</loc>",
  );
  expect(sitemap).toContain(
    "<loc>https://landlsourdough.com/sourdough-delivery/30188</loc>",
  );
  expect(sitemap).toContain(
    "<loc>https://landlsourdough.com/sourdough-delivery/30189</loc>",
  );
  expect(sitemap).toContain("<loc>https://landlsourdough.com/contact</loc>");
  expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
});

test("customer pages avoid internal admin wording", async ({ page }) => {
  for (const path of [
    "/",
    "/sourdough-delivery-canton-ga",
    "/sourdough-delivery-woodstock-ga",
    "/sourdough-delivery/30114",
    "/sourdough-delivery/30188",
    "/menu/classic-country-loaf",
    "/contact",
  ]) {
    await page.goto(path);
    const mainText = await page.locator("#main-content").innerText();
    expect(mainText).not.toMatch(/\b(published|draft|owner|internal)\b/i);
  }
});

test("mobile customer funnel exposes navigation, ordering, and analytics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/notify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "You are on the list." }),
    });
  });

  await page.goto("/");
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "page_view"),
  );

  await expect(
    page.locator('nav[aria-label="Mobile navigation"]'),
  ).toBeVisible();
  const mobileNav = page.locator('nav[aria-label="Mobile navigation"]');
  await expect(mobileNav.getByRole("link", { name: "Menu" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Delivery" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Questions" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Policies" })).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Contact" })).toBeVisible();
  const contactNavBox = await mobileNav
    .getByRole("link", { name: "Contact" })
    .boundingBox();
  expect(contactNavBox?.x).toBeGreaterThanOrEqual(0);
  expect((contactNavBox?.x || 0) + (contactNavBox?.width || 0)).toBeLessThanOrEqual(
    390,
  );

  await page.locator('a[href="#main-content"]').focus();
  await page.waitForTimeout(300);
  const skipLinkBox = await page.locator('a[href="#main-content"]').boundingBox();
  expect(skipLinkBox?.y).toBeGreaterThanOrEqual(0);

  await page.locator('nav[aria-label="Mobile navigation"] a[href="/#menu"]').click();
  await expect(page).toHaveURL(/#menu/);
  await page.waitForFunction(() =>
    window.dataLayer?.some(
      (entry) => entry.event === "nav_click" && entry.section === "mobile_header",
    ),
  );

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);

  const addClassicLoaf = page.getByRole("button", {
    name: /Add Classic Country Loaf/i,
  });
  if (await addClassicLoaf.isVisible()) {
    await addClassicLoaf.click();
    await expect(page.getByRole("link", { name: /Review order/i })).toBeVisible();
    await page.waitForFunction(() =>
      window.dataLayer?.some((entry) => entry.event === "add_to_cart"),
    );
  }

  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="postal-code"]').fill("30a114");
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30114");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "check_delivery"),
  );
  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();
  await expect(
    page.getByText("Review ingredients, allergens, and terms"),
  ).toBeVisible();
  await expect(
    page.locator("#checkout-details").getByText("What happens next", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/No payment is collected for availability requests|Payment opens in Stripe Checkout/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /refund and cancellation details/i }),
  ).toBeVisible();
  await page
    .getByLabel(/I confirm the delivery details are correct/i)
    .check();
  await expect(
    page.getByText("Ingredients, allergens, and terms reviewed"),
  ).toBeVisible();

  await page.locator('input[name="notify-email"]').first().fill("test@example.com");
  await page.locator('input[name="notify-postal-code"]').first().fill("30114");
  await page.getByRole("button", { name: "Notify me" }).first().click();
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "notify_signup"),
  );
  await expect(page.getByText("You are on the list.").first()).toBeVisible();
});

test("narrow mobile storefront has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");

  const mobileNav = page.locator('nav[aria-label="Mobile navigation"]');
  await expect(mobileNav.getByRole("link", { name: "Contact" })).toBeVisible();
  await expect(mobileNav.getByText("Help")).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
});

test("delivery check accepts and rejects ZIPs", async ({ request }) => {
  const allowed = await request.post("/api/delivery/check", {
    data: {
      line1: "1 Main St",
      city: "Canton",
      state: "GA",
      postalCode: "30114",
    },
  });
  expect(allowed.ok()).toBe(true);
  expect((await allowed.json()).eligible).toBe(true);

  const woodstockAllowed = await request.post("/api/delivery/check", {
    data: {
      line1: "1 Main St",
      city: "Woodstock",
      state: "GA",
      postalCode: "30188",
    },
  });
  expect(woodstockAllowed.ok()).toBe(true);
  const woodstockPayload = await woodstockAllowed.json();
  expect(woodstockPayload).toEqual(
    expect.objectContaining({
      eligible: true,
      postalCode: "30188",
      allowedPostalCodes: expect.arrayContaining(["30188", "30189"]),
    }),
  );

  const rejected = await request.post("/api/delivery/check", {
    data: {
      line1: "1 Main St",
      city: "Chattanooga",
      state: "TN",
      postalCode: "37402",
    },
  });
  expect(rejected.ok()).toBe(true);
  expect((await rejected.json()).eligible).toBe(false);

  const invalidZip = await request.post("/api/delivery/check", {
    data: {
      line1: "1 Main St",
      city: "Canton",
      state: "GA",
      postalCode: "301",
    },
  });
  expect(invalidZip.status()).toBe(400);
  expect(await invalidZip.json()).toEqual(
    expect.objectContaining({
      eligible: false,
      postalCode: null,
      allowedPostalCodes: expect.arrayContaining(["30114"]),
    }),
  );

  const malformed = await request.post("/api/delivery/check", {
    headers: { "Content-Type": "application/json" },
    data: "not-json",
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual(
    expect.objectContaining({
      eligible: false,
      message: "Please enter a complete delivery address.",
    }),
  );
});

test("homepage lets customers check ZIP before building a full order", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Delivery ZIP code").pressSequentially("30a114");
  await expect(page.getByLabel("Delivery ZIP code")).toHaveValue("30114");
  await page.getByRole("button", { name: "Check ZIP" }).click();

  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Order with this ZIP" })).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some(
      (entry) =>
        entry.event === "check_delivery" &&
        entry.source === "homepage-ordering-section",
    ),
  );

  await page.getByRole("link", { name: "Order with this ZIP" }).click();
  await expect(page).toHaveURL(/\?zip=30114#order/);
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30114");
  await expect(page.getByText(/ZIP 30114 is prefilled/i)).toBeVisible();
});

test("checkout explains ineligible delivery ZIPs before submit", async ({ page }) => {
  await page.goto("/");

  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="address-level2"]').fill("Atlanta");
  await page.locator('input[name="postal-code"]').fill("30303");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();

  await expect(
    page.getByText(/30303 is outside our current delivery area/i),
  ).toBeVisible();
  await expect(
    page.locator("#checkout-details").getByText("Unavailable for this ZIP"),
  ).toBeVisible();
});

test("checkout asks customers to recheck delivery after ZIP changes", async ({ page }) => {
  await page.goto("/");

  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="postal-code"]').fill("30114");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();
  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();

  await page.locator('input[name="postal-code"]').fill("30115");

  await expect(page.getByText(/Delivery details changed/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Recheck delivery and fee" }),
  ).toBeVisible();
});

test("checkout normalizes Georgia state input before delivery check", async ({ page }) => {
  await page.goto("/");

  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="address-level1"]').fill("Georgia");
  await expect(page.locator('input[name="address-level1"]')).toHaveValue("GA");
  await page.locator('input[name="postal-code"]').fill("30114");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();

  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();
});

test("checkout shows a controlled delivery-check failure message", async ({ page }) => {
  await page.route("**/api/delivery/check", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "temporarily unavailable",
    });
  });

  await page.goto("/");
  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="postal-code"]').fill("30114");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();

  await expect(
    page.getByText("Delivery could not be checked. Please try again."),
  ).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "check_delivery_error"),
  );
});

test("checkout shows a controlled error when checkout response is malformed", async ({ page }) => {
  await page.route("**/api/checkout", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "text/plain",
      body: "bad gateway",
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Add Classic Country Loaf/i }).click();
  await page.locator('input[name="name"]').fill("Test Customer");
  await page.locator('input[name="email"]').fill("customer@example.com");
  await page.locator('input[name="tel"]').fill("4045550100");
  await page.locator('input[name="address-line1"]').fill("123 Main St");
  await page.locator('input[name="postal-code"]').fill("30114");
  await page.getByRole("button", { name: "Check delivery and fee" }).click();
  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();
  await page
    .getByLabel(/I confirm the delivery details are correct/i)
    .check();
  await page
    .getByRole("button", {
      name: /Continue to secure checkout|Send availability request/i,
    })
    .click();

  await expect(
    page.getByText("Checkout could not be started. Please try again."),
  ).toBeVisible();
});

test("product page CTA preselects the item in the order form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu/classic-country-loaf");

  await expect(
    page.getByRole("heading", { name: /Before you choose Classic Country Loaf/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/What allergens are listed for Classic Country Loaf/i),
  ).toBeVisible();
  const productSchemas = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => script.textContent || ""));
  const productGraph = productSchemas
    .map((schema) => JSON.parse(schema) as { "@graph"?: Array<{ "@type"?: string }> })
    .find((schema) =>
      schema["@graph"]?.some((entry) => entry["@type"] === "Product"),
    );
  expect(productGraph?.["@graph"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ "@type": "Product" }),
      expect.objectContaining({ "@type": "FAQPage" }),
    ]),
  );

  const cta = page
    .getByRole("link", { name: /Choose this item|Request this item/i })
    .first();
  const href = await cta.getAttribute("href");
  expect(href).toMatch(/^\/#select-/);
  const expectedHash = href?.replace("/", "") || "";
  await cta.click();

  await expect(page).toHaveURL(new RegExp(`${expectedHash}$`));
  await expect(page.getByText("1 x Classic Country Loaf")).toBeVisible();
  await expect(page.getByRole("link", { name: /Review order/i })).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some(
      (entry) =>
        entry.event === "add_to_cart" &&
        entry.product_name === "Classic Country Loaf" &&
        entry.source === "direct_select_link",
    ),
  );
});

test("customer question box submits accessibly from the keyboard", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer: "Delivery is available in selected local ZIP codes.",
      }),
    });
  });

  await page.goto("/#questions");
  await page.getByLabel("Customer question").fill("Do you deliver to 30114?");
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Delivery is available in selected local ZIP codes."),
  ).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "customer_question_submit"),
  );
});

test("admin redirects anonymous users to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("heading", { name: /admin/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("success and canceled pages render", async ({ page }) => {
  await page.goto("/order/success?demo=1");
  await expect(page.getByRole("heading", { name: /Order received/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );

  await page.goto("/order/canceled");
  await expect(page.getByRole("heading", { name: /Checkout canceled/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("contact page gives customers support paths", async ({ page }) => {
  await page.goto("/contact");
  await expect(
    page.getByRole("heading", { name: /Questions about sourdough/i }),
  ).toBeVisible();
  const main = page.locator("#main-content");
  await expect(main.getByRole("link", { name: /orders@landlsourdough.com/i })).toBeVisible();
  await expect(main.getByRole("link", { name: /Start an order/i })).toBeVisible();
  const contactSchema = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  const parsedSchema = JSON.parse(contactSchema || "{}") as {
    "@graph"?: Array<{ "@type"?: string; name?: string }>;
  };
  expect(parsedSchema["@graph"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ "@type": "BreadcrumbList" }),
      expect.objectContaining({
        "@type": "ContactPage",
        name: "Contact Luna & Lorelai's Sourdough",
      }),
    ]),
  );
});

test("policies page exposes official compliance resources", async ({ page }) => {
  await page.goto("/policies");

  await expect(
    page.getByRole("heading", { name: /Policies and bakery notices/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Where customers can verify bakery requirements/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Georgia Department of Agriculture Cottage Food/i,
    }),
  ).toHaveAttribute("href", "https://agr.georgia.gov/cottage-food");
});

test("delivery page lets customers check ZIP before ordering", async ({ page }) => {
  await page.goto("/sourdough-delivery-canton-ga");
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "page_view"),
  );

  await page.getByLabel("Delivery ZIP code").fill("30a114");
  await expect(page.getByLabel("Delivery ZIP code")).toHaveValue("30114");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(page.getByText(/30114 is in our local delivery area/i)).toBeVisible();
  await expect(page.getByText(/Delivery fee:/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Order with this ZIP" })).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some(
      (entry) =>
        entry.event === "check_delivery" &&
        entry.source === "canton-delivery-page",
    ),
  );

  await page.getByRole("link", { name: "Order with this ZIP" }).click();
  await expect(page).toHaveURL(/\?zip=30114#order/);
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30114");
});

test("Woodstock delivery page lets customers check ZIP before ordering", async ({ page }) => {
  await page.goto("/sourdough-delivery-woodstock-ga");
  await page.waitForFunction(() =>
    window.dataLayer?.some((entry) => entry.event === "page_view"),
  );

  await expect(
    page.getByRole("heading", {
      name: /Fresh sourdough delivered locally in Woodstock, GA/i,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Woodstock ZIPs: 30188, 30189/i)).toBeVisible();

  await page.getByLabel("Delivery ZIP code").fill("30a188");
  await expect(page.getByLabel("Delivery ZIP code")).toHaveValue("30188");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(page.getByText(/30188 is in our local delivery area/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Order with this ZIP" })).toBeVisible();
  await page.waitForFunction(() =>
    window.dataLayer?.some(
      (entry) =>
        entry.event === "check_delivery" &&
        entry.source === "woodstock-delivery-page" &&
        entry.postal_code === "30188" &&
        entry.eligible === true,
    ),
  );

  await page.getByRole("link", { name: "Order with this ZIP" }).click();
  await expect(page).toHaveURL(/\?zip=30188#order/);
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30188");
  await expect(page.getByText(/ZIP 30188 is prefilled/i)).toBeVisible();
});

test("service-area ZIP page can prefill ZIP and select a product", async ({ page }) => {
  await page.goto("/sourdough-delivery/30188");

  await page
    .getByRole("link", { name: /Choose for ZIP 30188/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\?zip=30188#select-/);
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30188");
  await expect(page.getByText(/ZIP 30188 is prefilled/i)).toBeVisible();
  await expect(page.getByText(/1 x /)).toBeVisible();
  await expect(page.locator("#checkout-details").getByText("Your items")).toBeVisible();
});

test("service-area ZIP page links into ordering with prefilled ZIP", async ({ page }) => {
  await page.goto("/sourdough-delivery/30188");

  await expect(
    page.getByRole("heading", {
      name: /Sourdough Delivery in ZIP 30188 \(Woodstock, GA\)/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Woodstock, GA delivery/i }),
  ).toHaveAttribute("href", "/sourdough-delivery-woodstock-ga");
  await expect(page.getByText(/Delivery fee shown before checkout/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Order for ZIP 30188/i }).first()).toBeVisible();

  await page.getByRole("link", { name: /Order for ZIP 30188/i }).first().click();
  await expect(page).toHaveURL(/\?zip=30188#order/);
  await expect(page.locator('input[name="postal-code"]')).toHaveValue("30188");
  await expect(page.getByText(/ZIP 30188 is prefilled/i)).toBeVisible();
});
