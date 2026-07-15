"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { validateProductForm } from "@/lib/admin-form-validation";
import {
  extractStripeCatalogSyncItems,
  summarizeStripeCatalogSync,
} from "@/lib/admin-stripe-sync";
import type { Product, ProductCategory } from "@/lib/types";
import { joinList, splitList } from "@/lib/product-admin";
import { formatCurrency } from "@/lib/utils";
import { Button } from "./button";

type ProductForm = {
  id?: string;
  name: string;
  category: ProductCategory;
  description: string;
  ingredients: string;
  allergens: string;
  price: string;
  imageUrl: string;
  imageStyle: string;
  active: boolean;
  includeInCurrentMenu: boolean;
  weeklyQuantity: string;
  featured: boolean;
};

function productToForm(product?: Product): ProductForm {
  return {
    id: product?.id,
    name: product?.name || "",
    category: product?.category || "bread",
    description: product?.description || "",
    ingredients: product ? joinList(product.ingredients) : "",
    allergens: product ? joinList(product.allergens) : "",
    price: product ? (product.priceCents / 100).toFixed(2) : "",
    imageUrl: product?.imageUrl || "",
    imageStyle:
      product?.imageStyle || "from-stone-100 via-amber-100 to-orange-200",
    active: product?.active ?? true,
    includeInCurrentMenu: !product,
    weeklyQuantity: !product ? "1" : "0",
    featured: false,
  };
}

function formToPayload(form: ProductForm) {
  return {
    id: form.id,
    name: form.name.trim(),
    category: form.category,
    description: form.description.trim(),
    ingredients: splitList(form.ingredients),
    allergens: splitList(form.allergens),
    priceCents: Math.round(Number(form.price || 0) * 100),
    imageUrl: form.imageUrl.trim() || null,
    imageStyle: form.imageStyle.trim(),
    active: form.active,
    includeInCurrentMenu: !form.id && form.includeInCurrentMenu,
    weeklyQuantity: Math.max(0, Math.round(Number(form.weeklyQuantity || 0))),
    featured: form.featured,
  };
}

