import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useNavigate, useActionData } from "@remix-run/react";
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
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const customMenus = await prisma.customMenu.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
  });

  return {
    customMenus: customMenus.map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      updatedAt: m.updatedAt.toISOString(),
      hasHtml: m.html.length > 0,
      hasCss: m.css.length > 0,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) {
      return { success: false, error: "Menu name is required." };
    }

    const menu = await prisma.customMenu.create({
      data: { shop: session.shop, name },
    });

    return { success: true, menuId: menu.id };
  }

  if (intent === "delete") {
    const menuId = formData.get("menuId") as string;
    await prisma.customMenu.delete({ where: { id: menuId } });
    return { success: true, deleted: true };
  }

  if (intent === "duplicate") {
    const menuId = formData.get("menuId") as string;
    const original = await prisma.customMenu.findUnique({ where: { id: menuId } });
    if (!original) return { success: false, error: "Menu not found." };

    await prisma.customMenu.create({
      data: {
        shop: session.shop,
        name: `${original.name} (copy)`,
        html: original.html,
        css: original.css,
        status: "draft",
      },
    });
    return { success: true, duplicated: true };
  }

  return { success: false, error: "Unknown action" };
};

export default function CustomMenusList() {
  const { customMenus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [createOpen, setCreateOpen] = useState(false);

  // Redirect to editor after creating a new menu
  useEffect(() => {
    if (actionData?.success && actionData?.menuId) {
      navigate(`/app/custom-menus/${actionData.menuId}`);
    }
  }, [actionData, navigate]);
  const [menuName, setMenuName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const isSubmitting = navigation.state === "submitting";

  const handleCreate = useCallback(() => {
    if (!menuName.trim()) return;
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("name", menuName);
    submit(fd, { method: "post" });
    setCreateOpen(false);
    setMenuName("");
  }, [menuName, submit]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const fd = new FormData();
    fd.set("intent", "delete");
    fd.set("menuId", deleteTarget.id);
    submit(fd, { method: "post" });
    setDeleteTarget(null);
  }, [deleteTarget, submit]);

  const handleDuplicate = useCallback(
    (menuId: string) => {
      const fd = new FormData();
      fd.set("intent", "duplicate");
      fd.set("menuId", menuId);
      submit(fd, { method: "post" });
      shopify.toast.show("Menu duplicated!");
    },
    [submit, shopify],
  );

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Custom Menus"
      subtitle="Create menus with custom HTML & CSS code"
      primaryAction={
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Create Custom Menu
        </Button>
      }
    >
      <TitleBar title="Custom Menus" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                Custom menus let you write your own HTML and CSS. Add the{" "}
                <strong>Tree Master Menu</strong> block to your theme and select{" "}
                <strong>Custom Code</strong> mode to display them on your store.
              </Text>
            </Banner>

            <Card padding="0">
              {customMenus.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="300" inlineAlign="center">
                    <div
                      style={{
                        width: 120,
                        height: 120,
                        margin: "0 auto",
                        borderRadius: "50%",
                        background: "#F6F6F7",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <rect x="8" y="12" width="32" height="24" rx="3" stroke="#8C9196" strokeWidth="2" fill="none" />
                        <path d="M14 20l4 4-4 4" stroke="#2C6ECB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="22" y1="28" x2="34" y2="28" stroke="#8C9196" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <Text as="h2" variant="headingMd">
                      No custom menus yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Create a custom menu with your own HTML and CSS code.
                    </Text>
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>
                      Create Custom Menu
                    </Button>
                  </BlockStack>
                </Box>
              ) : (
                <BlockStack gap="0">
                  <Box paddingBlock="300" paddingInline="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Your custom menus
                      </Text>
                      <Badge tone="info">{`${customMenus.length} menus`}</Badge>
                    </InlineStack>
                  </Box>
                  <Divider />

                  {customMenus.map((menu) => (
                    <div key={menu.id}>
                      <Box paddingBlock="300" paddingInline="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center" align="start">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {menu.name}
                              </Text>
                              <Badge tone={menu.status === "published" ? "success" : undefined}>
                                {menu.status}
                              </Badge>
                            </InlineStack>
                            <InlineStack gap="200">
                              <Text as="span" variant="bodySm" tone="subdued">
                                ID: {menu.id}
                              </Text>
                              {menu.hasHtml && (
                                <Badge>HTML</Badge>
                              )}
                              {menu.hasCss && (
                                <Badge>CSS</Badge>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="micro" onClick={() => navigate(`/app/custom-menus/${menu.id}`)}>
                              Edit
                            </Button>
                            <Button size="micro" onClick={() => handleDuplicate(menu.id)}>
                              Duplicate
                            </Button>
                            <Button
                              size="micro"
                              tone="critical"
                              onClick={() => setDeleteTarget({ id: menu.id, name: menu.name })}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                      <Divider />
                    </div>
                  ))}
                </BlockStack>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setMenuName(""); }}
        title="Create custom menu"
        primaryAction={{
          content: "Create",
          onAction: handleCreate,
          loading: isSubmitting,
          disabled: !menuName.trim(),
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => { setCreateOpen(false); setMenuName(""); },
        }]}
      >
        <Modal.Section>
          <TextField
            label="Menu name"
            value={menuName}
            onChange={setMenuName}
            autoComplete="off"
            placeholder="e.g. Mega Menu, Footer Nav, Sidebar"
            helpText="You'll write the HTML and CSS in the editor."
          />
        </Modal.Section>
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete custom menu"
        primaryAction={{
          content: "Delete",
          onAction: handleDelete,
          loading: isSubmitting,
          destructive: true,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setDeleteTarget(null),
        }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
