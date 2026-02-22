import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Button,
  Badge,
  EmptyState,
  BlockStack,
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

  const resourceName = { singular: "menu", plural: "menus" };

  return (
    <Page>
      <TitleBar title="Menus" />
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {menus.length === 0 ? (
              <EmptyState
                heading="No navigation menus found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  This store has no navigation menus yet.
                </Text>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={menus.length}
                selectable={false}
                headings={[
                  { title: "Menu name" },
                  { title: "Handle" },
                  { title: "Top-level items" },
                  { title: "Total items" },
                  { title: "" },
                ]}
              >
                {menus.map((menu, index) => (
                  <IndexTable.Row id={menu.id} key={menu.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {menu.title}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text variant="bodySm" tone="subdued" as="span">
                        /{menu.handle}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Badge>{String(menu.topLevelCount)}</Badge>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Badge tone="info">{String(menu.totalCount)}</Badge>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <BlockStack inlineAlign="end">
                        <Button
                          variant="plain"
                          url={`/app/menus/${menu.numericId}`}
                        >
                          Edit
                        </Button>
                      </BlockStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
