import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Badge,
  Divider,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ---- Types ----

type MenuItem = {
  id: string;
  title: string;
  url: string;
  type: string;
  resourceId: string | null;
  items: MenuItem[];
};

type MenuData = {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
};

// ---- GraphQL ----

const GET_MENU_QUERY = `#graphql
  query GetMenu($id: ID!) {
    menu(id: $id) {
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
`;

const UPDATE_MENU_MUTATION = `#graphql
  mutation MenuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ---- Helpers ----

function normalizeItems(items: any[]): MenuItem[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    title: item.title ?? "",
    url: item.url ?? "",
    type: item.type ?? "HTTP",
    resourceId: item.resourceId ?? null,
    items: normalizeItems(item.items ?? []),
  }));
}

function buildUpdateInput(items: MenuItem[]): object[] {
  return items.map((item) => {
    const input: Record<string, unknown> = {
      title: item.title,
      type: item.type,
    };

    if (!item.id.startsWith("new-")) {
      input.id = item.id;
    }

    if (item.type === "HTTP" || item.type === "FRONTEND_PAGE") {
      input.url = item.url;
    } else if (item.resourceId) {
      input.resourceId = item.resourceId;
    }

    if (item.items.length > 0) {
      input.items = buildUpdateInput(item.items);
    }

    return input;
  });
}

let _counter = 0;
function newId() {
  return `new-${++_counter}-${Date.now()}`;
}

function emptyItem(): MenuItem {
  return { id: newId(), title: "", url: "", type: "HTTP", resourceId: null, items: [] };
}

// ---- Loader ----

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const menuGid = `gid://shopify/Menu/${params.menuId}`;

  const response = await admin.graphql(GET_MENU_QUERY, {
    variables: { id: menuGid },
  });
  const data = await response.json();

  if (!data.data?.menu) {
    throw new Response("Menu not found", { status: 404 });
  }

  const menu = data.data.menu;
  return {
    menu: {
      ...menu,
      items: normalizeItems(menu.items),
    } as MenuData,
  };
};

// ---- Action ----

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const menuGid = `gid://shopify/Menu/${params.menuId}`;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const menuTitle = formData.get("menuTitle") as string;
  const menuHandle = formData.get("menuHandle") as string;
  const itemsJson = formData.get("items") as string;
  const items = JSON.parse(itemsJson) as MenuItem[];

  if (intent === "save_draft") {
    await prisma.menuSnapshot.create({
      data: {
        shop: session.shop,
        menuGid,
        menuHandle,
        menuTitle,
        data: itemsJson,
        note: (formData.get("note") as string) || null,
      },
    });
    return { success: true, intent: "save_draft" };
  }

  if (intent === "deploy") {
    const response = await admin.graphql(UPDATE_MENU_MUTATION, {
      variables: {
        id: menuGid,
        title: menuTitle,
        items: buildUpdateInput(items),
      },
    });
    const data = await response.json();
    const userErrors: { field: string; message: string }[] =
      data.data?.menuUpdate?.userErrors ?? [];

    if (userErrors.length > 0) {
      return { success: false, intent: "deploy", errors: userErrors };
    }

    return { success: true, intent: "deploy" };
  }

  return { success: false, intent: "unknown", errors: [{ field: "", message: "Unknown action" }] };
};

// ---- Sub-component: single menu item row ----

