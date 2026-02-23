import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Badge,
  BlockStack,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const MENUS_QUERY = `#graphql
  query GetMenus {
    menus(first: 50) {
      edges {
        node {
          id
          handle
          title
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

  const menus = (data.data?.menus?.edges ?? []).map(({ node }: any) => {
    const topLevel = node.items?.length ?? 0;
    const subItems = (node.items ?? []).reduce(
      (acc: number, item: any) => acc + (item.items?.length ?? 0),
      0,
    );
    return {
      id: node.id,
      numericId: node.id.replace("gid://shopify/Menu/", ""),
      handle: node.handle,
      title: node.title,
      topLevelCount: topLevel,
      totalCount: topLevel + subItems,
    };
  });

  return { menus };
};

export default function MenusList() {
  const { menus } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Menus"
      primaryAction={
        <Button variant="primary" external url="shopify://admin/menus">
          Create Menu
        </Button>
      }
    >
      <TitleBar title="Menus" />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {menus.length === 0 ? (
              /* Empty State */
              <Box padding="400">
                <BlockStack gap="500" inlineAlign="center">
                  <Box paddingBlockStart="800" paddingBlockEnd="200">
                    <div
                      style={{
                        width: 140,
                        height: 140,
                        margin: "0 auto",
                        borderRadius: "50%",
                        background: "#F6F6F7",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 64 64"
                        fill="none"
                      >
                        <rect
                          x="12"
                          y="16"
                          width="40"
                          height="32"
                          rx="3"
                          fill="white"
                          stroke="#8C9196"
                          strokeWidth="2"
                        />
                        <rect
                          x="16"
                          y="24"
                          width="20"
                          height="2"
                          rx="1"
                          fill="#D2D5D8"
                        />
                        <rect
                          x="16"
                          y="30"
                          width="16"
                          height="2"
                          rx="1"
                          fill="#D2D5D8"
                        />
                        <rect
                          x="16"
                          y="36"
                          width="24"
                          height="2"
                          rx="1"
                          fill="#D2D5D8"
                        />
                        <rect
                          x="38"
                          y="22"
                          width="10"
                          height="10"
                          rx="2"
                          fill="#E4A04A"
                          opacity="0.8"
                        />
                      </svg>
                    </div>
                  </Box>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="h2" variant="headingMd">
                      No menus found
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Your store doesn't have any navigation menus yet. Create
                      one in Shopify admin to get started.
                    </Text>
                  </BlockStack>
                  <Box paddingBlockEnd="800">
                    <Button
                      variant="primary"
                      external
                      url="shopify://admin/menus"
                    >
                      Create Menu
                    </Button>
                  </Box>
                </BlockStack>
              </Box>
            ) : (
              /* Menu Table */
              <BlockStack gap="0">
                <Box paddingBlock="300" paddingInline="400">
                  <Text as="h2" variant="headingMd">
                    Your menus
                  </Text>
                </Box>
                <Divider />

                {/* Table Header */}
                <Box paddingBlock="200" paddingInline="400" background="bg-surface-secondary">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 100px 100px 120px",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Name
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Handle
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Items
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      Total
                    </Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      fontWeight="semibold"
                      alignment="end"
                    >
                      Actions
                    </Text>
                  </div>
                </Box>

                {/* Table Rows */}
                {menus.map((menu: typeof menus[number]) => (
                  <div key={menu.id}>
                    <Divider />
                    <Box paddingBlock="300" paddingInline="400">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 100px 100px 120px",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight="semibold"
                        >
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
                        <InlineStack align="end" gap="200">
                          <Button
                            size="micro"
                            url={`/app/menus/${menu.numericId}`}
                          >
                            Edit
                          </Button>
                        </InlineStack>
                      </div>
                    </Box>
                  </div>
                ))}
              </BlockStack>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
