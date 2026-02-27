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
      js: menu.js,
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
    const js = (formData.get("js") as string) ?? menu.js;

    await prisma.customMenu.update({
      where: { id: menuId },
      data: { name, html, css, js },
    });

    return { success: true, intent: "save" };
  }

  if (intent === "publish") {
    const name = (formData.get("name") as string) || menu.name;
    const html = (formData.get("html") as string) ?? menu.html;
    const css = (formData.get("css") as string) ?? menu.css;
    const js = (formData.get("js") as string) ?? menu.js;

    await prisma.customMenu.update({
      where: { id: menuId },
      data: { name, html, css, js, status: "published" },
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
  language: "html" | "css" | "js";
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
          background: language === "html" ? "#E8F0FE" : language === "css" ? "#F3E8FF" : "#FEF3C7",
          color: language === "html" ? "#2C6ECB" : language === "css" ? "#7C3AED" : "#D97706",
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

function LivePreview({ html, css, js }: { html: string; css: string; js: string }) {
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
        ${js ? `<script>${js}<\/script>` : ""}
      </body>
      </html>
    `);
    doc.close();
  }, [html, css, js]);

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
      sandbox="allow-same-origin allow-scripts"
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
  const [js, setJs] = useState(menu.js);
  const [selectedTab, setSelectedTab] = useState(0);

  const [savedName, setSavedName] = useState(menu.name);
  const [savedHtml, setSavedHtml] = useState(menu.html);
  const [savedCss, setSavedCss] = useState(menu.css);
  const [savedJs, setSavedJs] = useState(menu.js);

  const isSubmitting = navigation.state === "submitting";
  const isDirty = name !== savedName || html !== savedHtml || css !== savedCss || js !== savedJs;
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
        setSavedJs(js);
      }
      if (actionData.intent === "publish") {
        shopify.toast.show("Menu published!");
        setSavedName(name);
        setSavedHtml(html);
        setSavedCss(css);
        setSavedJs(js);
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
    setJs(savedJs);
  }, [savedName, savedHtml, savedCss, savedJs]);

  const handleSave = useCallback(
    (intent: string) => {
      const fd = new FormData();
      fd.append("intent", intent);
      fd.append("name", name);
      fd.append("html", html);
      fd.append("css", css);
      fd.append("js", js);
      submit(fd, { method: "post" });
    },
    [name, html, css, js, submit],
  );

  const tabs = [
    { id: "html", content: "HTML" },
    { id: "css", content: "CSS" },
    { id: "js", content: "JS" },
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
                      <CodeEditor
                        value={js}
                        onChange={setJs}
                        language="js"
                        placeholder={`// JavaScript runs after your HTML is injected into the page.\n// Example: open dropdowns on click instead of hover\n\ndocument.querySelectorAll('.mega-item').forEach(function(item) {\n  item.addEventListener('click', function() {\n    this.classList.toggle('open');\n  });\n});`}
                      />
                    )}
                    {selectedTab === 3 && (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Live preview of your custom menu:
                        </Text>
                        <LivePreview html={html} css={css} js={js} />
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
                    <strong>5.</strong> Enter this Menu ID:
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
                    setHtml(`<nav class="nm">\n  <ul class="nm-list">\n    <li class="nm-item nm-item--drop">\n      <a href="/collections/all" class="nm-link">\n        Shop\n        <svg class="nm-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n      </a>\n      <div class="nm-drop">\n        <div class="nm-drop-inner">\n          <div class="nm-col">\n            <p class="nm-col-title">Categories</p>\n            <ul>\n              <li><a href="/collections/shirts">Shirts</a></li>\n              <li><a href="/collections/pants">Pants</a></li>\n              <li><a href="/collections/shoes">Shoes</a></li>\n            </ul>\n          </div>\n          <div class="nm-col">\n            <p class="nm-col-title">Featured</p>\n            <ul>\n              <li><a href="/collections/new">New Arrivals</a></li>\n              <li><a href="/collections/sale">Sale</a></li>\n              <li><a href="/collections/best">Best Sellers</a></li>\n            </ul>\n          </div>\n        </div>\n      </div>\n    </li>\n    <li class="nm-item"><a href="/pages/about" class="nm-link">About</a></li>\n    <li class="nm-item"><a href="/pages/contact" class="nm-link">Contact</a></li>\n  </ul>\n</nav>`);
                    setCss(`.nm { position: relative; }\n\n.nm-list {\n  list-style: none;\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  padding: 0;\n  margin: 0;\n}\n\n.nm-item { position: relative; }\n\n.nm-link {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  text-decoration: none;\n  color: #fff;\n  font-size: 14px;\n  font-weight: 500;\n  padding: 7px 12px;\n  border-radius: 6px;\n  transition: background 0.15s;\n  white-space: nowrap;\n  letter-spacing: 0.01em;\n}\n\n.nm-link:hover {\n  background: rgba(255,255,255,0.12);\n}\n\n.nm-arrow {\n  opacity: 0.6;\n  transition: transform 0.2s ease;\n  flex-shrink: 0;\n}\n\n.nm-item--drop:hover .nm-arrow {\n  transform: rotate(180deg);\n}\n\n.nm-drop {\n  position: absolute;\n  top: calc(100% + 10px);\n  left: 0;\n  opacity: 0;\n  visibility: hidden;\n  transform: translateY(-6px);\n  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0.18s;\n  pointer-events: none;\n  z-index: 200;\n}\n\n.nm-item--drop:hover .nm-drop {\n  opacity: 1;\n  visibility: visible;\n  transform: translateY(0);\n  pointer-events: auto;\n}\n\n.nm-drop-inner {\n  display: flex;\n  gap: 28px;\n  background: #fff;\n  border-radius: 14px;\n  padding: 22px 26px;\n  min-width: 300px;\n  box-shadow:\n    0 0 0 1px rgba(0,0,0,0.06),\n    0 4px 6px -2px rgba(0,0,0,0.05),\n    0 16px 32px -4px rgba(0,0,0,0.12);\n}\n\n.nm-col-title {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.07em;\n  color: #aaa;\n  margin: 0 0 10px 0;\n}\n\n.nm-col ul {\n  list-style: none;\n  padding: 0;\n  margin: 0;\n}\n\n.nm-col li { margin-bottom: 1px; }\n\n.nm-col a {\n  display: block;\n  text-decoration: none;\n  color: #1a1a1a;\n  font-size: 14px;\n  padding: 6px 8px;\n  margin: 0 -8px;\n  border-radius: 7px;\n  transition: background 0.12s, color 0.12s;\n}\n\n.nm-col a:hover {\n  background: #f4f4f4;\n  color: #000;\n}`);
                    setJs(`// Mega menu is CSS-only (hover). Add JS here if you need click/touch support.\n// Example: close dropdown when clicking outside\ndocument.addEventListener('click', function(e) {\n  if (!e.target.closest('.nm-item--drop')) {\n    document.querySelectorAll('.nm-drop').forEach(function(d) {\n      d.style.opacity = '';\n    });\n  }\n});`);
                    setSelectedTab(0);
                  }}
                >
                  Mega Menu
                </Button>
                <Button
                  fullWidth
                  onClick={() => {
                    setHtml(`<nav class="dn">\n  <button class="dn-toggle" aria-label="Open menu" aria-expanded="false">\n    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">\n      <rect x="2" y="5" width="16" height="1.5" rx="0.75" fill="currentColor"/>\n      <rect x="2" y="9.25" width="16" height="1.5" rx="0.75" fill="currentColor"/>\n      <rect x="2" y="13.5" width="16" height="1.5" rx="0.75" fill="currentColor"/>\n    </svg>\n  </button>\n  <div class="dn-drawer">\n    <div class="dn-drawer-header">\n      <span class="dn-drawer-title">Menu</span>\n      <button class="dn-close" aria-label="Close menu">\n        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3l12 12M15 3L3 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>\n      </button>\n    </div>\n    <ul class="dn-list">\n      <li><a href="/">Home</a></li>\n      <li class="dn-has-sub">\n        <button class="dn-sub-toggle">Shop <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>\n        <ul class="dn-sub">\n          <li><a href="/collections/shirts">Shirts</a></li>\n          <li><a href="/collections/pants">Pants</a></li>\n          <li><a href="/collections/shoes">Shoes</a></li>\n        </ul>\n      </li>\n      <li><a href="/pages/about">About</a></li>\n      <li><a href="/pages/contact">Contact</a></li>\n    </ul>\n  </div>\n  <div class="dn-overlay"></div>\n</nav>`);
                    setCss(`.dn { position: relative; }\n\n.dn-toggle {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 36px;\n  height: 36px;\n  background: none;\n  border: none;\n  cursor: pointer;\n  color: #fff;\n  border-radius: 6px;\n  transition: background 0.15s;\n}\n\n.dn-toggle:hover { background: rgba(255,255,255,0.12); }\n\n.dn-overlay {\n  display: none;\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.4);\n  z-index: 998;\n  backdrop-filter: blur(2px);\n}\n\n.dn-drawer {\n  position: fixed;\n  top: 0;\n  left: 0;\n  width: 300px;\n  height: 100vh;\n  background: #fff;\n  z-index: 999;\n  transform: translateX(-100%);\n  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);\n  display: flex;\n  flex-direction: column;\n  overflow-y: auto;\n}\n\n.dn--open .dn-drawer { transform: translateX(0); }\n.dn--open .dn-overlay { display: block; }\n\n.dn-drawer-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 18px 20px;\n  border-bottom: 1px solid #f0f0f0;\n}\n\n.dn-drawer-title {\n  font-size: 16px;\n  font-weight: 600;\n  color: #111;\n  letter-spacing: 0.01em;\n}\n\n.dn-close {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  background: none;\n  border: none;\n  cursor: pointer;\n  color: #666;\n  border-radius: 6px;\n  transition: background 0.15s;\n}\n\n.dn-close:hover { background: #f5f5f5; }\n\n.dn-list {\n  list-style: none;\n  padding: 12px 0;\n  margin: 0;\n  flex: 1;\n}\n\n.dn-list > li > a,\n.dn-sub-toggle {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  width: 100%;\n  padding: 12px 20px;\n  text-decoration: none;\n  color: #111;\n  font-size: 15px;\n  font-weight: 500;\n  background: none;\n  border: none;\n  cursor: pointer;\n  text-align: left;\n  transition: background 0.12s;\n  gap: 8px;\n}\n\n.dn-list > li > a:hover,\n.dn-sub-toggle:hover { background: #f8f8f8; }\n\n.dn-sub-toggle svg { transition: transform 0.2s ease; flex-shrink: 0; }\n.dn-has-sub.open .dn-sub-toggle svg { transform: rotate(180deg); }\n\n.dn-sub {\n  list-style: none;\n  padding: 4px 0 8px 0;\n  margin: 0;\n  max-height: 0;\n  overflow: hidden;\n  transition: max-height 0.25s ease;\n}\n\n.dn-has-sub.open .dn-sub { max-height: 300px; }\n\n.dn-sub a {\n  display: block;\n  padding: 9px 20px 9px 36px;\n  text-decoration: none;\n  color: #555;\n  font-size: 14px;\n  transition: background 0.12s, color 0.12s;\n}\n\n.dn-sub a:hover { background: #f8f8f8; color: #111; }`);
                    setJs(`// Drawer menu open/close\nvar nav = document.querySelector('.dn');\nif (nav) {\n  var toggle = nav.querySelector('.dn-toggle');\n  var close = nav.querySelector('.dn-close');\n  var overlay = nav.querySelector('.dn-overlay');\n  var subToggles = nav.querySelectorAll('.dn-sub-toggle');\n\n  function openDrawer() { nav.classList.add('dn--open'); document.body.style.overflow = 'hidden'; }\n  function closeDrawer() { nav.classList.remove('dn--open'); document.body.style.overflow = ''; }\n\n  if (toggle) toggle.addEventListener('click', openDrawer);\n  if (close) close.addEventListener('click', closeDrawer);\n  if (overlay) overlay.addEventListener('click', closeDrawer);\n\n  subToggles.forEach(function(btn) {\n    btn.addEventListener('click', function() {\n      var li = btn.closest('.dn-has-sub');\n      if (li) li.classList.toggle('open');\n    });\n  });\n}`);
                    setSelectedTab(0);
                  }}
                >
                  Mobile Drawer
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
