import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Public API endpoint for serving menu badge data to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/native-badges/:menuHandle?shop=...
 *
 * Returns JSON: { badges: { [itemTitle]: badgeText } }
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
    return new Response(JSON.stringify({ badges: {} }), { status: 400, headers });
  }

  const meta = await prisma.menuMeta.findFirst({
    where: { shop, menuHandle },
  });

  const badges = meta?.badgeMap ? JSON.parse(meta.badgeMap) : {};

  return new Response(JSON.stringify({ badges }), { status: 200, headers });
};
