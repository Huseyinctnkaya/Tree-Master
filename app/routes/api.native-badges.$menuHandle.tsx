import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

const BILLING_QUERY = `{
  currentAppInstallation {
    activeSubscriptions { name status }
  }
}`;

async function shopIsPremium(shop: string): Promise<boolean> {
  try {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      orderBy: { expires: "desc" },
    });
    if (!session?.accessToken) return false;

    const res = await fetch(
      `https://${shop}/admin/api/2025-04/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: BILLING_QUERY }),
      }
    );
    if (!res.ok) return false;
    const json = await res.json();
    const subs: { name: string; status: string }[] =
      json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    return subs.some((s) => s.name === "Premium" && s.status === "ACTIVE");
  } catch {
    return false;
  }
}

/**
 * Public API endpoint for serving menu badge data to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/native-badges/:menuHandle?shop=...
 *
 * Returns JSON: { badges: { [itemTitle]: badgeText }, enabled: boolean }
 * enabled=false when shop is on the free plan — JS skips menu injection.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const menuHandle = params.menuHandle as string;
  const shop = new URL(request.url).searchParams.get("shop");

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60",
  };

  if (!shop || !menuHandle) {
    return new Response(JSON.stringify({ badges: {}, enabled: false }), { status: 400, headers });
  }

  const isPremium = await shopIsPremium(shop);
  if (!isPremium) {
    return new Response(JSON.stringify({ badges: {}, enabled: false }), { status: 200, headers });
  }

  const meta = await prisma.menuMeta.findFirst({
    where: { shop, menuHandle },
  });

  const badges = meta?.badgeMap ? JSON.parse(meta.badgeMap) : {};

  return new Response(JSON.stringify({ badges, enabled: true }), { status: 200, headers });
};
