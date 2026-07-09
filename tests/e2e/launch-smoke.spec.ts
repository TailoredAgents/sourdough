import { expect, test } from "@playwright/test";

test("storefront renders menu or ordering unavailable state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Luna & Lorelai/i })).toBeVisible();
  await expect(
    page.getByText(/left this week|Ordering is not open yet/).first(),
  ).toBeVisible();
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
});

test("admin redirects anonymous users to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("heading", { name: /admin/i })).toBeVisible();
});

test("success and canceled pages render", async ({ page }) => {
  await page.goto("/order/success?demo=1");
  await expect(page.getByRole("heading", { name: /Order received/i })).toBeVisible();

  await page.goto("/order/canceled");
  await expect(page.getByRole("heading", { name: /Checkout canceled/i })).toBeVisible();
});
