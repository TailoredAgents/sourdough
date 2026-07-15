import type { MetadataRoute } from "next";
import { productPath } from "@/lib/product-slugs";
import { policyLastUpdatedIso, policyPages } from "@/lib/policies";
import { serviceAreaPath } from "@/lib/service-areas";
import {
  getActiveMenuData,
  getActiveWeeklyMenuData,
  getDeliverySettingsData,
} from "@/lib/storefront-data";

const baseUrl = "https://landlsourdough.com";

function toSitemapDate(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [menu, weeklyMenu, deliverySettings] = await Promise.all([
    getActiveMenuData(),
    getActiveWeeklyMenuData(),
    getDeliverySettingsData(),
  ]);
  const weeklyLastModified = toSitemapDate(
    weeklyMenu?.startsAt || weeklyMenu?.orderCutoffAt,
  );
  const policyLastModified = toSitemapDate(policyLastUpdatedIso);

  return [
    {
      url: baseUrl,
      lastModified: weeklyLastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/sourdough-delivery-canton-ga`,
      lastModified: weeklyLastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/sourdough-delivery-woodstock-ga`,
      lastModified: weeklyLastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...deliverySettings.allowedPostalCodes.map((postalCode) => ({
      url: `${baseUrl}${serviceAreaPath(postalCode)}`,
      lastModified: weeklyLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
    {
      url: `${baseUrl}/contact`,
      lastModified: policyLastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/policies`,
      lastModified: policyLastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    ...policyPages.map((page) => ({
      url: `${baseUrl}/policies/${page.slug}`,
      lastModified: policyLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
    ...menu.map((item) => ({
      url: `${baseUrl}${productPath(item)}`,
      lastModified: weeklyLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
