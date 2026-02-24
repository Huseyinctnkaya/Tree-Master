import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Banner,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ---- Loader ----

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const webhooks = await prisma.webhookConfig.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "asc" },
  });

  return {
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      label: w.label,
    })),
  };
};

// ---- Action ----

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add_webhook") {
    const url = (formData.get("url") as string)?.trim();
    const label = (formData.get("label") as string)?.trim() || "";

    if (!url || !url.startsWith("http")) {
      return { success: false, error: "Please enter a valid URL starting with http:// or https://" };
    }

    const existing = await prisma.webhookConfig.findMany({
      where: { shop: session.shop },
    });
    if (existing.length >= 10) {
      return { success: false, error: "Maximum 10 webhooks allowed." };
    }

    await prisma.webhookConfig.create({
      data: { shop: session.shop, url, label },
    });
    return { success: true, intent: "add_webhook" };
  }

  if (intent === "delete_webhook") {
    const id = formData.get("id") as string;
    await prisma.webhookConfig.deleteMany({
      where: { id, shop: session.shop },
    });
    return { success: true, intent: "delete_webhook" };
  }

  return { success: false, error: "Unknown action" };
};

// ---- Component ----

export default function Settings() {
  const { webhooks } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [urlError, setUrlError] = useState("");

  const handleAdd = () => {
    const trimmed = url.trim();
    if (!trimmed || !trimmed.startsWith("http")) {
      setUrlError("Enter a valid URL starting with http:// or https://");
      return;
    }
    setUrlError("");
    const fd = new FormData();
    fd.append("intent", "add_webhook");
    fd.append("url", trimmed);
    fd.append("label", label.trim());
    submit(fd, { method: "post" });
    setUrl("");
    setLabel("");
  };

  const handleDelete = (id: string) => {
    const fd = new FormData();
    fd.append("intent", "delete_webhook");
    fd.append("id", id);
    submit(fd, { method: "post" });
  };

  return (
    <Page backAction={{ content: "Dashboard", url: "/app" }} title="Settings">
      <TitleBar title="Settings" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Deploy Webhooks */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Deploy Webhooks
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    These URLs are called (via POST) every time you deploy a menu. Use them to trigger cache purges,
                    Slack notifications, build pipelines, or any custom automation.
                  </Text>
                </BlockStack>

                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    Webhooks receive a POST request with a JSON body:{" "}
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {"{ shop, menuId, menuTitle, menuHandle, deployedAt }"}
                    </span>
                  </Text>
                </Banner>

                {/* Existing webhooks */}
                {webhooks.length > 0 && (
                  <BlockStack gap="0">
                    <Box paddingBlockEnd="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Active webhooks ({webhooks.length}/10)
                      </Text>
                    </Box>
                    <div
                      style={{
                        border: "1px solid #E1E3E5",
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      {webhooks.map((wh, i) => (
                        <div key={wh.id}>
                          {i > 0 && <Divider />}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "10px 14px",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {wh.label && (
                                <Text as="p" variant="bodySm" fontWeight="semibold">
                                  {wh.label}
                                </Text>
                              )}
                              <Text as="p" variant="bodySm" tone="subdued">
                                <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                                  {wh.url}
                                </span>
                              </Text>
                            </div>
                            <div style={{ flexShrink: 0 }}>
                              <Badge tone="success">Active</Badge>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDelete(wh.id)}
                              style={{
                                flexShrink: 0,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#8C9196",
                                display: "flex",
                                padding: 4,
                                borderRadius: 4,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#D72C0D"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "#8C9196"; }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <path d="M7 4h6M4 6h12M6 6l1 11h6l1-11M9 9v5M11 9v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </BlockStack>
                )}

                {/* Add new webhook */}
                {webhooks.length < 10 && (
                  <BlockStack gap="300">
                    <Divider />
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      Add new webhook
                    </Text>
                    <TextField
                      label="Webhook URL"
                      value={url}
                      onChange={(val) => {
                        setUrl(val);
                        if (urlError) setUrlError("");
                      }}
                      autoComplete="off"
                      placeholder="https://your-service.com/webhook"
                      error={urlError}
                    />
                    <TextField
                      label="Label (optional)"
                      value={label}
                      onChange={setLabel}
                      autoComplete="off"
                      placeholder="e.g. Slack notification, Cache purge"
                    />
                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        loading={isSubmitting}
                        onClick={handleAdd}
                      >
                        Add Webhook
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}

                {webhooks.length >= 10 && (
                  <Banner tone="warning">
                    <Text as="p" variant="bodySm">
                      Maximum of 10 webhooks reached. Delete one to add a new one.
                    </Text>
                  </Banner>
                )}
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