function MenuItemRow({
  item,
  depth,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  item: MenuItem;
  depth: number;
  index: number;
  total: number;
  onChange: (updated: MenuItem) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const isUrlEditable = item.type === "HTTP" || item.type === "FRONTEND_PAGE";

  const handleSubChange = useCallback(
    (i: number, updated: MenuItem) => {
      const next = [...item.items];
      next[i] = updated;
      onChange({ ...item, items: next });
    },
    [item, onChange],
  );

  const handleSubDelete = useCallback(
    (i: number) => {
      onChange({ ...item, items: item.items.filter((_, idx) => idx !== i) });
    },
    [item, onChange],
  );

  const handleSubMoveUp = useCallback(
    (i: number) => {
      if (i === 0) return;
      const next = [...item.items];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      onChange({ ...item, items: next });
    },
    [item, onChange],
  );

  const handleSubMoveDown = useCallback(
    (i: number) => {
      if (i === item.items.length - 1) return;
      const next = [...item.items];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      onChange({ ...item, items: next });
    },
    [item, onChange],
  );

  const handleAddSubItem = useCallback(() => {
    onChange({ ...item, items: [...item.items, emptyItem()] });
  }, [item, onChange]);

  return (
    <Box
      padding="300"
      background={depth === 0 ? "bg-surface" : "bg-surface-secondary"}
      borderWidth="025"
      borderColor="border"
      borderRadius="200"
    >
      <BlockStack gap="300">
        {/* Row header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={depth === 0 ? "info" : undefined}>{item.type}</Badge>
            <Text variant="bodySm" tone="subdued" as="span">
              {depth === 0 ? "Top-level" : "Sub-item"}
            </Text>
          </InlineStack>
          <InlineStack gap="100">
            <Button size="slim" disabled={index === 0} onClick={onMoveUp}>
              ↑
            </Button>
            <Button size="slim" disabled={index === total - 1} onClick={onMoveDown}>
              ↓
            </Button>
            <Button size="slim" tone="critical" onClick={onDelete}>
              Remove
            </Button>
          </InlineStack>
        </InlineStack>

        {/* Fields */}
        <InlineStack gap="300" blockAlign="start">
          <div style={{ flex: 1 }}>
            <TextField
              label="Title"
              value={item.title}
              onChange={(val) => onChange({ ...item, title: val })}
              autoComplete="off"
            />
          </div>
          {isUrlEditable ? (
            <div style={{ flex: 2 }}>
              <TextField
                label="URL"
                value={item.url}
                onChange={(val) => onChange({ ...item, url: val })}
                autoComplete="off"
                placeholder="https://"
              />
            </div>
          ) : (
            item.resourceId && (
              <div style={{ flex: 2 }}>
                <TextField
                  label="Linked resource"
                  value={item.resourceId}
                  disabled
                  autoComplete="off"
                />
              </div>
            )
          )}
        </InlineStack>

        {/* Sub-items (only on depth 0) */}
        {depth === 0 && (
          <BlockStack gap="200">
            {item.items.length > 0 && (
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued" as="p">
                  Sub-items
                </Text>
                {item.items.map((sub, i) => (
                  <MenuItemRow
                    key={sub.id}
                    item={sub}
                    depth={1}
                    index={i}
                    total={item.items.length}
                    onChange={(u) => handleSubChange(i, u)}
                    onDelete={() => handleSubDelete(i)}
                    onMoveUp={() => handleSubMoveUp(i)}
                    onMoveDown={() => handleSubMoveDown(i)}
                  />
                ))}
              </BlockStack>
            )}
            <div>
              <Button size="slim" onClick={handleAddSubItem}>
                + Add sub-item
              </Button>
            </div>
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}

// ---- Main page ----

export default function MenuEditor() {
  const { menu } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [items, setItems] = useState<MenuItem[]>(menu.items);
  const [menuTitle, setMenuTitle] = useState(menu.title);

  const isSubmitting = navigation.state === "submitting";
  const prevActionRef = useRef<string>("");

  // Show toast only when new action data arrives
  useEffect(() => {
    if (!actionData) return;
    const key = JSON.stringify(actionData);
    if (key === prevActionRef.current) return;
    prevActionRef.current = key;

    if (actionData.success) {
      if (actionData.intent === "deploy") shopify.toast.show("Deployed to store!");
      if (actionData.intent === "save_draft") shopify.toast.show("Draft saved!");
    }
  }, [actionData, shopify]);

  const handleChange = useCallback((index: number, updated: MenuItem) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  const handleDelete = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    setItems((prev) => {
      if (index === 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleAddItem = useCallback(() => {
    setItems((prev) => [...prev, emptyItem()]);
  }, []);

  const handleSubmit = useCallback(
    (intent: string) => {
      const fd = new FormData();
      fd.append("intent", intent);
      fd.append("menuTitle", menuTitle);
      fd.append("menuHandle", menu.handle);
      fd.append("items", JSON.stringify(items));
      submit(fd, { method: "post" });
    },
    [items, menuTitle, menu.handle, submit],
  );

  const errors =
    actionData && !actionData.success
      ? (actionData as { errors?: { field: string; message: string }[] }).errors ?? []
      : [];

  return (
    <Page backAction={{ url: "/app" }} title={menuTitle} subtitle={`Handle: /${menu.handle}`}>
      <TitleBar title={menuTitle}>
        <button onClick={() => handleSubmit("save_draft")} disabled={isSubmitting}>
          Save Draft
        </button>
        <button
          variant="primary"
          onClick={() => handleSubmit("deploy")}
          disabled={isSubmitting}
        >
          Deploy to Store
        </button>
      </TitleBar>

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {errors.length > 0 && (
              <Banner tone="critical" title="Deploy failed">
                {errors.map((e, i) => (
                  <Text key={i} as="p">
                    {e.message}
                  </Text>
                ))}
              </Banner>
            )}

            <Card>
              <TextField
                label="Menu title"
                value={menuTitle}
                onChange={setMenuTitle}
                autoComplete="off"
              />
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Menu Items
                </Text>

                {items.length === 0 && (
                  <Text tone="subdued" as="p">
                    No items yet. Add your first item below.
                  </Text>
                )}

                {items.map((item, index) => (
                  <MenuItemRow
                    key={item.id}
                    item={item}
                    depth={0}
                    index={index}
                    total={items.length}
                    onChange={(u) => handleChange(index, u)}
                    onDelete={() => handleDelete(index)}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                  />
                ))}

                <div>
                  <Button onClick={handleAddItem}>+ Add item</Button>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Menu Info
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    Handle
                  </Text>
                  <Text as="span">/{menu.handle}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    Items
                  </Text>
                  <Text as="span">{items.length}</Text>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Changes apply to the store only after "Deploy". Use "Save Draft" to keep changes without publishing.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Actions
                </Text>
                <Button
                  variant="primary"
                  loading={isSubmitting}
                  onClick={() => handleSubmit("deploy")}
                  fullWidth
                >
                  Deploy to Store
                </Button>
                <Button
                  loading={isSubmitting}
                  onClick={() => handleSubmit("save_draft")}
                  fullWidth
                >
                  Save as Draft
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
