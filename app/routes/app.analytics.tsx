import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Box,
  Divider,
  Badge,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// ---- Types ----

type MenuItem = {
  id: string;
  title: string;
  url: string;
  type: string;
  resourceId: string | null;
  items: MenuItem[];
};

type MenuNode = {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
};

type TypeStat = {
  type: string;
  label: string;
  count: number;
  percentage: number;
};

type MenuStat = {
  id: string;
  title: string;
  handle: string;
  topLevelCount: number;
  totalCount: number;
  maxDepth: number;
  types: Record<string, number>;
};

// ---- GraphQL ----

const GET_ALL_MENUS_QUERY = `#graphql
  query GetAllMenus {
    menus(first: 50) {
      edges {
        node {
          id
          handle
          title
          items {
            id
            title
            url
            type
            resourceId
            items {
              id
              title
              url
              type
              resourceId
            }
          }
        }
      }
    }
  }
`;

// ---- Helpers ----

const TYPE_LABELS: Record<string, string> = {
  HTTP: "Custom URL",
  FRONTPAGE: "Home",
  CATALOG: "All Products",
  SEARCH: "Search",
  COLLECTION: "Collection",
  PRODUCT: "Product",
  PAGE: "Page",
  BLOG: "Blog",
  ARTICLE: "Article",
  FRONTEND_PAGE: "Frontend Page",
};

function countItems(items: MenuItem[]): number {
  let count = items.length;
  for (const item of items) {
    count += countItems(item.items ?? []);
  }
  return count;
}

function getMaxDepth(items: MenuItem[], depth = 1): number {
  if (items.length === 0) return depth - 1;
  let max = depth;
  for (const item of items) {
    if (item.items && item.items.length > 0) {
      max = Math.max(max, getMaxDepth(item.items, depth + 1));
    }
  }
  return max;
}

function collectTypes(items: MenuItem[], acc: Record<string, number> = {}): Record<string, number> {
  for (const item of items) {
    const t = item.type || "HTTP";
    acc[t] = (acc[t] || 0) + 1;
    if (item.items) collectTypes(item.items, acc);
  }
  return acc;
}

function getItemsWithoutUrl(items: MenuItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.type === "HTTP" && (!item.url || item.url.trim() === "")) {
      result.push(item.title || "(Untitled)");
    }
    if (item.items) {
      result.push(...getItemsWithoutUrl(item.items));
    }
  }
  return result;
}

function getEmptyTitleItems(items: MenuItem[]): number {
  let count = 0;
  for (const item of items) {
    if (!item.title || item.title.trim() === "") count++;
    if (item.items) count += getEmptyTitleItems(item.items);
  }
  return count;
}

