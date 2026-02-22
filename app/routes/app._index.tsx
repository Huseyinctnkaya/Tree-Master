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
    title: "App installed",
    description: "Tree Master is running on your store.",
    done: true,
  },
  {
    number: "2",
    title: "Browse your menus",
    description: "Go to the Menus page to see all navigation menus.",
    done: false,
    action: { label: "View menus", url: "/app/menus" },
  },
  {
    number: "3",
    title: "Edit a menu",
    description: "Click on a menu to edit its items, titles, and URLs.",
    done: false,
  },
  {
    number: "4",
    title: "Save draft & deploy",
    description: "Save changes as a draft first, then deploy to your live store.",
    done: false,
  },
];

export default function Dashboard() {
  const { totalMenus, totalItems } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Tree Master" />
      <Layout>
        {/* Left column */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* Hero card */}
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
                    Manage your Shopify store's navigation menus — edit items, save
                    drafts, and deploy changes safely without risking your live store.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button variant="primary" url="/app/menus">
                    View all menus
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Getting started */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Getting started
                </Text>
                <BlockStack gap="0">
                  {STEPS.map((step, index) => (
                    <div key={step.number}>
                      {index > 0 && <Divider />}
                      <Box paddingBlock="400">
                        <InlineStack gap="400" blockAlign="start">
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              background: step.done ? "var(--p-color-bg-fill-success)" : "var(--p-color-bg-fill-secondary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Text
                              as="span"
                              variant="bodySm"
                              fontWeight="bold"
                              tone={step.done ? undefined : "subdued"}
                            >
                              {step.done ? "✓" : step.number}
                            </Text>
                          </div>
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="semibold"
                                tone={step.done ? "success" : undefined}
                              >
                                {step.title}
                              </Text>
                              {step.done && (
                                <Badge tone="success">Done</Badge>
                              )}
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {step.description}
                            </Text>
                            {step.action && (
                              <Box paddingBlockStart="100">
                                <Button variant="plain" url={step.action.url}>
                                  {step.action.label} →
                                </Button>
                              </Box>
                            )}
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Right column */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="500">
            {/* Stats */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Store overview
                </Text>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">
                      Navigation menus
                    </Text>
                    <Text as="span" variant="headingLg" fontWeight="bold">
                      {totalMenus}
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">
                      Total menu items
                    </Text>
                    <Text as="span" variant="headingLg" fontWeight="bold">
                      {totalItems}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* What you can do */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  What Tree Master does
                </Text>
                <BlockStack gap="200">
                  {[
                    "Edit menu items, titles, and URLs",
                    "Add and remove menu items",
                    "Reorder items with ↑↓ buttons",
                    "Support for nested sub-items",
                    "Save drafts before deploying",
                    "One-click deploy to live store",
                  ].map((feature) => (
                    <InlineStack key={feature} gap="200" blockAlign="start">
                      <Text as="span" tone="success">
                        ✓
                      </Text>
                      <Text as="span" variant="bodySm">
                        {feature}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
