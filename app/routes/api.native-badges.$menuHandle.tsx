import type { LoaderFunctionArgs } from "@remix-run/node";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { authenticate, PREMIUM_PLAN } from "../shopify.server";
import prisma from "../db.server";

const BILLING_QUERY = `#graphql
  query shopSubscriptions {
    currentAppInstallation {
      activeSubscriptions { name status }
    }
  }`;

/**
 * Pull the HTTP status out of a Shopify API error.
 *
 * `HttpResponseError` (and its subclasses, including `HttpThrottlingError`)
 * carry the real status on `error.response.code`. Returns undefined for
 * anything else — network failures, GraphQL-level errors, unknown throws.
 */
function httpStatusOf(error: unknown): number | undefined {
  const code = (error as { response?: { code?: unknown } })?.response?.code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Ask the Admin API whether this shop has an active Premium subscription.
 *
 * Uses the `admin` client from the authenticated App Proxy context rather than
 * reading the access token out of the session table by hand. That matters
 * because `expiringOfflineAccessTokens` is enabled: the client transparently
 * refreshes an expired/expiring token, whereas a hand-rolled fetch would just
 * get a 401.
 *
 * Throws if the API call fails — the caller decides what an indeterminate
 * result should mean for the merchant.
 *
 * Note: do not add a `response.ok` check here. On success the client wraps the
 * payload in a fresh `Response`, which is always status 200, so such a check
 * can never fire. Failures arrive as thrown `HttpResponseError`s instead.
 */
async function shopIsPremium(admin: AdminApiContext): Promise<boolean> {
  const response = await admin.graphql(BILLING_QUERY);
  const body = await response.json();

  const subs: { name: string; status: string }[] =
    body?.data?.currentAppInstallation?.activeSubscriptions ?? [];

  return subs.some((s) => s.name === PREMIUM_PLAN && s.status === "ACTIVE");
}

// Signed proxy URLs carry a per-request `timestamp`, so shared/CDN caches can
// never get a hit. Keep the response private to the visitor's browser instead.
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, max-age=60",
};

const disabled = (status: number) =>
  new Response(JSON.stringify({ badges: {}, enabled: false }), {
    status,
    headers,
  });

/**
 * Public API endpoint for serving menu badge data to the theme extension.
 * Called from the storefront via App Proxy: /apps/tree-master/native-badges/:menuHandle
 *
 * The request is verified via the App Proxy HMAC signature, so `session.shop`
 * is trustworthy. The `?shop=` query parameter is no longer read — it was
 * attacker-controlled and let anyone probe any shop's plan and badge data.
 *
 * Returns JSON: { badges: { [itemTitle]: badgeText }, enabled: boolean }
 * enabled=false when the shop is on the free plan — JS skips menu injection.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Throws a 401 Response if the App Proxy signature is missing or invalid.
  const { session, admin } = await authenticate.public.appProxy(request);

  // No session means the app is not installed on the shop that made the request.
  if (!session || !admin) return disabled(401);

  const menuHandle = params.menuHandle as string;
  if (!menuHandle) return disabled(400);

  let isPremium: boolean;
  try {
    isPremium = await shopIsPremium(admin);
  } catch (error) {
    // Distinguish "the shop is not entitled" from "we could not find out".
    //
    // A 4xx is Shopify giving a definitive answer, so we fail closed. Anything
    // else — 5xx, 429 throttling, a network blip, a token that could not be
    // refreshed — means we simply do not know, and failing closed there would
    // strip badges from a paying merchant's live storefront during an outage.
    // That was the old behaviour, and it was invisible because the error was
    // swallowed. Fail open instead, and always log why.
    const status = httpStatusOf(error);
    const definitive =
      status !== undefined && status >= 400 && status < 500 && status !== 429;

    console.error(
      `[native-badges] billing check failed for ${session.shop} ` +
        `(status=${status ?? "unknown"}) — ` +
        `${definitive ? "hiding badges" : "serving badges anyway"}`,
      error,
    );

    if (definitive) return disabled(200);
    isPremium = true;
  }

  if (!isPremium) return disabled(200);

  const meta = await prisma.menuMeta.findFirst({
    where: { shop: session.shop, menuHandle },
  });

  const badges = meta?.badgeMap ? JSON.parse(meta.badgeMap) : {};

  return new Response(JSON.stringify({ badges, enabled: true }), {
    status: 200,
    headers,
  });
};