// ---- Loader ----

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(GET_ALL_MENUS_QUERY);
  const data = await response.json();

  const menus: MenuNode[] = (data.data?.menus?.edges ?? []).map(({ node }: any) => ({
    id: node.id,
    handle: node.handle,
    title: node.title,
    items: node.items ?? [],
  }));

  // Per-menu stats
  const menuStats: MenuStat[] = menus.map((menu) => ({
    id: menu.id,
    title: menu.title,
    handle: menu.handle,
    topLevelCount: menu.items.length,
    totalCount: countItems(menu.items),
    maxDepth: menu.items.length > 0 ? getMaxDepth(menu.items) : 0,
    types: collectTypes(menu.items),
  }));

  // Global stats
  const totalMenus = menus.length;
  const totalItems = menuStats.reduce((s, m) => s + m.totalCount, 0);
  const avgItemsPerMenu = totalMenus > 0 ? Math.round((totalItems / totalMenus) * 10) / 10 : 0;
  const maxDepthGlobal = menuStats.reduce((max, m) => Math.max(max, m.maxDepth), 0);

  // Type distribution
  const globalTypes: Record<string, number> = {};
  for (const m of menuStats) {
    for (const [type, count] of Object.entries(m.types)) {
      globalTypes[type] = (globalTypes[type] || 0) + count;
    }
  }

  const typeStats: TypeStat[] = Object.entries(globalTypes)
    .map(([type, count]) => ({
      type,
      label: TYPE_LABELS[type] || type,
      count,
      percentage: totalItems > 0 ? Math.round((count / totalItems) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Health checks
  const emptyMenus = menus.filter((m) => m.items.length === 0).map((m) => m.title);

  const missingUrlItems: { menu: string; items: string[] }[] = [];
  for (const menu of menus) {
    const missing = getItemsWithoutUrl(menu.items);
    if (missing.length > 0) {
      missingUrlItems.push({ menu: menu.title, items: missing });
    }
  }

  const emptyTitleCount = menus.reduce((s, m) => s + getEmptyTitleItems(m.items), 0);

  // Largest menu
  const largestMenu = menuStats.length > 0
    ? menuStats.reduce((a, b) => (a.totalCount >= b.totalCount ? a : b))
    : null;

  return {
    totalMenus,
    totalItems,
    avgItemsPerMenu,
    maxDepthGlobal,
    menuStats,
    typeStats,
    emptyMenus,
    missingUrlItems,
    emptyTitleCount,
    largestMenu: largestMenu ? { title: largestMenu.title, count: largestMenu.totalCount } : null,
  };
};

// ---- Component ----

function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="headingXl">
          {String(value)}
        </Text>
        {subtitle && (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Analytics() {
  const {
    totalMenus,
    totalItems,
    avgItemsPerMenu,
    maxDepthGlobal,
    menuStats,
    typeStats,
    emptyMenus,
    missingUrlItems,
    emptyTitleCount,
    largestMenu,
  } = useLoaderData<typeof loader>();

  const healthScore = (() => {
    let score = 100;
    if (emptyMenus.length > 0) score -= emptyMenus.length * 10;
    if (emptyTitleCount > 0) score -= emptyTitleCount * 5;
    for (const m of missingUrlItems) {
      score -= m.items.length * 5;
    }
    return Math.max(0, Math.min(100, score));
  })();

  const healthTone = healthScore >= 80 ? "success" : "critical" as const;
  const healthBadgeTone = healthScore >= 80 ? "success" : healthScore >= 50 ? "warning" : "critical" as const;

  return (
    <Page backAction={{ content: "Dashboard", url: "/app" }} title="Analytics">
      <TitleBar title="Analytics" />
      <Layout>
        {/* Overview Stats */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Overview
            </Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 16,
              }}
            >
              <StatCard title="Total Menus" value={totalMenus} />
              <StatCard title="Total Items" value={totalItems} />
              <StatCard
                title="Avg Items / Menu"
                value={avgItemsPerMenu}
              />
              <StatCard
                title="Max Depth"
                value={maxDepthGlobal}
                subtitle="Deepest nesting level"
              />
            </div>
          </BlockStack>
        </Layout.Section>

        {/* Health Score */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Menu Health
                </Text>
                <Badge tone={healthBadgeTone}>{String(healthScore)}/100</Badge>
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
                {missingUrlItems.length > 0 && (
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
                      {missingUrlItems.reduce((s, m) => s + m.items.length, 0)} item(s) with
                      missing URL
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
                {emptyMenus.length === 0 &&
                  missingUrlItems.length === 0 &&
                  emptyTitleCount === 0 && (
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
        </Layout.Section>

        {/* Type Distribution */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Item Type Distribution
              </Text>
              {typeStats.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No menu items found.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {typeStats.map((ts) => (
                    <div key={ts.type}>
                      <BlockStack gap="100">
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">
                            {ts.label}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {ts.count} ({ts.percentage}%)
                          </Text>
                        </InlineStack>
                        <ProgressBar
                          progress={ts.percentage}
                          size="small"
                          tone="primary"
                        />
                      </BlockStack>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Per-Menu Breakdown */}
        <Layout.Section>
          <Card padding="0">
            <BlockStack gap="0">
              <Box paddingBlock="300" paddingInline="400">
                <Text as="h2" variant="headingMd">
                  Menu Breakdown
                </Text>
              </Box>
              <Divider />

              {/* Table Header */}
              <Box paddingBlock="200" paddingInline="400" background="bg-surface-secondary">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 1fr 80px 80px 80px",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Menu
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Handle
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Top Level
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Total
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    Depth
                  </Text>
                </div>
              </Box>

              {menuStats.length === 0 ? (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued">
                    No menus found.
                  </Text>
                </Box>
              ) : (
                menuStats.map((menu) => (
                  <div key={menu.id}>
                    <Divider />
                    <Box paddingBlock="300" paddingInline="400">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 80px 80px 80px",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {menu.title}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          /{menu.handle}
                        </Text>
                        <div>
                          <Badge>{String(menu.topLevelCount)}</Badge>
                        </div>
                        <div>
                          <Badge tone="info">{String(menu.totalCount)}</Badge>
                        </div>
                        <div>
                          <Badge
                            tone={menu.maxDepth >= 2 ? "warning" : undefined}
                          >
                            {String(menu.maxDepth)}
                          </Badge>
                        </div>
                      </div>
                    </Box>
                  </div>
                ))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Insights */}
        {largestMenu && totalMenus > 1 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Insights
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#2C6ECB",
                        flexShrink: 0,
                      }}
                    />
                    <Text as="p" variant="bodySm">
                      Largest menu: <strong>{largestMenu.title}</strong> with{" "}
                      {largestMenu.count} items
                    </Text>
                  </InlineStack>
                  {maxDepthGlobal >= 2 && (
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
                        Some menus have {maxDepthGlobal}-level nesting. Deep nesting can
                        affect navigation usability.
                      </Text>
                    </InlineStack>
                  )}
                  {avgItemsPerMenu > 15 && (
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
                        Average of {avgItemsPerMenu} items per menu. Consider simplifying
                        for better UX.
                      </Text>
                    </InlineStack>
                  )}
                  {typeStats.length === 1 && (
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#2C6ECB",
                          flexShrink: 0,
                        }}
                      />
                      <Text as="p" variant="bodySm">
                        All items use the same type ({typeStats[0]?.label}). Consider
                        diversifying with collections, pages, or products.
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Bottom spacing */}
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