export function ProductEditor({
  currentMenuProductIds,
  initialProducts,
}: {
  currentMenuProductIds: string[];
  initialProducts: Product[];
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [locallyVisibleProductIds, setLocallyVisibleProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialProducts[0]?.id ?? null,
  );
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId),
    [products, selectedId],
  );
  const [form, setForm] = useState<ProductForm>(productToForm(selectedProduct));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const visibleProductIds = useMemo(
    () => new Set([...currentMenuProductIds, ...locallyVisibleProductIds]),
    [currentMenuProductIds, locallyVisibleProductIds],
  );
  const isSuccessMessage = Boolean(
    message &&
      (message.startsWith("Product saved") ||
        message.startsWith("Image uploaded") ||
        message.startsWith("Stripe synced")),
  );

  function selectProduct(product: Product) {
    setSelectedId(product.id);
    setForm(productToForm(product));
    setMessage(null);
  }

  function newProduct() {
    setSelectedId(null);
    setForm(productToForm());
    setMessage(null);
  }

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function saveProduct() {
    setMessage(null);
    const validationMessage = validateProductForm(form);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      const payload = (await response.json()) as {
        products?: Product[];
        productId?: string;
        error?: string;
      };

      if (!response.ok || !payload.products) {
        setMessage(payload.error || "Product could not be saved.");
        return;
      }

      setProducts(payload.products);
      const savedProduct =
        payload.products.find((product) => product.id === payload.productId) ??
        payload.products.find(
          (product) => product.name.toLowerCase() === form.name.trim().toLowerCase(),
        );
      setSelectedId(savedProduct?.id ?? payload.products[0]?.id ?? null);
      setForm(productToForm(savedProduct ?? payload.products[0]));
      if (savedProduct && form.includeInCurrentMenu && !form.id) {
        setLocallyVisibleProductIds((current) => new Set(current).add(savedProduct.id));
      }
      setMessage(
        form.includeInCurrentMenu && !form.id
          ? "Product saved and added to this week's menu."
          : "Product saved. Add it to the weekly menu before expecting it on the storefront.",
      );
      router.refresh();
    });
  }

  function uploadProductImage(file: File | null) {
    if (!file) return;
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("productId", form.id || form.name || "new-product");

      const response = await fetch("/api/admin/product-image", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        imageUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.imageUrl) {
        setMessage(payload.error || "Image could not be uploaded.");
        return;
      }

      updateForm("imageUrl", payload.imageUrl);
      setMessage("Image uploaded. Save product to publish it.");
    });
  }

  function syncStripeCatalog() {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/stripe/sync-products", {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        const syncedProducts = extractStripeCatalogSyncItems(payload);

        if (!response.ok || !syncedProducts) {
          const error =
            payload && typeof payload === "object"
              ? (payload as { error?: unknown }).error
              : null;
          setMessage(
            typeof error === "string" ? error : "Stripe catalog could not be synced.",
          );
          return;
        }

        setMessage(summarizeStripeCatalogSync(syncedProducts).message);
        router.refresh();
      } catch {
        setMessage("Stripe catalog could not be synced. Check your connection and try again.");
      }
    });
  }

  return (
    <section id="products" className="mt-8 scroll-mt-28 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Product editor</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Manage the product catalog. Public storefront visibility is controlled by
            the weekly menu builder.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={syncStripeCatalog}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            Sync Stripe catalog
          </Button>
          <Button type="button" variant="secondary" onClick={newProduct} disabled={isPending}>
            <Plus size={16} />
            New product
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_minmax(0,1.2fr)]">
        <div className="grid max-h-[620px] content-start gap-2 overflow-y-auto pr-1">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => selectProduct(product)}
              disabled={isPending}
              className={`rounded-md border p-3 text-left transition ${
                selectedId === product.id
                  ? "border-[#23443b] bg-[#f7efe3]"
                  : "border-stone-200 bg-white hover:bg-stone-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-950">{product.name}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-stone-500">
                    {product.category}
                  </p>
                </div>
                <span className="text-sm font-bold text-[#23443b]">
                  {formatCurrency(product.priceCents)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-stone-700">
                {product.description}
              </p>
              <span
                className={`mt-3 inline-flex rounded-sm px-2 py-1 text-xs font-bold uppercase ${
                  product.active
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-stone-100 text-stone-500"
                }`}
              >
                {product.active ? "Active" : "Hidden"}
              </span>
              <span
                className={`ml-2 mt-3 inline-flex rounded-sm px-2 py-1 text-xs font-bold uppercase ${
                  visibleProductIds.has(product.id)
                    ? "bg-sky-50 text-sky-800"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {visibleProductIds.has(product.id) ? "Public this week" : "Not in weekly menu"}
              </span>
            </button>
          ))}
        </div>

        <div className="grid min-w-0 gap-4 rounded-md border border-stone-100 bg-[#fffaf2] p-4">
          <div className="grid min-w-0 gap-3 xl:grid-cols-[180px_minmax(0,1fr)]">
            <div
              className={`min-h-36 rounded-md border border-stone-200 bg-cover bg-center bg-no-repeat ${
                form.imageUrl ? "bg-white" : `bg-gradient-to-br ${form.imageStyle}`
              }`}
              style={
                form.imageUrl
                  ? { backgroundImage: `url(${form.imageUrl})` }
                  : undefined
              }
            />
            <div className="grid min-w-0 content-start gap-3">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Product photo
                <input
                  className="h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
                  accept="image/jpeg,image/png,image/webp"
                  type="file"
                  onChange={(event) =>
                    uploadProductImage(event.target.files?.[0] || null)
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Image URL
                <input
                  className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                  value={form.imageUrl}
                  onChange={(event) => updateForm("imageUrl", event.target.value)}
                  placeholder="Uploaded image URL"
                />
              </label>
              <p className="inline-flex items-center gap-2 text-xs leading-5 text-stone-600">
                <ImagePlus size={14} />
                JPEG, PNG, or WebP. Minimum 1000x750px. Upload first, then save.
              </p>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-stone-700">
                <p className="font-bold text-stone-900">Launch photo standard</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Use a real photo of the exact product customers will receive.</li>
                  <li>
                    Shoot a horizontal 4:3 or 3:2 frame so menu cards and product
                    pages can crop cleanly.
                  </li>
                  <li>Show crust, crumb, size, and add-ons clearly in the first frame.</li>
                  <li>
                    Use bright natural light and avoid heavy filters, dark shadows,
                    or props that hide the food.
                  </li>
                  <li>
                    Keep one consistent counter, board, or plate style across the
                    weekly menu.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Name
              <input
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Category
              <select
                className="h-11 min-w-0 rounded-md border border-stone-300 px-3 font-normal"
                value={form.category}
                onChange={(event) =>
                  updateForm("category", event.target.value as ProductCategory)
                }
              >
                <option value="bread">Bread</option>
                <option value="add-on">Add-on</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Description
            <textarea
              className="min-h-24 min-w-0 rounded-md border border-stone-300 p-3 font-normal leading-6"
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
            />
          </label>

          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Ingredients
              <textarea
                className="min-h-24 rounded-md border border-stone-300 p-3 font-normal leading-6"
                value={form.ingredients}
                onChange={(event) => updateForm("ingredients", event.target.value)}
                placeholder="flour, water, salt"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Allergens
              <textarea
                className="min-h-24 rounded-md border border-stone-300 p-3 font-normal leading-6"
                value={form.allergens}
                onChange={(event) => updateForm("allergens", event.target.value)}
                placeholder="Wheat, Milk"
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Price
              <input
                className="h-11 rounded-md border border-stone-300 px-3 font-normal"
                inputMode="decimal"
                value={form.price}
                onChange={(event) => updateForm("price", event.target.value)}
                placeholder="12.00"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Product color style
              <textarea
                className="min-h-20 min-w-0 rounded-md border border-stone-300 p-3 font-normal leading-6"
                value={form.imageStyle}
                onChange={(event) => updateForm("imageStyle", event.target.value)}
              />
            </label>
          </div>

          {!form.id ? (
            <div className="grid gap-3 rounded-md border border-stone-200 bg-white p-3 md:grid-cols-[1fr_140px_120px]">
              <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                <input
                  type="checkbox"
                  checked={form.includeInCurrentMenu}
                  onChange={(event) =>
                    updateForm("includeInCurrentMenu", event.target.checked)
                  }
                />
                Add to current weekly menu
              </label>
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Weekly quantity
                <input
                  className="h-10 rounded-md border border-stone-300 px-3 font-normal"
                  min={0}
                  type="number"
                  value={form.weeklyQuantity}
                  onChange={(event) => updateForm("weeklyQuantity", event.target.value)}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-stone-700">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(event) => updateForm("featured", event.target.checked)}
                />
                Featured
              </label>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => updateForm("active", event.target.checked)}
            />
            Active in catalog and eligible for weekly menus
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" onClick={saveProduct} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Pencil size={16} />}
              Save product
            </Button>
            {message ? (
              <span
                className={`inline-flex items-center gap-2 text-sm font-semibold ${
                  isSuccessMessage ? "text-emerald-800" : "text-[#a94334]"
                }`}
              >
                {isSuccessMessage ? <CheckCircle2 size={16} /> : null}
                {message}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
