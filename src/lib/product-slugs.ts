import type { MenuProduct, Product } from "./types";

export function productSlug(product: Pick<Product, "name">) {
  return product.name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productPath(product: Pick<Product, "name">) {
  return `/menu/${productSlug(product)}`;
}

export function findMenuProductBySlug(menu: MenuProduct[], slug: string) {
  return menu.find((item) => productSlug(item) === slug) ?? null;
}
