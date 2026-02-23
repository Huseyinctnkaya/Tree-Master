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
  Tabs,
} from "@shopify/polaris";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ---- Loader ----

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const menuId = params.menuId as string;

  const menu = await prisma.customMenu.findUnique({
    where: { id: menuId },
  });

  if (!menu || menu.shop !== session.shop) {
    throw new Response("Menu not found", { status: 404 });
  }

  return {
    menu: {
      id: menu.id,
      name: menu.name,
      html: menu.html,
      css: menu.css,
      status: menu.status,
      updatedAt: menu.updatedAt.toISOString(),
    },
  };
};

// ---- Action ----

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const menuId = params.menuId as string;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const menu = await prisma.customMenu.findUnique({ where: { id: menuId } });
  if (!menu || menu.shop !== session.shop) {
    return { success: false, intent: "unknown", error: "Menu not found" };
  }

  if (intent === "save") {
    const name = (formData.get("name") as string) || menu.name;
    const html = (formData.get("html") as string) ?? menu.html;
    const css = (formData.get("css") as string) ?? menu.css;

    await prisma.customMenu.update({
      where: { id: menuId },
      data: { name, html, css },
    });

    return { success: true, intent: "save" };
  }

  if (intent === "publish") {
    const name = (formData.get("name") as string) || menu.name;
    const html = (formData.get("html") as string) ?? menu.html;
    const css = (formData.get("css") as string) ?? menu.css;

    await prisma.customMenu.update({
      where: { id: menuId },
      data: { name, html, css, status: "published" },
    });

    return { success: true, intent: "publish" };
  }

  if (intent === "unpublish") {
    await prisma.customMenu.update({
      where: { id: menuId },
      data: { status: "draft" },
    });

    return { success: true, intent: "unpublish" };
  }

  return { success: false, intent: "unknown", error: "Unknown action" };
};

// ---- Code Editor Component ----

function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  language: "html" | "css";
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab indentation support
      if (e.key === "Tab") {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const newValue = value.substring(0, start) + "  " + value.substring(end);
        onChange(newValue);
        // Set cursor position after state updates
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [value, onChange],
  );

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid #C9CCCF",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Language badge */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: "2px 8px",
          background: language === "html" ? "#E8F0FE" : "#F3E8FF",
          color: language === "html" ? "#2C6ECB" : "#7C3AED",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        {language}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 300,
          padding: "12px 16px",
          paddingRight: 60,
          border: "none",
          outline: "none",
          resize: "vertical",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 13,
          lineHeight: "20px",
          background: "#1E1E1E",
          color: "#D4D4D4",
          tabSize: 2,
        }}
      />
    </div>
  );
}

// ---- Live Preview ----

