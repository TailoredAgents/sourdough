"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, ImagePlus, Loader2, Pencil, Plus } from "lucide-react";
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
  };
}

export function ProductEditor({ initialProducts }: { initialProducts: Product[] }) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
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
    startTransition(async () => {
      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      const payload = (await response.json()) as {
        products?: Product[];
        error?: string;
      };

      if (!response.ok || !payload.products) {
        setMessage(payload.error || "Product could not be saved.");
        return;
      }

      setProducts(payload.products);
      const savedProduct = payload.products.find(
        (product) => product.name.toLowerCase() === form.name.trim().toLowerCase(),
      );
      setSelectedId(savedProduct?.id ?? payload.products[0]?.id ?? null);
      setForm(productToForm(savedProduct ?? payload.products[0]));
      setMessage("Product saved.");
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

  return (
    <section className="mt-8 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-bold text-stone-950">Product editor</h2>
          <p className="mt-1 text-sm leading-6 text-stone-700">
            Manage the product catalog that powers the public storefront.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={newProduct}>
          <Plus size={16} />
          New product
        </Button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid max-h-[620px] content-start gap-2 overflow-y-auto pr-1">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => selectProduct(product)}
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
            </button>
          ))}
        </div>

        <div className="grid gap-3 rounded-md border border-stone-100 bg-[#fffaf2] p-4">
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
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
            <div className="grid content-start gap-3">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Product photo
                <input
                  className="h-11 rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
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
                  className="h-11 rounded-md border border-stone-300 px-3 font-normal"
                  value={form.imageUrl}
                  onChange={(event) => updateForm("imageUrl", event.target.value)}
                  placeholder="Uploaded image URL"
                />
              </label>
              <p className="inline-flex items-center gap-2 text-xs leading-5 text-stone-600">
                <ImagePlus size={14} />
                JPEG, PNG, or WebP. Upload first, then save the product.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Name
              <input
                className="h-11 rounded-md border border-stone-300 px-3 font-normal"
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Category
              <select
                className="h-11 rounded-md border border-stone-300 px-3 font-normal"
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
              className="min-h-24 rounded-md border border-stone-300 p-3 font-normal leading-6"
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
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
              <input
                className="h-11 rounded-md border border-stone-300 px-3 font-normal"
                value={form.imageStyle}
                onChange={(event) => updateForm("imageStyle", event.target.value)}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => updateForm("active", event.target.checked)}
            />
            Active on storefront and menus
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" onClick={saveProduct} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" size={16} /> : <Pencil size={16} />}
              Save product
            </Button>
            {message ? (
              <span
                className={`inline-flex items-center gap-2 text-sm font-semibold ${
                  message === "Product saved." || message.startsWith("Image uploaded")
                    ? "text-emerald-800"
                    : "text-[#a94334]"
                }`}
              >
                {message === "Product saved." || message.startsWith("Image uploaded") ? (
                  <CheckCircle2 size={16} />
                ) : null}
                {message}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
