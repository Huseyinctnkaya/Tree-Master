import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";

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
      { text: "All item types (URL, Page, Collection...)", included: true },
      { text: "2-level nesting", included: true },
      { text: "Export menus to JSON", included: true },
      { text: "Import menus from JSON", included: false },
      { text: "Unlimited menus", included: false },
      { text: "Deep nesting (3+ levels)", included: false },
      { text: "Menu analytics & health score", included: false },
      { text: "Snapshot history & restore", included: false },
      { text: "Priority support", included: false },
    ],
    action: null,
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
      { text: "All item types (URL, Page, Collection...)", included: true },
      { text: "Deep nesting (unlimited levels)", included: true },
      { text: "Export menus to JSON", included: true },
      { text: "Import menus from JSON", included: true },
      { text: "Menu analytics & health score", included: true },
      { text: "Snapshot history & restore", included: true },
      { text: "Undo / Redo support", included: true },
      { text: "Priority email support", included: true },
      { text: "Early access to new features", included: true },
    ],
    action: "Upgrade",
  },
];

// ---- Loader ----

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // TODO: fetch current plan from billing API
  return { currentPlan: "free" };
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
              const isCurrent =
                currentPlan === plan.name.toLowerCase();

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
                          {plan.badge && (
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
                        ) : plan.action ? (
                          <Button variant="primary" fullWidth>
                            {plan.action}
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
