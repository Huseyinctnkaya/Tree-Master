import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Box,
  Divider,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getShopPlan, requestSubscription, cancelSubscription } from "../utils/billing.server";

// ---- Plan Data ----

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get started with essential menu management tools.",
    badge: null,
    features: [
      { text: "Up to 3 menus", included: true },
      { text: "Drag & drop menu editor", included: true },
      { text: "21+ link types", included: true },
      { text: "1 Custom Code menu", included: true },
      { text: "Export menus to JSON", included: true },
      { text: "Scheduled Publishing", included: false },
      { text: "Menu analytics & health score", included: false },
      { text: "Snapshot history & restore", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    name: "Premium",
    price: "$4.99",
    period: "/month",
    description: "Unlock the full power of Tree Master for your store.",
    badge: "Recommended",
    features: [
      { text: "Unlimited menus", included: true },
      { text: "Drag & drop menu editor", included: true },
      { text: "21+ link types", included: true },
      { text: "Unlimited Custom Code menus", included: true },
      { text: "Export & Import menus (JSON)", included: true },
      { text: "Scheduled Publishing", included: true },
      { text: "Menu analytics & health score", included: true },
      { text: "Snapshot history & restore", included: true },
      { text: "Priority email support", included: true },
    ],
  },
];

// ---- Loader ----

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { isPremium } = await getShopPlan(request);
  return { currentPlan: isPremium ? "premium" : "free" };
};

// ---- Action ----

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "upgrade") {
    // This will redirect the merchant to Shopify's billing approval screen
    await requestSubscription(request);
    // If we reach here, it means the redirect didn't happen (shouldn't normally)
    return { success: true };
  }

  if (intent === "downgrade") {
    const result = await cancelSubscription(request);
    return result;
  }

  return { success: false };
};

// ---- Component ----

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M13.3 4.3a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L6.6 9.6l5.3-5.3a1 1 0 0 1 1.4 0z"
        fill="#008060"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M11.4 4.6a1 1 0 0 1 0 1.4L9.4 8l2 2a1 1 0 0 1-1.4 1.4L8 9.4l-2 2A1 1 0 0 1 4.6 10l2-2-2-2A1 1 0 0 1 6 4.6l2 2 2-2a1 1 0 0 1 1.4 0z"
        fill="#8C9196"
      />
    </svg>
  );
}

export default function Pricing() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  const handleUpgrade = () => {
    const formData = new FormData();
    formData.set("intent", "upgrade");
    submit(formData, { method: "post" });
  };

  const handleDowngrade = () => {
    const formData = new FormData();
    formData.set("intent", "downgrade");
    submit(formData, { method: "post" });
  };

  return (
    <Page backAction={{ content: "Dashboard", url: "/app" }} title="Plans">
      <TitleBar title="Plans" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              Choose the plan that best fits your store's needs. Upgrade or
              downgrade at any time.
            </Text>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {PLANS.map((plan) => {
              const planKey = plan.name.toLowerCase();
              const isCurrent = currentPlan === planKey;
              const isPremiumPlan = planKey === "premium";
              const isFreePlan = planKey === "free";

              return (
                <div key={plan.name}>
                  <Card>
                    <BlockStack gap="400">
                      {/* Header */}
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h2" variant="headingLg">
                            {plan.name}
                          </Text>
                          {plan.badge && !isCurrent && (
                            <Badge tone="info">{plan.badge}</Badge>
                          )}
                          {isCurrent && (
                            <Badge tone="success">Current Plan</Badge>
                          )}
                        </InlineStack>
                        <InlineStack gap="100" blockAlign="end">
                          <Text as="span" variant="heading2xl">
                            {plan.price}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {plan.period}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {plan.description}
                        </Text>
                      </BlockStack>

                      <Divider />

                      {/* Features */}
                      <BlockStack gap="300">
                        {plan.features.map((feature, i) => (
                          <InlineStack key={i} gap="200" blockAlign="center" wrap={false}>
                            <div style={{ flexShrink: 0 }}>
                              {feature.included ? (
                                <CheckIcon />
                              ) : (
                                <CrossIcon />
                              )}
                            </div>
                            <Text
                              as="span"
                              variant="bodySm"
                              tone={feature.included ? undefined : "subdued"}
                            >
                              {feature.text}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>

                      {/* Action */}
                      <Box paddingBlockStart="200">
                        {isCurrent ? (
                          <Button disabled fullWidth>
                            Current Plan
                          </Button>
                        ) : isPremiumPlan ? (
                          <Button
                            variant="primary"
                            fullWidth
                            onClick={handleUpgrade}
                            loading={isSubmitting}
                          >
                            Upgrade to Premium
                          </Button>
                        ) : isFreePlan && currentPlan === "premium" ? (
                          <Button
                            fullWidth
                            onClick={handleDowngrade}
                            loading={isSubmitting}
                          >
                            Downgrade to Free
                          </Button>
                        ) : (
                          <Button fullWidth disabled>
                            Free
                          </Button>
                        )}
                      </Box>
                    </BlockStack>
                  </Card>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        {/* Bottom spacing */}
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
