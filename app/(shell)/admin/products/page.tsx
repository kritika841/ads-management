import { ProductsClient } from "@/components/admin/products-client";
import { requireRole } from "@/lib/auth";
import { getProducts } from "@/lib/data";

export default async function AdminProductsPage() {
  await requireRole(["admin"]);
  const products = await getProducts();

  return <ProductsClient products={products} />;
}
