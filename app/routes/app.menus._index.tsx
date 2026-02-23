import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
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
  Modal,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
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

const CREATE_MENU_MUTATION = `#graphql
  mutation MenuCreate($title: String!, $items: [MenuItemCreateInput!]) {
    menuCreate(title: $title, items: $items) {
      menu {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_MENU_MUTATION = `#graphql
  mutation MenuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors {
        field
        message
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const title = formData.get("title") as string;

    if (!title || title.trim().length === 0) {
      return { success: false, intent: "create", error: "Menu title is required." };
    }

    const response = await admin.graphql(CREATE_MENU_MUTATION, {
      variables: { title: title.trim(), items: [] },
    });
    const data = await response.json();
    const userErrors = data.data?.menuCreate?.userErrors ?? [];

    if (userErrors.length > 0) {
      return {
        success: false,
        intent: "create",
        error: userErrors.map((e: any) => e.message).join(", "),
      };
    }

    return { success: true, intent: "create", error: "" };
  }

  if (intent === "delete") {
    const menuId = formData.get("menuId") as string;

    const response = await admin.graphql(DELETE_MENU_MUTATION, {
      variables: { id: menuId },
    });
    const data = await response.json();
    const userErrors = data.data?.menuDelete?.userErrors ?? [];

    if (userErrors.length > 0) {
      return {
        success: false,
        intent: "delete",
        error: userErrors.map((e: any) => e.message).join(", "),
      };
    }

    return { success: true, intent: "delete", error: "" };
  }

  return { success: false, intent: "", error: "" };
};

export default function MenusList() {
  const { menus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [createOpen, setCreateOpen] = useState(false);
  const [menuTitle, setMenuTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const isCreating =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "create";

  const isDeleting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "delete";

  const handleCreate = useCallback(() => {
    if (!menuTitle.trim()) return;
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("title", menuTitle);
    submit(formData, { method: "post" });
    setCreateOpen(false);
    setMenuTitle("");
  }, [menuTitle, submit]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("menuId", deleteTarget.id);
    submit(formData, { method: "post" });
    setDeleteTarget(null);
  }, [deleteTarget, submit]);

  // Toasts
  if (actionData?.intent === "create" && actionData?.success) {
    shopify.toast.show("Menu created!");
  }
  if (actionData?.intent === "delete" && actionData?.success) {
    shopify.toast.show("Menu deleted!");
  }

  return (
    <Page
      title="Menus"
      primaryAction={
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
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
                      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                        <rect x="12" y="16" width="40" height="32" rx="3" fill="white" stroke="#8C9196" strokeWidth="2" />
                        <rect x="16" y="24" width="20" height="2" rx="1" fill="#D2D5D8" />
                        <rect x="16" y="30" width="16" height="2" rx="1" fill="#D2D5D8" />
                        <rect x="16" y="36" width="24" height="2" rx="1" fill="#D2D5D8" />
                        <rect x="38" y="22" width="10" height="10" rx="2" fill="#E4A04A" opacity="0.8" />
                      </svg>
                    </div>
                  </Box>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="h2" variant="headingMd">
                      Create your first menu
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Create a navigation menu to organize your store's links and pages.
                    </Text>
                  </BlockStack>
                  <Box paddingBlockEnd="800">
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>
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
                      gridTemplateColumns: "1fr 1fr 100px 100px 1fr",
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
                    <Text as="span" variant="bodySm" fontWeight="semibold" alignment="end">
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
                          gridTemplateColumns: "1fr 1fr 100px 100px 1fr",
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
                        <InlineStack align="end" gap="200">
                          <Button size="micro" url={`/app/menus/${menu.numericId}`}>
                            Edit
                          </Button>
                          <Button
                            size="micro"
                            tone="critical"
                            onClick={() =>
                              setDeleteTarget({ id: menu.id, title: menu.title })
                            }
                          >
                            Delete
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

      {/* Create Menu Modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setMenuTitle("");
        }}
        title="Create a new menu"
        primaryAction={{
          content: "Create",
          onAction: handleCreate,
          loading: isCreating,
          disabled: !menuTitle.trim(),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setCreateOpen(false);
              setMenuTitle("");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Menu title"
              value={menuTitle}
              onChange={setMenuTitle}
              autoComplete="off"
              placeholder="e.g. Main Menu, Footer, Sidebar"
              helpText="You can add items after creating the menu."
            />
            {actionData?.intent === "create" && !actionData.success && (
              <Text as="p" variant="bodySm" tone="critical">
                {actionData.error}
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete menu"
        primaryAction={{
          content: "Delete",
          onAction: handleDelete,
          loading: isDeleting,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteTarget(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This
            action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
