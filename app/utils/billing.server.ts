import { authenticate } from "../shopify.server";
import { PREMIUM_PLAN } from "../shopify.server";

/**
 * Check if the current shop has an active Premium subscription.
 * Returns { isPremium, billingCheck } where billingCheck is the raw response.
 */
export async function getShopPlan(request: Request) {
  const { billing } = await authenticate.admin(request);

  try {
    const billingCheck = await billing.check({
      plans: [PREMIUM_PLAN],
      isTest: true, // Set to false for production
    });

    const isPremium = billingCheck.hasActivePayment;

    return { isPremium, billing };
  } catch {
    return { isPremium: false, billing };
  }
}

/**
 * Request a Premium subscription. Returns a confirmation URL to redirect to.
 */
export async function requestSubscription(request: Request) {
  const { billing } = await authenticate.admin(request);

  const response = await billing.request({
    plan: PREMIUM_PLAN,
    isTest: true, // Set to false for production
  });

  return response;
}

/**
 * Cancel the current subscription.
 */
export async function cancelSubscription(request: Request) {
  const { billing } = await authenticate.admin(request);

  const billingCheck = await billing.check({
    plans: [PREMIUM_PLAN],
    isTest: true,
  });

  if (billingCheck.hasActivePayment && billingCheck.appSubscriptions?.[0]) {
    const subscription = billingCheck.appSubscriptions[0];
    await billing.cancel({
      subscriptionId: subscription.id,
      isTest: true,
      prorate: true,
    });
    return { success: true };
  }

  return { success: false, error: "No active subscription found." };
}

export { PREMIUM_PLAN };