function LivePreview({ html, css }: { html: string; css: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px; }
          ${css}
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `);
    doc.close();
  }, [html, css]);

  return (
    <iframe
      ref={iframeRef}
      title="Menu Preview"
      style={{
        width: "100%",
        minHeight: 200,
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        background: "white",
      }}
      sandbox="allow-same-origin"
    />
  );
}

// ---- Main Page ----

export default function CustomMenuEditor() {
  const { menu } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [name, setName] = useState(menu.name);
  const [html, setHtml] = useState(menu.html);
  const [css, setCss] = useState(menu.css);
  const [selectedTab, setSelectedTab] = useState(0);

  const [savedName, setSavedName] = useState(menu.name);
  const [savedHtml, setSavedHtml] = useState(menu.html);
  const [savedCss, setSavedCss] = useState(menu.css);

  const isSubmitting = navigation.state === "submitting";
  const isDirty = name !== savedName || html !== savedHtml || css !== savedCss;
  const prevActionRef = useRef<string>("");

  // Show/hide save bar
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show("custom-menu-save-bar");
    } else {
      shopify.saveBar.hide("custom-menu-save-bar");
    }
  }, [isDirty, shopify]);

  // Toast on action
  useEffect(() => {
    if (!actionData) return;
    const key = JSON.stringify(actionData);
    if (key === prevActionRef.current) return;
    prevActionRef.current = key;

    if (actionData.success) {
      if (actionData.intent === "save") {
        shopify.toast.show("Menu saved!");
        setSavedName(name);
        setSavedHtml(html);
        setSavedCss(css);
      }
      if (actionData.intent === "publish") {
        shopify.toast.show("Menu published!");
        setSavedName(name);
        setSavedHtml(html);
        setSavedCss(css);
      }
      if (actionData.intent === "unpublish") {
        shopify.toast.show("Menu unpublished.");
      }
    }
  }, [actionData, shopify, name, html, css]);

  const handleDiscard = useCallback(() => {
    setName(savedName);
    setHtml(savedHtml);
    setCss(savedCss);
  }, [savedName, savedHtml, savedCss]);

  const handleSave = useCallback(
    (intent: string) => {
      const fd = new FormData();
      fd.append("intent", intent);
      fd.append("name", name);
      fd.append("html", html);
      fd.append("css", css);
      submit(fd, { method: "post" });
    },
    [name, html, css, submit],
  );

  const tabs = [
    { id: "html", content: "HTML" },
    { id: "css", content: "CSS" },
    { id: "preview", content: "Preview" },
  ];

  return (
    <Page
      backAction={{ url: "/app/custom-menus" }}
      title={name}
      subtitle={`ID: ${menu.id}`}
      titleMetadata={
        <Badge tone={menu.status === "published" ? "success" : undefined}>
          {menu.status}
        </Badge>
      }
    >
      <TitleBar title={name} />
      <SaveBar id="custom-menu-save-bar">
        <button
          // @ts-ignore
          variant="primary"
          onClick={() => handleSave("save")}
          disabled={isSubmitting}
        >
          Save
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <TextField
                  label="Menu name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                />

                <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                  <Box paddingBlockStart="300">
                    {selectedTab === 0 && (
                      <CodeEditor
                        value={html}
                        onChange={setHtml}
                        language="html"
                        placeholder={`<nav class="my-menu">\n  <ul>\n    <li><a href="/">Home</a></li>\n    <li><a href="/collections/all">Shop</a></li>\n    <li><a href="/pages/about">About</a></li>\n  </ul>\n</nav>`}
                      />
                    )}
                    {selectedTab === 1 && (
                      <CodeEditor
                        value={css}
                        onChange={setCss}
                        language="css"
                        placeholder={`.my-menu ul {\n  list-style: none;\n  display: flex;\n  gap: 24px;\n  padding: 0;\n}\n\n.my-menu a {\n  text-decoration: none;\n  color: #333;\n  font-weight: 500;\n}\n\n.my-menu a:hover {\n  color: #000;\n}`}
                      />
                    )}
                    {selectedTab === 2 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Live preview of your custom menu:
                        </Text>
                        <LivePreview html={html} css={css} />
                      </BlockStack>
                    )}
                  </Box>
                </Tabs>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Publish Card */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Status
                </Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">Current status</Text>
                  <Badge tone={menu.status === "published" ? "success" : undefined}>
                    {menu.status}
                  </Badge>
                </InlineStack>
                <Divider />
                {menu.status === "published" ? (
                  <Button
                    fullWidth
                    tone="critical"
                    onClick={() => handleSave("unpublish")}
                    loading={isSubmitting}
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    fullWidth
                    variant="primary"
                    onClick={() => handleSave("publish")}
                    loading={isSubmitting}
                  >
                    Publish
                  </Button>
                )}
              </BlockStack>
            </Card>

            {/* How to Use Card */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  How to use
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    <strong>1.</strong> Write your HTML and CSS in the editor
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>2.</strong> Click Publish when ready
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>3.</strong> Go to your theme editor
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>4.</strong> Add a <strong>Tree Master Menu</strong> block
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>5.</strong> Set mode to <strong>Custom Code</strong>
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>6.</strong> Enter this Menu ID:
                  </Text>
                </BlockStack>
                <div
                  style={{
                    background: "#F6F6F7",
                    border: "1px solid #E1E3E5",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontFamily: "monospace",
                    fontSize: 12,
                    wordBreak: "break-all",
                    userSelect: "all",
                    cursor: "text",
                  }}
                >
                  {menu.id}
                </div>
              </BlockStack>
            </Card>

            {/* Quick Templates */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Templates
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Start with a template and customize it.
                </Text>
                <Button
                  fullWidth
                  onClick={() => {
                    setHtml(`<nav class="nav-horizontal">\n  <ul>\n    <li><a href="/">Home</a></li>\n    <li><a href="/collections/all">Shop</a></li>\n    <li><a href="/pages/about">About</a></li>\n    <li><a href="/pages/contact">Contact</a></li>\n  </ul>\n</nav>`);
                    setCss(`.nav-horizontal ul {\n  list-style: none;\n  display: flex;\n  gap: 24px;\n  padding: 0;\n  margin: 0;\n}\n\n.nav-horizontal a {\n  text-decoration: none;\n  color: #333;\n  font-size: 15px;\n  font-weight: 500;\n  transition: color 0.2s;\n}\n\n.nav-horizontal a:hover {\n  color: #000;\n}`);
                    setSelectedTab(0);
                  }}
                >
                  Horizontal Nav
                </Button>
                <Button
                  fullWidth
                  onClick={() => {
                    setHtml(`<nav class="nav-mega">\n  <ul class="mega-list">\n    <li class="mega-item">\n      <a href="/collections/all" class="mega-link">Shop</a>\n      <div class="mega-dropdown">\n        <div class="mega-col">\n          <h4>Categories</h4>\n          <ul>\n            <li><a href="/collections/shirts">Shirts</a></li>\n            <li><a href="/collections/pants">Pants</a></li>\n            <li><a href="/collections/shoes">Shoes</a></li>\n          </ul>\n        </div>\n        <div class="mega-col">\n          <h4>Featured</h4>\n          <ul>\n            <li><a href="/collections/new">New Arrivals</a></li>\n            <li><a href="/collections/sale">Sale</a></li>\n            <li><a href="/collections/best">Best Sellers</a></li>\n          </ul>\n        </div>\n      </div>\n    </li>\n    <li class="mega-item"><a href="/pages/about" class="mega-link">About</a></li>\n    <li class="mega-item"><a href="/pages/contact" class="mega-link">Contact</a></li>\n  </ul>\n</nav>`);
                    setCss(`.nav-mega { position: relative; }\n\n.mega-list {\n  list-style: none;\n  display: flex;\n  gap: 32px;\n  padding: 0;\n  margin: 0;\n}\n\n.mega-link {\n  text-decoration: none;\n  color: #333;\n  font-size: 15px;\n  font-weight: 600;\n  padding: 12px 0;\n  display: block;\n}\n\n.mega-item { position: relative; }\n\n.mega-dropdown {\n  display: none;\n  position: absolute;\n  top: 100%;\n  left: -20px;\n  background: #fff;\n  border: 1px solid #e5e5e5;\n  border-radius: 12px;\n  padding: 24px;\n  min-width: 400px;\n  box-shadow: 0 8px 24px rgba(0,0,0,0.08);\n  gap: 32px;\n}\n\n.mega-item:hover .mega-dropdown {\n  display: flex;\n}\n\n.mega-col h4 {\n  font-size: 12px;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: #888;\n  margin-bottom: 12px;\n}\n\n.mega-col ul {\n  list-style: none;\n  padding: 0;\n}\n\n.mega-col li { margin-bottom: 8px; }\n\n.mega-col a {\n  text-decoration: none;\n  color: #333;\n  font-size: 14px;\n}\n\n.mega-col a:hover { color: #000; }`);
                    setSelectedTab(0);
                  }}
                >
                  Mega Menu
                </Button>
                <Button
                  fullWidth
                  onClick={() => {
                    setHtml(`<nav class="nav-sidebar">\n  <h3 class="sidebar-title">Menu</h3>\n  <ul>\n    <li><a href="/">Home</a></li>\n    <li>\n      <a href="/collections/all">Shop</a>\n      <ul class="sub">\n        <li><a href="/collections/shirts">Shirts</a></li>\n        <li><a href="/collections/pants">Pants</a></li>\n      </ul>\n    </li>\n    <li><a href="/pages/about">About</a></li>\n    <li><a href="/pages/contact">Contact</a></li>\n  </ul>\n</nav>`);
                    setCss(`.nav-sidebar {\n  max-width: 250px;\n  padding: 20px;\n  background: #fafafa;\n  border-radius: 12px;\n}\n\n.sidebar-title {\n  font-size: 14px;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n  color: #888;\n  margin-bottom: 16px;\n}\n\n.nav-sidebar ul {\n  list-style: none;\n  padding: 0;\n  margin: 0;\n}\n\n.nav-sidebar li { margin-bottom: 4px; }\n\n.nav-sidebar a {\n  text-decoration: none;\n  color: #333;\n  display: block;\n  padding: 8px 12px;\n  border-radius: 6px;\n  font-size: 14px;\n  transition: background 0.15s;\n}\n\n.nav-sidebar a:hover {\n  background: #eee;\n}\n\n.nav-sidebar .sub {\n  padding-left: 16px;\n  margin-top: 4px;\n}\n\n.nav-sidebar .sub a {\n  font-size: 13px;\n  color: #666;\n}`);
                    setSelectedTab(0);
                  }}
                >
                  Sidebar Nav
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      <Box paddingBlockEnd="1600" />
    </Page>
  );
}
