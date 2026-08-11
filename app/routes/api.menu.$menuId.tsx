import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Public API endpoint for serving custom menu HTML to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/menu/:menuId
 *
 * The request is verified via the App Proxy HMAC signature, so `session.shop`
 * is trustworthy and is used to scope the lookup — a menu can only ever be
 * served to the shop that owns it.
 *
 * Returns JSON: { html: string, css: string, js: string, name: string }
 */

// Signed proxy URLs carry a per-request `timestamp`, so shared/CDN caches can
// never get a hit. Keep the response private to the visitor's browser instead.
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, max-age=60",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Throws a 401 Response if the App Proxy signature is missing or invalid.
  const { session } = await authenticate.public.appProxy(request);

  // No session means the app is not installed on the shop that made the request.
  if (!session) {
    return new Response(
      JSON.stringify({ error: "App not installed", html: "", css: "" }),
      { status: 401, headers },
    );
  }

  const menuId = params.menuId as string;

  const menu = await prisma.customMenu.findFirst({
    where: { id: menuId, shop: session.shop, status: "published" },
  });

  if (!menu) {
    return new Response(
      JSON.stringify({ error: "Menu not found", html: "", css: "" }),
      { status: 404, headers },
    );
  }

  return new Response(
    JSON.stringify({
      html: menu.html,
      css: menu.css,
      js: menu.js,
      name: menu.name,
    }),
    { status: 200, headers },
  );
};
