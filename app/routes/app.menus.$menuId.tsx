import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useFetcher } from "@remix-run/react";
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
  Icon,
  Tooltip,
  Modal,
  Spinner,
} from "@shopify/polaris";
import { DeleteIcon, DragHandleIcon, CalendarIcon, ClockIcon } from "@shopify/polaris-icons";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ---- Types ----

type MenuItem = {
  id: string;
  title: string;
  url: string;
  type: string;
  resourceId: string | null;
  handle: string;
  seoKeywords: string;
  metaDescription: string;
  items: MenuItem[];
};

type MenuData = {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
};

type DragInfo = {
  level: "top" | "sub";
  parentId?: string;
  index: number;
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

// ---- Link Type System ----

type LinkTypeOption = {
  value: string;
  label: string;
  shopifyType: string;
  autoUrl?: string;
  urlPrefix?: string;
  placeholder?: string;
};

type LinkCategory = {
  id: string;
  label: string;
  options: LinkTypeOption[];
};

const LINK_CATEGORIES: LinkCategory[] = [
  {
    id: "internal",
    label: "Internal Pages",
    options: [
      { value: "FRONTPAGE", label: "Home", shopifyType: "FRONTPAGE", autoUrl: "/" },
      { value: "CATALOG", label: "All Products", shopifyType: "CATALOG", autoUrl: "/collections/all" },
      { value: "SEARCH", label: "Search", shopifyType: "SEARCH", autoUrl: "/search" },
    ],
  },
  {
    id: "content",
    label: "Store Content",
    options: [
      { value: "COLLECTION", label: "Collection", shopifyType: "COLLECTION", placeholder: "/collections/..." },
      { value: "PRODUCT", label: "Product", shopifyType: "PRODUCT", placeholder: "/products/..." },
      { value: "PAGE", label: "Page", shopifyType: "PAGE", placeholder: "/pages/..." },
      { value: "BLOG", label: "Blog", shopifyType: "BLOG", placeholder: "/blogs/..." },
      { value: "ARTICLE", label: "Article", shopifyType: "ARTICLE", placeholder: "/blogs/.../article" },
    ],
  },
  {
    id: "account",
    label: "Customer Account",
    options: [
      { value: "_ACCOUNT", label: "Account", shopifyType: "HTTP", autoUrl: "/account" },
      { value: "_LOGIN", label: "Login", shopifyType: "HTTP", autoUrl: "/account/login" },
      { value: "_REGISTER", label: "Register", shopifyType: "HTTP", autoUrl: "/account/register" },
      { value: "_CART", label: "Cart", shopifyType: "HTTP", autoUrl: "/cart" },
    ],
  },
  {
    id: "policies",
    label: "Policies",
    options: [
      { value: "_TERMS", label: "Terms of Service", shopifyType: "HTTP", autoUrl: "/policies/terms-of-service" },
      { value: "_PRIVACY", label: "Privacy Policy", shopifyType: "HTTP", autoUrl: "/policies/privacy-policy" },
      { value: "_REFUND", label: "Refund Policy", shopifyType: "HTTP", autoUrl: "/policies/refund-policy" },
      { value: "_SHIPPING", label: "Shipping Policy", shopifyType: "HTTP", autoUrl: "/policies/shipping-policy" },
    ],
  },
  {
    id: "custom",
    label: "Custom Links",
    options: [
      { value: "HTTP", label: "Custom URL", shopifyType: "HTTP", placeholder: "https://example.com" },
      { value: "_EMAIL", label: "Email", shopifyType: "HTTP", urlPrefix: "mailto:", placeholder: "hello@example.com" },
      { value: "_PHONE", label: "Phone", shopifyType: "HTTP", urlPrefix: "tel:", placeholder: "+1 (555) 123-4567" },
      { value: "_ANCHOR", label: "Anchor", shopifyType: "HTTP", urlPrefix: "#", placeholder: "section-name" },
    ],
  },
];

// Flat lookup maps
const ALL_LINK_TYPES: Record<string, LinkTypeOption> = {};
for (const cat of LINK_CATEGORIES) {
  for (const opt of cat.options) {
    ALL_LINK_TYPES[opt.value] = opt;
  }
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  internal: { bg: "#E3F4E8", text: "#1B7B3D" },
  content: { bg: "#E8F0FE", text: "#2C6ECB" },
  account: { bg: "#F3E8FF", text: "#7C3AED" },
  policies: { bg: "#FFF3E0", text: "#B45309" },
  custom: { bg: "#F1F1F1", text: "#616161" },
};

function getCategoryForType(type: string): string {
  for (const cat of LINK_CATEGORIES) {
    if (cat.options.some((o) => o.value === type)) return cat.id;
  }
  return "custom";
}

// Shopify auto types (don't need url/resourceId)
const SHOPIFY_AUTO_TYPES = ["FRONTPAGE", "CATALOG", "SEARCH"];

// ---- Helpers ----

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type ItemMeta = {
  handle: string;
  seoKeywords: string;
  metaDescription: string;
};

function detectAppType(shopifyType: string, url: string): string {
  if (shopifyType !== "HTTP") return shopifyType;
  const u = url || "";
  if (u === "/account" || u.endsWith("/account")) return "_ACCOUNT";
  if (u === "/account/login" || u.endsWith("/account/login")) return "_LOGIN";
  if (u === "/account/register" || u.endsWith("/account/register")) return "_REGISTER";
  if (u === "/cart" || u.endsWith("/cart")) return "_CART";
  if (u.includes("/policies/terms-of-service")) return "_TERMS";
  if (u.includes("/policies/privacy-policy")) return "_PRIVACY";
  if (u.includes("/policies/refund-policy")) return "_REFUND";
  if (u.includes("/policies/shipping-policy")) return "_SHIPPING";
  if (u.startsWith("mailto:")) return "_EMAIL";
  if (u.startsWith("tel:")) return "_PHONE";
  if (u.startsWith("#")) return "_ANCHOR";
  return "HTTP";
}

function stripUrlForDisplay(appType: string, url: string): string {
  if (appType === "_EMAIL" && url.startsWith("mailto:")) return url.slice(7);
  if (appType === "_PHONE" && url.startsWith("tel:")) return url.slice(4);
  if (appType === "_ANCHOR" && url.startsWith("#")) return url.slice(1);
  const typeInfo = ALL_LINK_TYPES[appType];
  if (typeInfo?.autoUrl) return "";
  return url;
}

function normalizeItems(items: any[], metaMap: Record<string, ItemMeta> = {}): MenuItem[] {
  return (items ?? []).map((item) => {
    const appType = detectAppType(item.type ?? "HTTP", item.url ?? "");
    const meta = metaMap[item.id] || {};
    const title = item.title ?? "";
    return {
      id: item.id,
      title,
      url: stripUrlForDisplay(appType, item.url ?? ""),
      type: appType,
      resourceId: item.resourceId ?? null,
      handle: meta.handle || slugify(title),
      seoKeywords: meta.seoKeywords || "",
      metaDescription: meta.metaDescription || "",
      items: normalizeItems(item.items ?? [], metaMap),
    };
  });
}

function buildUpdateInput(items: MenuItem[]): object[] {
  return items.map((item) => {
    const typeInfo = ALL_LINK_TYPES[item.type];
    const shopifyType = typeInfo?.shopifyType || item.type;

    const input: Record<string, unknown> = {
      title: item.title,
      type: shopifyType,
    };

    if (!item.id.startsWith("new-")) {
      input.id = item.id;
    }

    if (typeInfo?.autoUrl && shopifyType === "HTTP") {
      // App-level auto types (account, policies, cart) → set URL
      input.url = typeInfo.autoUrl;
    } else if (typeInfo?.urlPrefix) {
      // Prefix types (email, phone, anchor)
      input.url = typeInfo.urlPrefix + item.url;
    } else if (SHOPIFY_AUTO_TYPES.includes(shopifyType)) {
      // Shopify auto types (FRONTPAGE, CATALOG, SEARCH)
      // Preserve resourceId if Shopify originally returned one
      if (item.resourceId) {
        input.resourceId = item.resourceId;
      }
    } else if (shopifyType === "HTTP") {
      input.url = item.url;
    } else {
      // Resource types (COLLECTION, PRODUCT, PAGE, BLOG, ARTICLE)
      // Shopify requires resourceId for these — prefer it over url
      if (item.resourceId) {
        input.resourceId = item.resourceId;
      } else if (item.url) {
        input.url = item.url;
      }
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
  return { id: newId(), title: "", url: "", type: "HTTP", resourceId: null, handle: "", seoKeywords: "", metaDescription: "", items: [] };
}

// ---- Loader ----

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const menuGid = `gid://shopify/Menu/${params.menuId}`;

  const response = await admin.graphql(GET_MENU_QUERY, {
    variables: { id: menuGid },
  });
  const data = await response.json();

  if (!data.data?.menu) {
    throw new Response("Menu not found", { status: 404 });
  }

  const menu = data.data.menu;

  // Load saved metadata for this menu's items
  const menuMeta = await prisma.menuMeta.findUnique({
    where: { shop_menuGid: { shop: session.shop, menuGid } },
  });
  const metaMap: Record<string, ItemMeta> = menuMeta?.data ? JSON.parse(menuMeta.data) : {};

  const scheduledDeploys = await prisma.scheduledDeploy.findMany({
    where: {
      shop: session.shop,
      menuGid,
      status: "pending",
    },
    orderBy: { scheduledAt: "asc" },
  });

  return {
    menu: {
      ...menu,
      items: normalizeItems(menu.items, metaMap),
    } as MenuData,
    scheduledDeploys: scheduledDeploys.map((d) => ({
      id: d.id,
      scheduledAt: d.scheduledAt.toISOString(),
      menuTitle: d.menuTitle,
    })),
  };
};

// ---- Action ----

function extractMetaMap(items: MenuItem[]): Record<string, ItemMeta> {
  const map: Record<string, ItemMeta> = {};
  for (const item of items) {
    if (item.handle || item.seoKeywords || item.metaDescription) {
      map[item.id] = {
        handle: item.handle || "",
        seoKeywords: item.seoKeywords || "",
        metaDescription: item.metaDescription || "",
      };
    }
    if (item.items?.length) {
      Object.assign(map, extractMetaMap(item.items));
    }
  }
  return map;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const menuGid = `gid://shopify/Menu/${params.menuId}`;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const menuTitle = formData.get("menuTitle") as string;
  const menuHandle = formData.get("menuHandle") as string;
  const itemsJson = formData.get("items") as string;
  const items = JSON.parse(itemsJson) as MenuItem[];

  // Save metadata to DB on every action that has items
  const metaMap = extractMetaMap(items);
  if (Object.keys(metaMap).length > 0) {
    await prisma.menuMeta.upsert({
      where: { shop_menuGid: { shop: session.shop, menuGid } },
      create: { shop: session.shop, menuGid, data: JSON.stringify(metaMap) },
      update: { data: JSON.stringify(metaMap) },
    });
  }

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

  if (intent === "schedule") {
    const scheduledAt = formData.get("scheduledAt") as string;
    if (!scheduledAt) {
      return { success: false, intent: "schedule", errors: [{ field: "scheduledAt", message: "Please select a date and time." }] };
    }
    await prisma.scheduledDeploy.create({
      data: {
        shop: session.shop,
        menuGid,
        menuHandle,
        menuTitle,
        data: itemsJson,
        scheduledAt: new Date(scheduledAt),
      },
    });
    return { success: true, intent: "schedule" };
  }

  if (intent === "cancel_schedule") {
    const scheduleId = formData.get("scheduleId") as string;
    await prisma.scheduledDeploy.update({
      where: { id: scheduleId },
      data: { status: "cancelled" },
    });
    return { success: true, intent: "cancel_schedule" };
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

// ---- Visual Tree Preview ----

function TreePreview({ items, menuTitle }: { items: MenuItem[]; menuTitle: string }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: "22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="3" rx="1" fill="#303030" />
          <rect x="1" y="6" width="14" height="9" rx="1" stroke="#303030" strokeWidth="1.5" fill="none" />
        </svg>
        <span style={{ fontWeight: 600, color: "#303030" }}>{menuTitle || "Menu"}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ color: "#8C9196", paddingLeft: 20, fontStyle: "italic" }}>Empty menu</div>
      ) : (
        items.map((item, i) => (
          <TreeNode key={item.id} item={item} isLast={i === items.length - 1} depth={0} />
        ))
      )}
    </div>
  );
}

