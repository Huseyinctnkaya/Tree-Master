import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
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
import { ChevronUpIcon, ChevronDownIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const MENUS_QUERY = `#graphql
  query GetMenusStats {
    menus(first: 50) {
      edges {
        node {
          id
          items {
            id
            items { id }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(MENUS_QUERY);
  const data = await response.json();

  const menus = data.data?.menus?.edges ?? [];
  const totalMenus = menus.length;
  const totalItems = menus.reduce((acc: number, { node }: any) => {
    const topLevel = node.items?.length ?? 0;
    const subItems = (node.items ?? []).reduce(
      (s: number, item: any) => s + (item.items?.length ?? 0),
      0,
    );
    return acc + topLevel + subItems;
  }, 0);

  return { totalMenus, totalItems };
};

const STEPS = [
  {
    number: "1",
    title: "Enable the app",
    description: "",
    done: true,
    action: null,
  },
  {
    number: "2",
    title: "Browse your menus",
    description: "View all your store's navigation menus in one place.",
    done: false,
    action: { label: "View menus", url: "/app/menus" },
  },
  {
    number: "3",
    title: "Edit & deploy a menu",
    description: "Edit menu items, save as a draft, and deploy changes to your live store.",
    done: false,
    action: { label: "Go to menus", url: "/app/menus" },
  },
];

const completedCount = STEPS.filter((s) => s.done).length;

// Icons
function DoneIcon() {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: "#303030",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
        <path
          d="M1 5L4.5 8.5L11 1.5"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PendingIcon({ active }: { active: boolean }) {
  return (
    <div
      style={{
        width: active ? 28 : 24,
        height: active ? 28 : 24,
        borderRadius: "50%",
        border: `2px dashed ${active ? "#8c8c8c" : "#C9CCCF"}`,
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    />
  );
}

export default function Dashboard() {
  const { totalMenus, totalItems } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [guideOpen, setGuideOpen] = useState(true);
  // Start with the first incomplete step active
  const firstIncomplete = STEPS.findIndex((s) => !s.done);
  const [activeStep, setActiveStep] = useState(firstIncomplete);

  return (
    <Page>
      <TitleBar title="Tree Master" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Hero */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="h1" variant="headingXl">
                      Tree Master
                    </Text>
                    <Badge tone="success">Active</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyLg" tone="subdued">
                    Manage your Shopify store's navigation menus — edit items,
                    save drafts, and deploy changes safely.
                  </Text>
                </BlockStack>
                <InlineStack gap="400" blockAlign="center">
                  <Button variant="primary" url="/app/menus">
                    View all menus
                  </Button>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {totalMenus} menus · {totalItems} items
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Setup Guide */}
            <Card padding="0">
              {/* Header */}
              <Box paddingBlock="400" paddingInline="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Setup Guide
                      </Text>
                      <Badge>{`${completedCount} / ${STEPS.length} completed`}</Badge>
                    </InlineStack>
                    {guideOpen && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Use this personalized guide to get your app up and running.
                      </Text>
                    )}
                  </BlockStack>
                  <Button
                    variant="plain"
                    icon={guideOpen ? ChevronUpIcon : ChevronDownIcon}
                    onClick={() => setGuideOpen((o) => !o)}
                    accessibilityLabel={guideOpen ? "Collapse" : "Expand"}
                  />
                </InlineStack>
              </Box>

              {/* Steps */}
              {guideOpen && (
                <BlockStack gap="0">
                  {STEPS.map((step, index) => {
                    const isActive = !step.done && index === activeStep;

                    return (
                      <div key={step.number}>
                        <Divider />
                        <Box
                          paddingBlock="400"
                          paddingInline="400"
                          background={isActive ? "bg-surface-secondary" : "bg-surface"}
                        >
                          <div
                            style={{ cursor: step.done ? "default" : "pointer" }}
                            onClick={() => {
                              if (!step.done) setActiveStep(index);
                            }}
                          >
                            <InlineStack gap="400" blockAlign="center">
                              {step.done ? <DoneIcon /> : <PendingIcon active={isActive} />}

                              <BlockStack gap="100">
                                <Text
                                  as="span"
                                  variant="bodyMd"
                                  fontWeight={isActive ? "semibold" : "regular"}
                                >
                                  {step.title}
                                </Text>
                                {step.done && (
                                  <Text as="p" variant="bodySm" tone="success">
                                    Completed
                                  </Text>
                                )}
                              </BlockStack>
                            </InlineStack>
                          </div>

                          {/* Expanded content */}
                          {isActive && step.description && (
                            <Box paddingBlockStart="300" paddingInlineStart="1600">
                              <BlockStack gap="300">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {step.description}
                                </Text>
                                {step.action && (
                                  <div>
                                    <button
                                      onClick={() => navigate(step.action!.url)}
                                      style={{
                                        background: "#1a1a1a",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "8px 16px",
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        lineHeight: 1.4,
                                      }}
                                    >
                                      {step.action.label}
                                    </button>
                                  </div>
                                )}
                              </BlockStack>
                            </Box>
                          )}
                        </Box>
                      </div>
                    );
                  })}
                </BlockStack>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
