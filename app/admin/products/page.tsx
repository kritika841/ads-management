import { AppShell } from "@/components/app-shell";
import { ProductsClient } from "@/components/admin/products-client";
import { SetupState } from "@/components/setup-state";
import { requireRole } from "@/lib/auth";
import { getNotifications, getProducts } from "@/lib/data";
import { hasSupabaseEnv } from "@/lib/supabase/server";

export default async function AdminProductsPage() {
  if (!hasSupabaseEnv()) {
    return <SetupState />;
  }

  const profile = await requireRole(["admin"]);
  const [products, notifications] = await Promise.all([getProducts(), getNotifications(profile.id)]);

  return (
    <AppShell profile={profile} notifications={notifications}>
      <ProductsClient products={products} />
    </AppShell>
  );
}
