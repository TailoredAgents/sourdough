export type BreadcrumbItem = {
  name: string;
  href: string;
};

export function buildBreadcrumbList(items: BreadcrumbItem[], siteUrl: string) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.href}`,
    })),
  };
}
