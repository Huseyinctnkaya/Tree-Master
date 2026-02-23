import { useState, useRef, useEffect, useCallback } from "react";
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
  Icon,
} from "@shopify/polaris";
import { ChevronUpIcon, ChevronDownIcon, EmailIcon, QuestionCircleIcon } from "@shopify/polaris-icons";
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
    id: "1",
    title: "Enable the app",
    description: null,
    done: true,
    action: null,
  },
  {
    id: "2",
    title: "Browse your menus",
    description:
      "View all your store's navigation menus and their structure.",
    done: false,
    action: { label: "Browse menus", url: "/app/menus" },
  },
  {
    id: "3",
    title: "Edit and deploy a menu",
    description:
      "Open a menu, update its items, then deploy changes live to your store.",
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
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "#303030",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="10" height="8" viewBox="0 0 12 10" fill="none">
        <path
          d="M1 5L4.5 8.5L11 1.5"
          stroke="white"
          strokeWidth="2.5"
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
        width: active ? 20 : 18,
        height: active ? 20 : 18,
        borderRadius: "50%",
        border: `2px dashed ${active ? "#8c8c8c" : "#C9CCCF"}`,
        flexShrink: 0,
        transition: "all 0.15s",
      }}
    />
  );
}

export default function Dashboard() {
  useLoaderData<typeof loader>();

  const [guideOpen, setGuideOpen] = useState(true);
  const [guideVisible, setGuideVisible] = useState(true);
  const stepsRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(-1);

  const toggleGuide = useCallback(() => {
    if (guideOpen) {
      // Closing: animate first, then hide
      setGuideVisible(false);
      setTimeout(() => setGuideOpen(false), 250);
    } else {
      // Opening: show first, then animate
      setGuideOpen(true);
      requestAnimationFrame(() => setGuideVisible(true));
    }
  }, [guideOpen]);

  useEffect(() => {
    if (guideOpen) {
      requestAnimationFrame(() => setGuideVisible(true));
    }
  }, [guideOpen]);

  return (
    <Page>
      <TitleBar title="Tree Master" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Hero */}
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl">
                Tree Master
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Manage your Shopify store's navigation menus — edit items,
                save drafts, and deploy changes safely.
              </Text>
            </BlockStack>

            {/* Setup Guide */}
            <Card padding="0">
              {/* Header */}
              <Box paddingBlock="400" paddingInline="400">
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Text as="h2" variant="headingMd">
                        Setup Guide
                      </Text>
                      <Badge>{`${completedCount} / ${STEPS.length} completed`}</Badge>
                    </InlineStack>
                    <Button
                      variant="plain"
                      icon={guideOpen ? ChevronUpIcon : ChevronDownIcon}
                      onClick={toggleGuide}
                      accessibilityLabel={guideOpen ? "Collapse" : "Expand"}
                    />
                  </InlineStack>
                  {guideOpen && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Use this personalized guide to get your app up and running.
                    </Text>
                  )}
                </BlockStack>
              </Box>

              {/* Steps */}
              {guideOpen && (
                <div
                  ref={stepsRef}
                  style={{
                    overflow: "hidden",
                    maxHeight: guideVisible ? 600 : 0,
                    opacity: guideVisible ? 1 : 0,
                    transition: "max-height 0.25s ease, opacity 0.2s ease",
                  }}
                >
                  <BlockStack gap="0">
                    {STEPS.map((step, index) => {
                      const isActive = index === activeStep;

                      return (
                        <div key={step.id}>
                          <Divider />
                          <Box
                            paddingBlock="400"
                            paddingInline="400"
                          >
                            <div
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                setActiveStep(isActive ? -1 : index);
                              }}
                            >
                              <InlineStack gap="400" blockAlign="center">
                                {step.done ? <DoneIcon /> : <PendingIcon active={isActive} />}

                                <BlockStack gap="100">
                                  <InlineStack gap="200" blockAlign="center">
                                    <Text
                                      as="span"
                                      variant="bodyMd"
                                      fontWeight={isActive ? "semibold" : "regular"}
                                    >
                                      {step.title}
                                    </Text>
                                    {step.done && (
                                      <Badge tone="success">Completed</Badge>
                                    )}
                                  </InlineStack>
                                </BlockStack>
                              </InlineStack>
                            </div>

                            {/* Expanded content */}
                            <div
                              style={{
                                overflow: "hidden",
                                maxHeight: isActive && step.description ? 200 : 0,
                                opacity: isActive && step.description ? 1 : 0,
                                transition: "max-height 0.2s ease, opacity 0.15s ease",
                              }}
                            >
                              <Box paddingBlockStart="200" paddingInlineStart="1200">
                                <BlockStack gap="300">
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {step.description}
                                  </Text>
                                  {step.action && (
                                    <InlineStack>
                                      <Button variant="primary" url={step.action.url}>
                                        {step.action.label}
                                      </Button>
                                    </InlineStack>
                                  )}
                                </BlockStack>
                              </Box>
                            </div>
                          </Box>
                        </div>
                      );
                    })}
                  </BlockStack>
                </div>
              )}
            </Card>

            {/* Quick Actions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Menus
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    View and manage your store's navigation menus, edit items, and deploy changes.
                  </Text>
                  <InlineStack>
                    <Button variant="primary" url="/app/menus">
                      View Menus
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Import & Export
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Backup your menus and settings, or transfer them to another store.
                  </Text>
                  <InlineStack>
                    <Button variant="primary" url="/app/import-export">
                      Import/Export Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </div>

            {/* Help & Support */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Need help or customization?
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div
                    style={{
                      border: "1px solid #E1E3E5",
                      borderRadius: 12,
                      padding: 16,
                      cursor: "pointer",
                    }}
                    onClick={() => window.open("mailto:support@treemaster.app")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", flexShrink: 0 }}>
                        <Icon source={EmailIcon} />
                      </div>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        Email Support
                      </Text>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Send us an email and we'll get back to you as soon as possible.
                      </Text>
                    </div>
                  </div>
                  <div
                    style={{
                      border: "1px solid #E1E3E5",
                      borderRadius: 12,
                      padding: 16,
                      cursor: "pointer",
                    }}
                    onClick={() => window.open("https://treemaster.app/docs", "_blank")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", flexShrink: 0 }}>
                        <Icon source={QuestionCircleIcon} />
                      </div>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        Documentation
                      </Text>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Find solutions with our docs and tutorials.
                      </Text>
                    </div>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