function TreeNode({ item, isLast, depth }: { item: MenuItem; isLast: boolean; depth: number }) {
  const connector = isLast ? "└─" : "├─";
  const title = item.title || "(Untitled)";
  const hasChildren = item.items && item.items.length > 0;
  const typeInfo = ALL_LINK_TYPES[item.type];
  const typeLabel = typeInfo?.label || item.type;
  const category = getCategoryForType(item.type);
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.custom;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: depth === 0 ? 8 : 8 + depth * 20,
          color: "#303030",
        }}
      >
        <span style={{ color: "#8C9196", userSelect: "none" }}>{connector}</span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>
          {title}
        </span>
        {item.handle && (
          <span style={{ fontSize: 9, color: "#8C9196", fontStyle: "italic", whiteSpace: "nowrap" }}>
            /{item.handle}
          </span>
        )}
        <span
          style={{
            fontSize: 9,
            background: colors.bg,
            color: colors.text,
            padding: "1px 4px",
            borderRadius: 3,
            whiteSpace: "nowrap",
          }}
        >
          {typeLabel}
        </span>
      </div>
      {hasChildren &&
        item.items.map((child, ci) => (
          <TreeNode key={child.id} item={child} isLast={ci === item.items.length - 1} depth={depth + 1} />
        ))}
    </div>
  );
}

