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
  ProgressBar,
} from "@shopify/polaris";
import { ChevronUpIcon, ChevronDownIcon, EmailIcon, QuestionCircleIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MENUS_QUERY = `#graphql
  query GetMenusStats {
    menus(first: 50) {
      edges {
        node {
          id
          title
          items {
            id
            title
            url
            type
            items {
              id
              title
              url
              type
            }
          }
        }
      }
    }
  }
`;

function countEmptyMenus(menus: any[]): string[] {
  return menus
    .filter(({ node }: any) => !node.items || node.items.length === 0)
    .map(({ node }: any) => node.title);
}

function countMissingUrlItems(items: any[]): number {
  let count = 0;
  for (const item of items) {
    if (item.type === "HTTP" && (!item.url || item.url.trim() === "")) count++;
    if (item.items) count += countMissingUrlItems(item.items);
  }
  return count;
}

function countEmptyTitleItems(items: any[]): number {
  let count = 0;
  for (const item of items) {
    if (!item.title || item.title.trim() === "") count++;
    if (item.items) count += countEmptyTitleItems(item.items);
  }
  return count;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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

  // Health
  const emptyMenus = countEmptyMenus(menus);
  let missingUrlCount = 0;
  let emptyTitleCount = 0;
  for (const { node } of menus) {
    missingUrlCount += countMissingUrlItems(node.items ?? []);
    emptyTitleCount += countEmptyTitleItems(node.items ?? []);
  }

  let healthScore = 100;
  if (emptyMenus.length > 0) healthScore -= emptyMenus.length * 10;
  if (emptyTitleCount > 0) healthScore -= emptyTitleCount * 5;
  if (missingUrlCount > 0) healthScore -= missingUrlCount * 5;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const [menuMetaCount, publishedCustomMenuCount] = await Promise.all([
    prisma.menuMeta.count({ where: { shop: session.shop } }),
    prisma.customMenu.count({ where: { shop: session.shop, status: "published" } }),
  ]);
  const deployedCount = menuMetaCount + publishedCustomMenuCount;

  // Check if app embed is enabled in the active theme
  let embedEnabled = false;
  try {
    const themesRes = await admin.graphql(
      `query { themes(first: 20) { edges { node { id role } } } }`
    );
    const themesData = await themesRes.json();
    const mainTheme = themesData.data?.themes?.edges?.find(
      ({ node }: any) => node.role === "MAIN"
    )?.node;
    if (mainTheme) {
      const themeNumericId = mainTheme.id.split("/").pop();
      const assetRes = await fetch(
        `https://${session.shop}/admin/api/2026-04/themes/${themeNumericId}/assets.json?asset[key]=config/settings_data.json`,
        { headers: { "X-Shopify-Access-Token": session.accessToken } }
      );
      if (assetRes.ok) {
        const assetData = await assetRes.json();
        const settingsJson = JSON.parse(assetData.asset?.value ?? "{}");
        const blocks = settingsJson?.current?.blocks ?? {};
        embedEnabled = Object.values(blocks).some(
          (block: any) =>
            typeof block.type === "string" &&
            (block.type.includes("tree-master") || block.type.includes("tree-menu")) &&
            !block.disabled
        );
      }
    }
  } catch (_) {
    // ignore, embedEnabled stays false
  }

  return {
    totalMenus,
    totalItems,
    healthScore,
    emptyMenus,
    missingUrlCount,
    emptyTitleCount,
    hasMenus: totalMenus > 0,
    hasDeployed: deployedCount > 0,
    embedEnabled,
  };
};

function buildSteps(hasMenus: boolean, hasDeployed: boolean, embedEnabled: boolean) {
  return [
    {
      id: "1",
      title: "Enable the app",
      description: "Enable the Tree Master embed block in your theme to activate the app.",
      done: embedEnabled,
      action: { label: "Open Theme Editor", url: "shopify://admin/themes/current/editor" },
    },
    {
      id: "2",
      title: "Browse your menus",
      description: "View all your store's navigation menus and their structure.",
      done: hasMenus,
      action: { label: "Browse menus", url: "/app/menus" },
    },
    {
      id: "3",
      title: "Edit and deploy a menu",
      description:
        "Open a menu, update its items, then deploy changes live to your store.",
      done: hasDeployed,
      action: { label: "Go to menus", url: "/app/menus" },
    },
  ];
}

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
  const {
    healthScore,
    emptyMenus,
    missingUrlCount,
    emptyTitleCount,
    hasMenus,
    hasDeployed,
    embedEnabled,
  } = useLoaderData<typeof loader>();

  const STEPS = buildSteps(hasMenus, hasDeployed, embedEnabled);
  const completedCount = STEPS.filter((s) => s.done).length;

  const healthTone = healthScore >= 80 ? "success" : "critical" as const;
  const healthBadgeTone = healthScore >= 80 ? "success" : healthScore >= 50 ? "warning" : "critical" as const;

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

            {/* Menu Health */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Menu Health
                  </Text>
                  <Badge tone={healthBadgeTone}>{`${healthScore}/100`}</Badge>
                </InlineStack>
                <ProgressBar
                  progress={healthScore}
                  tone={healthTone}
                  size="small"
                />
                <BlockStack gap="200">
                  {emptyMenus.length > 0 && (
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#D72C0D",
                          flexShrink: 0,
                        }}
                      />
                      <Text as="p" variant="bodySm">
                        {emptyMenus.length} empty menu(s): {emptyMenus.join(", ")}
                      </Text>
                    </InlineStack>
                  )}
                  {missingUrlCount > 0 && (
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#FFC453",
                          flexShrink: 0,
                        }}
                      />
                      <Text as="p" variant="bodySm">
                        {missingUrlCount} item(s) with missing URL
                      </Text>
                    </InlineStack>
                  )}
                  {emptyTitleCount > 0 && (
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#FFC453",
                          flexShrink: 0,
                        }}
                      />
                      <Text as="p" variant="bodySm">
                        {emptyTitleCount} item(s) without title
                      </Text>
                    </InlineStack>
                  )}
                  {emptyMenus.length === 0 && missingUrlCount === 0 && emptyTitleCount === 0 && (
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#008060",
                          flexShrink: 0,
                        }}
                      />
                      <Text as="p" variant="bodySm">
                        All menus are healthy — no issues detected
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Quick Actions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
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
                    Custom Menus
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Build menus with custom HTML & CSS code. Mega menus, sidebars, and more.
                  </Text>
                  <InlineStack>
                    <Button variant="primary" url="/app/custom-menus">
                      Custom Menus
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
                      Import/Export
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
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
