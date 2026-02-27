import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  Button,
  Spinner,
  Banner,
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
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
  if (!isPremium) {
    return { isPremium: false };
  }

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
    isPremium: true,
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
    menus,
  };
};

// ---- Action (Broken Link Checker) ----

function collectHttpUrls(
  items: MenuItem[],
  menuTitle: string,
  acc: { url: string; title: string; menuTitle: string }[] = [],
) {
  for (const item of items) {
    if (item.type === "HTTP" && item.url && item.url.startsWith("/")) {
      acc.push({ url: item.url, title: item.title || "(Untitled)", menuTitle });
    }
    if (item.items) collectHttpUrls(item.items, menuTitle, acc);
  }
  return acc;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
  if (!isPremium) {
    return { broken: [], checkedCount: 0 };
  }

  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(GET_ALL_MENUS_QUERY);
  const data = await response.json();
  const menus: MenuNode[] = (data.data?.menus?.edges ?? []).map(({ node }: any) => ({
    id: node.id,
    handle: node.handle,
    title: node.title,
    items: node.items ?? [],
  }));

  const urlsToCheck: { url: string; title: string; menuTitle: string }[] = [];
  for (const menu of menus) {
    collectHttpUrls(menu.items, menu.title, urlsToCheck);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = urlsToCheck.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  // Cap at 30 to avoid timeouts
  const toCheck = unique.slice(0, 30);
  const shopBase = `https://${session.shop}`;

  const results = await Promise.allSettled(
    toCheck.map(async ({ url, title, menuTitle }) => {
      try {
        const res = await fetch(`${shopBase}${url}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(6000),
        });
        return { url, title, menuTitle, status: res.status, ok: res.ok };
      } catch {
        return { url, title, menuTitle, status: 0, ok: false };
      }
    }),
  );

  const checked = results.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  ).filter(Boolean) as { url: string; title: string; menuTitle: string; status: number; ok: boolean }[];

  const broken = checked.filter((r) => !r.ok);

  return { broken, checkedCount: toCheck.length };
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

type LinkCheckResult = { url: string; title: string; menuTitle: string; status: number; ok: boolean };

export default function Analytics() {
  const loaderData = useLoaderData<typeof loader>();

  if (!loaderData.isPremium) {
    return (
      <Page backAction={{ content: "Dashboard", url: "/app" }} title="Analytics">
        <TitleBar title="Analytics" />
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Analytics
                  </Text>
                  <Badge tone="warning">Premium</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Get insights into your menu structure, health scores, type distribution, broken link scanning, and more.
                </Text>
                <Banner tone="warning">
                  <p>
                    Analytics is a <strong>Premium</strong> feature.{" "}
                    <a href="/app/pricing" style={{ color: "inherit", fontWeight: 600 }}>
                      Upgrade your plan
                    </a>{" "}
                    to unlock full analytics and reporting.
                  </p>
                </Banner>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: 16,
                    opacity: 0.35,
                    pointerEvents: "none",
                    userSelect: "none",
                    filter: "blur(3px)",
                  }}
                >
                  {["Total Menus", "Total Items", "Avg Items / Menu", "Max Depth"].map((label) => (
                    <Card key={label}>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                        <Text as="p" variant="headingXl">—</Text>
                      </BlockStack>
                    </Card>
                  ))}
                </div>
                <InlineStack>
                  <Button variant="primary" url="/app/pricing">
                    Upgrade to Premium
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

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
    menus,
  } = loaderData as any;

  // ---- Audit computations ----

  // Flatten all items with context for auditing
  type FlatItem = { menuTitle: string; title: string; url: string; type: string; depth: number };

  function flattenItems(items: MenuItem[], menuTitle: string, depth = 0, acc: FlatItem[] = []): FlatItem[] {
    for (const item of items) {
      acc.push({ menuTitle, title: item.title || "(Untitled)", url: item.url || "", type: item.type, depth });
      flattenItems(item.items ?? [], menuTitle, depth + 1, acc);
    }
    return acc;
  }

  const allFlatItems: FlatItem[] = menus.flatMap((m) => flattenItems(m.items, m.title));

  // Duplicate URLs (HTTP type, same URL in 2+ places)
  const urlGroups: Record<string, FlatItem[]> = {};
  for (const fi of allFlatItems) {
    if (fi.type === "HTTP" && fi.url && fi.url.trim() !== "") {
      const key = fi.url.trim();
      urlGroups[key] = urlGroups[key] ?? [];
      urlGroups[key].push(fi);
    }
  }
  const duplicateUrls = Object.entries(urlGroups)
    .filter(([, items]) => items.length > 1)
    .map(([url, items]) => ({ url, items }));

  // External links (HTTP type, URL starts with http:// — pointing to other domains)
  const externalLinks = allFlatItems.filter(
    (fi) => fi.type === "HTTP" && (fi.url.startsWith("http://") || fi.url.startsWith("https://")),
  );

  // CSV export
  const handleExportCSV = () => {
    const rows: string[][] = [["Menu", "Item Title", "URL", "Type", "Depth"]];
    for (const fi of allFlatItems) {
      rows.push([fi.menuTitle, fi.title, fi.url, fi.type, String(fi.depth)]);
    }
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "menu-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const linkChecker = useFetcher<{ broken: LinkCheckResult[]; checkedCount: number }>();
  const isChecking = linkChecker.state !== "idle";
  const checkResult = linkChecker.data;

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

        {/* Navigation Audit Report */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Navigation Audit
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Detailed analysis of your menu structure — duplicate URLs, external links, and more.
                  </Text>
                </BlockStack>
                <Button onClick={handleExportCSV}>Export CSV</Button>
              </InlineStack>

              {/* Duplicate URLs */}
              {duplicateUrls.length > 0 ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FFC453", flexShrink: 0 }} />
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {duplicateUrls.length} duplicate URL(s) found
                    </Text>
                  </InlineStack>
                  {duplicateUrls.map(({ url, items }) => (
                    <div
                      key={url}
                      style={{
                        padding: "8px 12px",
                        background: "#FFF8E6",
                        border: "1px solid #FFCC47",
                        borderRadius: 8,
                      }}
                    >
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <span style={{ fontFamily: "monospace" }}>{url}</span>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Used in: {items.map((i) => `${i.menuTitle} → ${i.title}`).join(", ")}
                      </Text>
                    </div>
                  ))}
                </BlockStack>
              ) : (
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#008060", flexShrink: 0 }} />
                  <Text as="p" variant="bodySm">No duplicate URLs detected.</Text>
                </InlineStack>
              )}

              <Divider />

              {/* External links */}
              {externalLinks.length > 0 ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2C6ECB", flexShrink: 0 }} />
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {externalLinks.length} external link(s)
                    </Text>
                  </InlineStack>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {externalLinks.map((fi, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "3px 10px",
                          background: "#E8F0FE",
                          border: "1px solid #C4D3F8",
                          borderRadius: 20,
                        }}
                      >
                        <Text as="span" variant="bodySm">
                          {fi.title}{" "}
                          <span style={{ color: "#8C9196", fontSize: 11, fontFamily: "monospace" }}>
                            {fi.url.length > 40 ? fi.url.slice(0, 40) + "…" : fi.url}
                          </span>
                        </Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              ) : (
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#008060", flexShrink: 0 }} />
                  <Text as="p" variant="bodySm">No external links detected.</Text>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Broken Link Checker */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Broken Link Checker
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Scan all custom URL items in your menus for broken links (404s).
                  </Text>
                </BlockStack>
                <Button
                  onClick={() => linkChecker.submit({}, { method: "post" })}
                  loading={isChecking}
                  disabled={isChecking}
                >
                  {isChecking ? "Checking…" : "Check Links"}
                </Button>
              </InlineStack>

              {isChecking && (
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodySm" tone="subdued">
                    Checking URLs, please wait…
                  </Text>
                </InlineStack>
              )}

              {checkResult && !isChecking && (
                <BlockStack gap="300">
                  {checkResult.broken.length === 0 ? (
                    <Banner tone="success">
                      <Text as="p" variant="bodySm">
                        All {checkResult.checkedCount} checked URLs are working correctly.
                      </Text>
                    </Banner>
                  ) : (
                    <BlockStack gap="200">
                      <Banner tone="warning">
                        <Text as="p" variant="bodySm">
                          Found {checkResult.broken.length} broken link(s) out of {checkResult.checkedCount} checked.
                        </Text>
                      </Banner>
                      {checkResult.broken.map((r, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "8px 12px",
                            background: "#FFF4F4",
                            border: "1px solid #FFCFC9",
                            borderRadius: 8,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {r.title}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {r.menuTitle} → <span style={{ fontFamily: "monospace" }}>{r.url}</span>
                            </Text>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            <Badge tone="critical">
                              {r.status === 0 ? "Timeout" : `${r.status}`}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Bottom spacing */}
        <Layout.Section>
          <Box paddingBlockEnd="800" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