// ---- Draggable Item Row ----

function ItemRow({
  item,
  depth,
  isExpanded,
  isDragOver,
  dragPosition,
  noMargin,
  onToggle,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  item: MenuItem;
  depth: number;
  isExpanded: boolean;
  isDragOver?: boolean;
  dragPosition?: "above" | "below";
  noMargin?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const typeInfo = ALL_LINK_TYPES[item.type];
  const typeLabel = typeInfo?.label || item.type;
  const category = getCategoryForType(item.type);
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.custom;
  const title = item.title || "(Untitled)";
  const isEmpty = !item.title;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: "relative", marginBottom: noMargin ? 0 : depth > 0 ? 4 : 6 }}
    >
      {/* Drop indicator line - only show above */}
      {isDragOver && (
        <div
          style={{
            position: "absolute",
            top: dragPosition === "above" ? -1 : undefined,
            bottom: dragPosition === "below" ? -1 : undefined,
            left: depth > 0 ? 44 : 0,
            right: 0,
            height: 2,
            background: "#2C6ECB",
            borderRadius: 1,
            zIndex: 10,
          }}
        />
      )}

      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          paddingLeft: depth > 0 ? 44 : 12,
          cursor: "grab",
          background: isExpanded ? "#F6F6F7" : "#fff",
          borderRadius: 8,
          border: isExpanded ? "none" : "1px solid #E1E3E5",
          transition: "background 0.1s ease, border-color 0.1s ease",
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.background = "#FAFAFA";
            e.currentTarget.style.borderColor = "#C9CCCF";
          }
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "#E1E3E5";
          }
        }}
      >
        {/* Drag handle icon */}
        <div
          style={{
            flexShrink: 0,
            color: "#8C9196",
            display: "flex",
          }}
        >
          <Icon source={DragHandleIcon} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="span" variant="bodyMd" fontWeight={isExpanded ? "semibold" : "regular"} tone={isEmpty ? "subdued" : undefined}>
            {title}
          </Text>
        </div>
        <div
          style={{
            flexShrink: 0,
            padding: "2px 8px",
            borderRadius: 4,
            background: colors.bg,
            color: colors.text,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {typeLabel}
        </div>
        <div
          style={{ flexShrink: 0, display: "flex", cursor: "pointer", color: "#8C9196" }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#D72C0D"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#8C9196"; }}
        >
          <Icon source={DeleteIcon} />
        </div>
      </div>
    </div>
  );
}

// ---- Link Type Picker (Dropdown) ----

function LinkTypePicker({ value, onChange }: { value: string; onChange: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const typeInfo = ALL_LINK_TYPES[value];
  const category = getCategoryForType(value);
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.custom;
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Keep position synced with button while open
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const handleOpen = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const dropdown = open
    ? createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: "white",
            border: "1px solid #E1E3E5",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 99999,
            maxHeight: 340,
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {LINK_CATEGORIES.map((cat) => {
            const catColors = CATEGORY_COLORS[cat.id] || CATEGORY_COLORS.custom;
            return (
              <div key={cat.id}>
                <div style={{ padding: "6px 14px 2px", fontSize: 11, fontWeight: 600, color: "#8C9196", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {cat.label}
                </div>
                {cat.options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 14px",
                        border: "none",
                        background: isSelected ? catColors.bg : "transparent",
                        color: isSelected ? catColors.text : "#303030",
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "#F6F6F7";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7L5.5 10.5L12 3.5" stroke={catColors.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div>
      <Text as="p" variant="bodySm" fontWeight="semibold">
        Link to
      </Text>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        style={{
          marginTop: 4,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #C9CCCF",
          background: "white",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              background: colors.bg,
              color: colors.text,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {typeInfo?.label || value}
          </span>
          <span style={{ color: "#6D7175", fontSize: 12 }}>
            {LINK_CATEGORIES.find((c) => c.id === category)?.label}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="#6D7175" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}

// ---- Smart URL Field ----

type ResourceLoaderData = { resources: Array<{ id: string; title: string; url: string }> };

function SmartUrlField({
  item,
  onChange,
}: {
  item: MenuItem;
  onChange: (updated: MenuItem) => void;
}) {
  const typeInfo = ALL_LINK_TYPES[item.type];
  const shopify = useAppBridge();
  const fetcher = useFetcher<ResourceLoaderData>();
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  if (!typeInfo) return null;

  // Auto URL types (Home, Search, Account pages, Policies)
  if (typeInfo.autoUrl) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#F1F8F5",
          border: "1px solid #C9E8D9",
          borderRadius: 8,
          padding: "8px 12px",
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B7B3D", flexShrink: 0 }} />
        <Text as="p" variant="bodySm">
          Links to{" "}
          <span style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>
            {typeInfo.autoUrl}
          </span>{" "}
          automatically
        </Text>
      </div>
    );
  }

  // Prefix types (Email, Phone, Anchor)
  if (typeInfo.urlPrefix) {
    return (
      <TextField
        label={typeInfo.label}
        value={item.url}
        onChange={(val) => onChange({ ...item, url: val })}
        autoComplete="off"
        placeholder={typeInfo.placeholder}
        prefix={typeInfo.urlPrefix}
      />
    );
  }

  // Custom URL
  if (item.type === "HTTP") {
    return (
      <TextField
        label="URL"
        value={item.url}
        onChange={(val) => onChange({ ...item, url: val })}
        autoComplete="off"
        placeholder="https://"
      />
    );
  }

  // Resource types: PRODUCT, COLLECTION, PAGE, BLOG, ARTICLE
  const handleBrowse = async () => {
    if (item.type === "PRODUCT") {
      try {
        const selected = await (shopify as any).resourcePicker({ type: "product", multiple: false });
        if (selected && selected.length > 0) {
          const r = selected[0];
          onChange({ ...item, url: `/products/${r.handle}`, resourceId: r.id });
        }
      } catch {}
    } else if (item.type === "COLLECTION") {
      try {
        const selected = await (shopify as any).resourcePicker({ type: "collection", multiple: false });
        if (selected && selected.length > 0) {
          const r = selected[0];
          onChange({ ...item, url: `/collections/${r.handle}`, resourceId: r.id });
        }
      } catch {}
    } else {
      const typeParam = item.type.toLowerCase();
      fetcher.load(`/app/resources?type=${typeParam}`);
      setModalOpen(true);
      setSearchQuery("");
    }
  };

  const allResources = fetcher.data?.resources ?? [];
  const filtered = allResources.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const isLoading = fetcher.state === "loading";
  const hasSelection = !!(item.url || item.resourceId);

  return (
    <div>
      <BlockStack gap="200">
        {/* Selected resource display */}
        {hasSelection && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#F1F8F5",
              border: "1px solid #C9E8D9",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B7B3D", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text as="p" variant="bodySm">
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>{item.url}</span>
              </Text>
            </div>
            <button
              type="button"
              onClick={handleBrowse}
              style={{
                flexShrink: 0,
                padding: "3px 10px",
                borderRadius: 6,
                border: "1px solid #C9CCCF",
                background: "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Change
            </button>
          </div>
        )}

        {/* Browse button when nothing selected */}
        {!hasSelection && (
          <Button fullWidth onClick={handleBrowse}>
            Browse {typeInfo.label}
          </Button>
        )}
      </BlockStack>

      {/* Custom resource picker modal (Page, Blog, Article) */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Select ${typeInfo.label}`}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label=""
              labelHidden
              value={searchQuery}
              onChange={(val) => {
                setSearchQuery(val);
              }}
              autoComplete="off"
              placeholder={`Search ${typeInfo.label.toLowerCase()}s...`}
            />
          </BlockStack>
        </Modal.Section>

        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {isLoading ? (
            <div style={{ padding: 32, display: "flex", justifyContent: "center" }}>
              <Spinner size="small" />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "16px 20px" }}>
              <Text as="p" tone="subdued">
                {allResources.length === 0 ? `No ${typeInfo.label.toLowerCase()}s found.` : "No results match your search."}
              </Text>
            </div>
          ) : (
            filtered.map((resource) => (
              <button
                key={resource.id}
                type="button"
                onClick={() => {
                  onChange({ ...item, url: resource.url, resourceId: resource.id });
                  setModalOpen(false);
                  setSearchQuery("");
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "11px 20px",
                  border: "none",
                  borderBottom: "1px solid #F1F1F1",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  gap: 12,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F7"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: "#303030" }}>{resource.title}</span>
                <span style={{ fontSize: 11, color: "#8C9196", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {resource.url}
                </span>
              </button>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

// ---- Expanded Item Form ----

function ExpandedForm({
  item,
  depth,
  expandedSubId,
  onChange,
  onDelete,
  onToggle,
  onToggleSub,
  onSubDragStart,
  onSubDragEnd,
  onSubDragOver,
  onSubDragLeave,
  onSubDrop,
  dragOverSubId,
  dragSubPosition,
}: {
  item: MenuItem;
  depth: number;
  expandedSubId: string | null;
  onChange: (updated: MenuItem) => void;
  onDelete: () => void;
  onToggle: () => void;
  onToggleSub: (id: string | null) => void;
  onSubDragStart: (e: React.DragEvent, index: number) => void;
  onSubDragEnd: (e: React.DragEvent) => void;
  onSubDragOver: (e: React.DragEvent, index: number) => void;
  onSubDragLeave: (e: React.DragEvent) => void;
  onSubDrop: (e: React.DragEvent, index: number) => void;
  dragOverSubId: string | null;
  dragSubPosition: "above" | "below" | null;
}) {
  const handleTypeChange = useCallback(
    (val: string) => {
      const typeInfo = ALL_LINK_TYPES[val];
      const updated: MenuItem = { ...item, type: val };
      if (typeInfo?.autoUrl || typeInfo?.urlPrefix) {
        updated.url = "";
        updated.resourceId = null;
      } else if (val === "HTTP") {
        updated.resourceId = null;
      }
      onChange(updated);
    },
    [item, onChange],
  );

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

  const handleAddSubItem = useCallback(() => {
    const newItem = emptyItem();
    onChange({ ...item, items: [...item.items, newItem] });
    onToggleSub(newItem.id);
  }, [item, onChange, onToggleSub]);

  return (
    <div style={{ border: "1px solid #C9CCCF", borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
      {/* Header row */}
      <ItemRow
        item={item}
        depth={0}
        isExpanded={true}
        noMargin
        onToggle={onToggle}
        onDelete={onDelete}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {}}
        onDrop={(e) => e.preventDefault()}
      />

      {/* Form */}
      <div style={{ borderTop: "1px solid #E1E3E5", padding: 16, animation: "menuItemExpand 0.28s cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <BlockStack gap="300">
          {/* Title */}
          <TextField
            label="Title"
            value={item.title}
            onChange={(val) => {
              const updated: MenuItem = { ...item, title: val };
              // Auto-generate handle from title if handle was auto-generated or empty
              if (!item.handle || item.handle === slugify(item.title)) {
                updated.handle = slugify(val);
              }
              onChange(updated);
            }}
            autoComplete="off"
          />

          {/* Handle */}
          <TextField
            label="Handle"
            value={item.handle}
            onChange={(val) => onChange({ ...item, handle: val })}
            autoComplete="off"
            prefix="/"
            helpText="URL-friendly identifier for this item"
          />

          {/* Link Type Picker */}
          <LinkTypePicker value={item.type} onChange={handleTypeChange} />

          {/* Smart URL Field */}
          <SmartUrlField item={item} onChange={onChange} />

          {/* SEO Section */}
          <div style={{ marginTop: 4 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#2C6ECB" strokeWidth="1.5" fill="none" />
                <path d="M5.5 8.5L7 10L10.5 6" stroke="#2C6ECB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                SEO Settings
              </Text>
            </div>
            <BlockStack gap="200">
              <TextField
                label="SEO Keywords"
                value={item.seoKeywords}
                onChange={(val) => onChange({ ...item, seoKeywords: val })}
                autoComplete="off"
                placeholder="e.g. shoes, sneakers, running"
                helpText="Comma-separated keywords for this menu item"
              />
              <TextField
                label="Meta Description"
                value={item.metaDescription}
                onChange={(val) => onChange({ ...item, metaDescription: val })}
                autoComplete="off"
                placeholder="Brief description for search engines..."
                multiline={2}
                maxLength={160}
                showCharacterCount
                helpText="Recommended: 50-160 characters"
              />
            </BlockStack>
          </div>

          {/* Add sub-item button */}
          {depth === 0 && (
            <InlineStack align="end">
              <Button size="slim" onClick={handleAddSubItem}>
                + Add sub-item
              </Button>
            </InlineStack>
          )}

          {/* Sub-items */}
          {depth === 0 && item.items.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <Divider />
              <div style={{ marginTop: 8 }}>
                <BlockStack gap="0">
                  {item.items.map((sub, i) => {
                    const isSubExpanded = expandedSubId === sub.id;

                    if (isSubExpanded) {
                      return (
                        <div key={sub.id} style={{ paddingLeft: 20 }}>
                          <ExpandedForm
                            item={sub}
                            depth={1}
                            expandedSubId={null}
                            onChange={(u) => handleSubChange(i, u)}
                            onDelete={() => handleSubDelete(i)}
                            onToggle={() => onToggleSub(null)}
                            onToggleSub={() => {}}
                            onSubDragStart={() => {}}
                            onSubDragEnd={() => {}}
                            onSubDragOver={() => {}}
                            onSubDragLeave={() => {}}
                            onSubDrop={() => {}}
                            dragOverSubId={null}
                            dragSubPosition={null}
                          />
                        </div>
                      );
                    }

                    return (
                      <div key={sub.id} style={{ paddingLeft: 20 }}>
                        <ItemRow
                          item={sub}
                          depth={1}
                          isExpanded={false}
                          isDragOver={dragOverSubId === sub.id}
                          dragPosition={dragSubPosition ?? undefined}
                          onToggle={() => onToggleSub(sub.id)}
                          onDelete={() => handleSubDelete(i)}
                          onDragStart={(e) => onSubDragStart(e, i)}
                          onDragEnd={onSubDragEnd}
                          onDragOver={(e) => onSubDragOver(e, i)}
                          onDragLeave={onSubDragLeave}
                          onDrop={(e) => onSubDrop(e, i)}
                        />
                      </div>
                    );
                  })}
                </BlockStack>
              </div>
            </div>
          )}
        </BlockStack>
      </div>
    </div>
  );
}

// ---- Main page ----

export default function MenuEditor() {
  const { menu, scheduledDeploys } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [items, setItems] = useState<MenuItem[]>(menu.items);
  const [menuTitle, setMenuTitle] = useState(menu.title);
  const [savedItems, setSavedItems] = useState<string>(JSON.stringify(menu.items));
  const [savedTitle, setSavedTitle] = useState(menu.title);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);

  // Drag state for top-level items
  const dragRef = useRef<{ fromIndex: number } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<"above" | "below" | null>(null);

  // Drag state for sub-items (per expanded parent)
  const subDragRef = useRef<{ parentId: string; fromIndex: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragSubPosition, setDragSubPosition] = useState<"above" | "below" | null>(null);

  const isSubmitting = navigation.state === "submitting";
  const prevActionRef = useRef<string>("");

  // Dirty check
  const isDirty = menuTitle !== savedTitle || JSON.stringify(items) !== savedItems;

  // Show/hide save bar
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show("menu-save-bar");
    } else {
      shopify.saveBar.hide("menu-save-bar");
    }
  }, [isDirty, shopify]);

  // Toast on action
  useEffect(() => {
    if (!actionData) return;
    const key = JSON.stringify(actionData);
    if (key === prevActionRef.current) return;
    prevActionRef.current = key;

    if (actionData.success) {
      if (actionData.intent === "deploy") {
        shopify.toast.show("Deployed to store!");
        setSavedItems(JSON.stringify(items));
        setSavedTitle(menuTitle);
      }
      if (actionData.intent === "save_draft") {
        shopify.toast.show("Draft saved!");
        setSavedItems(JSON.stringify(items));
        setSavedTitle(menuTitle);
      }
      if (actionData.intent === "schedule") {
        shopify.toast.show("Deploy scheduled!");
        setShowSchedule(false);
        setScheduleDate("");
      }
      if (actionData.intent === "cancel_schedule") {
        shopify.toast.show("Schedule cancelled.");
      }
    }
  }, [actionData, shopify, items, menuTitle]);

  const handleDiscard = useCallback(() => {
    setItems(JSON.parse(savedItems));
    setMenuTitle(savedTitle);
    setExpandedId(null);
    setExpandedSubId(null);
  }, [savedItems, savedTitle]);

  const handleChange = useCallback((index: number, updated: MenuItem) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  const handleDelete = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setExpandedId(null);
  }, []);

  const handleAddItem = useCallback(() => {
    const newItem = emptyItem();
    setItems((prev) => [...prev, newItem]);
    setExpandedId(newItem.id);
    setExpandedSubId(null);
  }, []);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setExpandedSubId(null);
  }, []);

  // ---- Top-level drag handlers ----

  const handleTopDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragRef.current = { fromIndex: index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    // Close any expanded items during drag
    setExpandedId(null);
    setExpandedSubId(null);
  }, []);

  const handleTopDragEnd = useCallback(() => {
    dragRef.current = null;
    setDragOverId(null);
    setDragPosition(null);
  }, []);

  const handleTopDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (!dragRef.current) return;
    if (dragRef.current.fromIndex === index) return;
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "above" : "below";

    setDragOverId(items[index]?.id ?? null);
    setDragPosition(pos);
  }, [items]);

  const handleTopDragLeave = useCallback(() => {
    setDragOverId(null);
    setDragPosition(null);
  }, []);

  const handleTopDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (!dragRef.current) return;

    const fromIndex = dragRef.current.fromIndex;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dropBelow = e.clientY >= midY;

    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      let insertAt = dropBelow ? toIndex : toIndex;
      // Adjust if moving downward
      if (fromIndex < toIndex) {
        insertAt = dropBelow ? toIndex : toIndex - 1;
      } else {
        insertAt = dropBelow ? toIndex + 1 : toIndex;
      }
      insertAt = Math.max(0, Math.min(next.length, insertAt));
      next.splice(insertAt, 0, moved);
      return next;
    });

    dragRef.current = null;
    setDragOverId(null);
    setDragPosition(null);
  }, []);

  // ---- Sub-item drag handlers ----

  const handleSubDragStart = useCallback((parentId: string, e: React.DragEvent, index: number) => {
    subDragRef.current = { parentId, fromIndex: index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    setExpandedSubId(null);
  }, []);

  const handleSubDragEnd = useCallback(() => {
    subDragRef.current = null;
    setDragOverSubId(null);
    setDragSubPosition(null);
  }, []);

  const handleSubDragOver = useCallback((e: React.DragEvent, subIndex: number, parentItems: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (!subDragRef.current) return;
    if (subDragRef.current.fromIndex === subIndex) return;
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "above" : "below";

    setDragOverSubId(parentItems[subIndex]?.id ?? null);
    setDragSubPosition(pos);
  }, []);

  const handleSubDragLeave = useCallback(() => {
    setDragOverSubId(null);
    setDragSubPosition(null);
  }, []);

  const handleSubDrop = useCallback((e: React.DragEvent, toIndex: number, parentIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!subDragRef.current) return;

    const fromIndex = subDragRef.current.fromIndex;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dropBelow = e.clientY >= midY;

    setItems((prev) => {
      const next = [...prev];
      const parent = { ...next[parentIndex], items: [...next[parentIndex].items] };
      const [moved] = parent.items.splice(fromIndex, 1);
      let insertAt: number;
      if (fromIndex < toIndex) {
        insertAt = dropBelow ? toIndex : toIndex - 1;
      } else {
        insertAt = dropBelow ? toIndex + 1 : toIndex;
      }
      insertAt = Math.max(0, Math.min(parent.items.length, insertAt));
      parent.items.splice(insertAt, 0, moved);
      next[parentIndex] = parent;
      return next;
    });

    subDragRef.current = null;
    setDragOverSubId(null);
    setDragSubPosition(null);
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

  const totalItemCount = items.reduce(
    (acc, item) => acc + 1 + (item.items?.length ?? 0),
    0,
  );

  const errors =
    actionData && !actionData.success
      ? (actionData as { errors?: { field: string; message: string }[] }).errors ?? []
      : [];

  return (
    <Page backAction={{ url: "/app/menus" }} title={menuTitle} subtitle={`Handle: /${menu.handle}`}>
      <style>{`
        @keyframes menuItemExpand {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <TitleBar title={menuTitle} />
      <SaveBar id="menu-save-bar">
        <button
          // @ts-ignore
          variant="primary"
          onClick={() => handleSubmit("deploy")}
          disabled={isSubmitting}
        >
          Deploy
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

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

            <Card padding="0">
              <Box paddingBlock="300" paddingInline="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Menu Items
                  </Text>
                  <Badge tone="info">{`${totalItemCount} items`}</Badge>
                </InlineStack>
              </Box>
              <Divider />

              {items.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="300" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No items yet. Add your first menu item.
                    </Text>
                    <Button variant="primary" onClick={handleAddItem}>
                      + Add menu item
                    </Button>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ padding: "12px" }}>
                  <BlockStack gap="0">
                    {items.map((item, index) => {
                      const isExpanded = expandedId === item.id;

                      if (isExpanded) {
                        return (
                          <ExpandedForm
                            key={item.id}
                            item={item}
                            depth={0}
                            expandedSubId={expandedSubId}
                            onChange={(u) => handleChange(index, u)}
                            onDelete={() => handleDelete(index)}
                            onToggle={() => handleToggle(item.id)}
                            onToggleSub={setExpandedSubId}
                            onSubDragStart={(e, i) => handleSubDragStart(item.id, e, i)}
                            onSubDragEnd={handleSubDragEnd}
                            onSubDragOver={(e, i) => handleSubDragOver(e, i, item.items)}
                            onSubDragLeave={handleSubDragLeave}
                            onSubDrop={(e, i) => handleSubDrop(e, i, index)}
                            dragOverSubId={dragOverSubId}
                            dragSubPosition={dragSubPosition}
                          />
                        );
                      }

                      return (
                        <div key={item.id}>
                          <ItemRow
                            item={item}
                            depth={0}
                            isExpanded={false}
                            isDragOver={dragOverId === item.id}
                            dragPosition={dragPosition ?? undefined}
                            onToggle={() => handleToggle(item.id)}
                            onDelete={() => handleDelete(index)}
                            onDragStart={(e) => handleTopDragStart(e, index)}
                            onDragEnd={handleTopDragEnd}
                            onDragOver={(e) => handleTopDragOver(e, index)}
                            onDragLeave={handleTopDragLeave}
                            onDrop={(e) => handleTopDrop(e, index)}
                          />
                          {/* Show sub-items as collapsed under parent */}
                          {item.items.length > 0 && (
                            <div style={{ paddingLeft: 20 }}>
                              {item.items.map((sub) => (
                                <ItemRow
                                  key={sub.id}
                                  item={sub}
                                  depth={1}
                                  isExpanded={false}
                                  onToggle={() => {
                                    setExpandedId(item.id);
                                    setExpandedSubId(sub.id);
                                  }}
                                  onDelete={() => {
                                    const next = item.items.filter((s) => s.id !== sub.id);
                                    handleChange(index, { ...item, items: next });
                                  }}
                                  onDragStart={() => {}}
                                  onDragEnd={() => {}}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDragLeave={() => {}}
                                  onDrop={(e) => e.preventDefault()}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </BlockStack>

                  <div style={{ padding: "12px 0 4px" }}>
                    <Button variant="primary" onClick={handleAddItem}>
                      + Add menu item
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Live Tree Preview */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 3h12M2 8h8M4 13h6" stroke="#2C6ECB" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="13" cy="8" r="1.5" fill="#2C6ECB" />
                    <circle cx="13" cy="13" r="1.5" fill="#2C6ECB" />
                  </svg>
                  <Text as="h2" variant="headingMd">
                    Tree Preview
                  </Text>
                </InlineStack>
                <div
                  style={{
                    background: "#FAFAFA",
                    border: "1px solid #E1E3E5",
                    borderRadius: 8,
                    padding: "10px 12px",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  <TreePreview items={items} menuTitle={menuTitle} />
                </div>
              </BlockStack>
            </Card>

            {/* Menu Info */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Menu Info
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">Handle</Text>
                  <Text as="span">/{menu.handle}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">Items</Text>
                  <Text as="span">{totalItemCount}</Text>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Changes apply to the store only after "Deploy". Use "Save Draft" to keep changes without publishing.
                </Text>
              </BlockStack>
            </Card>

            {/* Scheduled Publishing */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{ display: "flex", color: "#8C6B2E" }}>
                    <Icon source={ClockIcon} />
                  </div>
                  <Text as="h2" variant="headingMd">
                    Schedule Deploy
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Plan menu changes for a future date. Perfect for sales events, seasonal updates, or launches.
                </Text>

                {/* Pending schedules */}
                {scheduledDeploys.length > 0 && (
                  <BlockStack gap="200">
                    {scheduledDeploys.map((sd) => (
                      <div
                        key={sd.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          background: "#FFF8E6",
                          border: "1px solid #FFCC47",
                          borderRadius: 8,
                          padding: "8px 12px",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <div style={{ display: "flex", color: "#8C6B2E" }}>
                              <Icon source={CalendarIcon} />
                            </div>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {new Date(sd.scheduledAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Text>
                          </div>
                        </div>
                        <Button
                          size="slim"
                          tone="critical"
                          variant="plain"
                          onClick={() => {
                            const fd = new FormData();
                            fd.append("intent", "cancel_schedule");
                            fd.append("scheduleId", sd.id);
                            fd.append("menuTitle", menuTitle);
                            fd.append("menuHandle", menu.handle);
                            fd.append("items", JSON.stringify(items));
                            submit(fd, { method: "post" });
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ))}
                  </BlockStack>
                )}

                {!showSchedule ? (
                  <Button
                    fullWidth
                    onClick={() => setShowSchedule(true)}
                    icon={CalendarIcon}
                  >
                    Schedule a Deploy
                  </Button>
                ) : (
                  <BlockStack gap="200">
                    <TextField
                      label="Deploy date & time"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={setScheduleDate}
                      autoComplete="off"
                      min={new Date().toISOString().slice(0, 16)}
                    />
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        loading={isSubmitting}
                        disabled={!scheduleDate}
                        onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "schedule");
                          fd.append("menuTitle", menuTitle);
                          fd.append("menuHandle", menu.handle);
                          fd.append("items", JSON.stringify(items));
                          fd.append("scheduledAt", scheduleDate);
                          submit(fd, { method: "post" });
                        }}
                      >
                        Confirm
                      </Button>
                      <Button onClick={() => { setShowSchedule(false); setScheduleDate(""); }}>
                        Cancel
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Drafts */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Drafts
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Save a snapshot without deploying to your live store.
                </Text>
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
      <Box paddingBlockEnd="1600" />
    </Page>
  );
}
