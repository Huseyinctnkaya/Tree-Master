import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Public API endpoint for serving custom menu HTML to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/menu/:menuId
 *
 * Returns JSON: { html: string, css: string }
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const menuId = params.menuId as string;

  const menu = await prisma.customMenu.findUnique({
    where: { id: menuId },
  });

  // Only serve published menus
  if (!menu || menu.status !== "published") {
    return new Response(
      JSON.stringify({ error: "Menu not found", html: "", css: "" }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  return new Response(
    JSON.stringify({
      html: menu.html,
      css: menu.css,
      js: menu.js,
      name: menu.name,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    },
  );
};
