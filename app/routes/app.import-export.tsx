import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  DropZone,
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

type ExportMenu = {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
};

type ExportData = {
  version: 1;
  exportedAt: string;
  shop: string;
  menus: ExportMenu[];
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

    if (item.type === "HTTP" || item.type === "FRONTEND_PAGE") {
      input.url = item.url;
    } else if (item.resourceId) {
      input.resourceId = item.resourceId;
    }

    if (item.items && item.items.length > 0) {
      input.items = buildUpdateInput(item.items);
    }

    return input;
  });
}

// ---- Loader ----

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
  const { admin, session } = await authenticate.admin(request);
  const response = await admin.graphql(GET_ALL_MENUS_QUERY);
  const data = await response.json();

  const menus: ExportMenu[] = (data.data?.menus?.edges ?? []).map(
    ({ node }: any) => ({
      id: node.id,
      handle: node.handle,
      title: node.title,
      items: normalizeItems(node.items ?? []),
    }),
  );

  return { menus, shop: session.shop, isPremium };
};

// ---- Action ----

export const action = async ({ request }: ActionFunctionArgs) => {
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "import") {
    if (!isPremium) {
      return { success: false, intent: "import", error: "plan_limit" };
    }
    const importJson = formData.get("importData") as string;

    let importData: ExportData;
    try {
      importData = JSON.parse(importJson);
    } catch {
      return { success: false, intent: "import", error: "Invalid JSON file." };
    }

    if (!importData.version || !importData.menus || !Array.isArray(importData.menus)) {
      return {
        success: false,
        intent: "import",
        error: "Invalid export file format. Please use a file exported from Tree Master.",
      };
    }

    // Fetch current menus to match by handle
    const response = await admin.graphql(GET_ALL_MENUS_QUERY);
    const data = await response.json();
    const existingMenus: ExportMenu[] = (data.data?.menus?.edges ?? []).map(
      ({ node }: any) => ({
        id: node.id,
        handle: node.handle,
        title: node.title,
        items: normalizeItems(node.items ?? []),
      }),
    );

    const errors: string[] = [];
    let updatedCount = 0;
    let skippedCount = 0;

    for (const importMenu of importData.menus) {
      const existing = existingMenus.find((m) => m.handle === importMenu.handle);

      if (!existing) {
        skippedCount++;
        continue;
      }

      // Save a snapshot before overwriting
      await prisma.menuSnapshot.create({
        data: {
          shop: session.shop,
          menuGid: existing.id,
          menuHandle: existing.handle,
          menuTitle: existing.title,
          data: JSON.stringify(existing.items),
          note: "Auto-backup before import",
        },
      });

      // Update the menu via Shopify API
      const updateResponse = await admin.graphql(UPDATE_MENU_MUTATION, {
        variables: {
          id: existing.id,
          title: importMenu.title,
          items: buildUpdateInput(normalizeItems(importMenu.items)),
        },
      });

      const updateData = await updateResponse.json();
      const userErrors = updateData.data?.menuUpdate?.userErrors ?? [];

      if (userErrors.length > 0) {
        errors.push(
          `${importMenu.title}: ${userErrors.map((e: any) => e.message).join(", ")}`,
        );
      } else {
        updatedCount++;
      }
    }

    return {
      success: errors.length === 0,
      intent: "import",
      updatedCount,
      skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  return { success: false, intent: "unknown" };
};

// ---- Component ----

export default function ImportExport() {
  const { menus, shop, isPremium } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ExportData | null>(null);

  const isImporting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "import";

  // Export handler - generates and downloads JSON
  const handleExport = useCallback(() => {
    const exportData: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      shop,
      menus,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tree-master-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    shopify.toast.show("Menus exported successfully!");
  }, [menus, shop, shopify]);

  // File drop handler
  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setImportError(null);
      setImportPreview(null);
      setImportFile(file);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (!data.version || !data.menus || !Array.isArray(data.menus)) {
            setImportError("Invalid file format. Please use a Tree Master export file.");
            setImportFile(null);
            return;
          }
          setImportPreview(data);
        } catch {
          setImportError("Could not parse JSON file.");
          setImportFile(null);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  // Import submit
  const handleImport = useCallback(() => {
    if (!importFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const formData = new FormData();
      formData.set("intent", "import");
      formData.set("importData", e.target?.result as string);
      submit(formData, { method: "post" });
    };
    reader.readAsText(importFile);
  }, [importFile, submit]);

  // Show toast on action result
  if (actionData?.intent === "import" && actionData?.success) {
    shopify.toast.show(
      `Import complete! ${actionData.updatedCount} menu(s) updated.`,
    );
  }

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title="Import & Export"
    >
      <TitleBar title="Import & Export" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Export */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Export Settings
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Download a backup of all your navigation menus and their items as a JSON file.
                </Text>
                <InlineStack>
                  <Button variant="primary" onClick={handleExport}>
                    Export Menus to JSON
                  </Button>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {menus.length} menu(s) will be exported.
                </Text>
              </BlockStack>
            </Card>

            {/* Import */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Import Settings
                  </Text>
                  {!isPremium && <Badge tone="warning">Premium</Badge>}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Upload a previously exported JSON file to restore your menus.
                </Text>

                {!isPremium ? (
                  <Banner tone="warning">
                    <p>
                      Importing menus is a <strong>Premium</strong> feature.{" "}
                      <a href="/app/pricing" style={{ color: "inherit", fontWeight: 600 }}>Upgrade your plan</a> to unlock import.
                    </p>
                  </Banner>
                ) : (
                <Banner tone="warning">
                  <p>
                    Importing will overwrite existing menus that match by handle.
                    A backup snapshot will be saved automatically before changes are applied.
                  </p>
                </Banner>
                )}

                {isPremium && (
                  <>
                    <DropZone
                      accept=".json,application/json"
                      type="file"
                      onDrop={handleDropZoneDrop}
                      allowMultiple={false}
                    >
                      {importFile ? (
                        <Box padding="400">
                          <BlockStack gap="200" inlineAlign="center">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {importFile.name}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {(importFile.size / 1024).toFixed(1)} KB
                            </Text>
                          </BlockStack>
                        </Box>
                      ) : (
                        <DropZone.FileUpload actionHint="Accepts .json" />
                      )}
                    </DropZone>

                    {importError && (
                      <Banner tone="critical">
                        <p>{importError}</p>
                      </Banner>
                    )}

                    {importPreview && (
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">
                            File Preview
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Exported from: {importPreview.shop}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Date: {new Date(importPreview.exportedAt).toLocaleString()}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Contains {importPreview.menus.length} menu(s):{" "}
                            {importPreview.menus.map((m) => m.title).join(", ")}
                          </Text>
                        </BlockStack>
                      </Card>
                    )}

                    {actionData?.intent === "import" && !actionData.success && (
                      <Banner tone="critical">
                        <p>{actionData.error || "Some menus could not be imported."}</p>
                        {actionData.errors?.map((err: string, i: number) => (
                          <p key={i}>{err}</p>
                        ))}
                      </Banner>
                    )}

                    {actionData?.intent === "import" && actionData.success && (
                      <Banner tone="success">
                        <p>
                          Import complete! {actionData.updatedCount} menu(s) updated
                          {actionData.skippedCount > 0 &&
                            `, ${actionData.skippedCount} skipped (no matching handle found)`}
                          .
                        </p>
                      </Banner>
                    )}

                    <InlineStack>
                      <Button
                        variant="primary"
                        onClick={handleImport}
                        disabled={!importPreview}
                        loading={isImporting}
                      >
                        Import Menus
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
