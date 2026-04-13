import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

type ShopifyMenuItem = {
  title: string;
  url: string;
  items: ShopifyMenuItem[];
};

const GET_MENU_BY_HANDLE_QUERY = `
  query GetMenuByHandle($query: String!) {
    menus(first: 1, query: $query) {
      edges {
        node {
          items {
            title
            url
            items {
              title
              url
              items {
                title
                url
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Public API endpoint for serving native menu data + badge map to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/native-badges/:menuHandle?shop=...
 *
 * Returns JSON: { items: ShopifyMenuItem[], badges: { [itemTitle]: badgeText } }
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const menuHandle = params.menuHandle as string;
  const shop = new URL(request.url).searchParams.get("shop");

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=30",
  };

  if (!shop || !menuHandle) {
    return new Response(JSON.stringify({ badges: {}, items: [] }), {
      status: 400,
      headers,
    });
  }

  // Get badge map from DB
  const meta = await prisma.menuMeta.findFirst({
    where: { shop, menuHandle },
  });
  const badges: Record<string, string> = meta?.badgeMap
    ? JSON.parse(meta.badgeMap)
    : {};

  // Fetch live menu items from Shopify Admin API
  let items: ShopifyMenuItem[] = [];
  try {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
    });

    if (session?.accessToken) {
      const response = await fetch(
        `https://${shop}/admin/api/2026-04/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
          body: JSON.stringify({
            query: GET_MENU_BY_HANDLE_QUERY,
            variables: { query: `handle:'${menuHandle}'` },
          }),
        },
      );

      const data = await response.json();
      items = data?.data?.menus?.edges?.[0]?.node?.items ?? [];
    }
  } catch {
    // Fail silently — badges still returned even if menu fetch fails
  }

  return new Response(JSON.stringify({ badges, items }), {
    status: 200,
    headers,
  });
};
