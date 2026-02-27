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
  Checkbox,
} from "@shopify/polaris";
import { DeleteIcon, DragHandleIcon, DuplicateIcon, CalendarIcon, ClockIcon, CollectionIcon, ProductIcon, PageIcon, LinkIcon } from "@shopify/polaris-icons";
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
  badge: string | null;
  openInNewTab: boolean;
  collectionTags: string;
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

type ShopifyResource = {
  id: string;
  handle: string;
  title: string;
  resourceType: "COLLECTION" | "PRODUCT" | "PAGE" | "HTTP";
  url?: string;
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

const GET_RESOURCES_QUERY = `#graphql
  query GetShopifyResources {
    collections(first: 50, sortKey: TITLE) {
      edges { node { id handle title } }
    }
    products(first: 50, sortKey: TITLE) {
      edges { node { id handle title } }
    }
    pages(first: 50) {
      edges { node { id handle title } }
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
  badge: string | null;
  openInNewTab: boolean;
  collectionTags: string;
};

const BADGE_OPTIONS = [
  { value: "NEW",     label: "New",     bg: "#E3F4E8", text: "#1B7B3D" },
  { value: "SALE",    label: "Sale",    bg: "#FCEAE8", text: "#D72C0D" },
  { value: "HOT",     label: "Hot",     bg: "#FFF3E0", text: "#B45309" },
  { value: "POPULAR", label: "Popular", bg: "#E8F0FE", text: "#2C6ECB" },
  { value: "LIMITED", label: "Limited", bg: "#F3E8FF", text: "#7C3AED" },
] as const;

const BADGE_MAP: Record<string, { bg: string; text: string }> = Object.fromEntries(
  BADGE_OPTIONS.map((o) => [o.value, { bg: o.bg, text: o.text }]),
);

const MAX_NESTING_DEPTH = 2;

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
      badge: meta.badge || null,
      openInNewTab: meta.openInNewTab || false,
      collectionTags: meta.collectionTags || "",
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
  return { id: newId(), title: "", url: "", type: "HTTP", resourceId: null, handle: "", seoKeywords: "", metaDescription: "", badge: null, openInNewTab: false, collectionTags: "", items: [] };
}

function deepCloneItem(item: MenuItem): MenuItem {
  return { ...item, id: newId(), items: item.items.map(deepCloneItem) };
}

function countItemsRecursive(items: MenuItem[]): number {
  return items.reduce((acc, item) => acc + 1 + countItemsRecursive(item.items ?? []), 0);
}

function removeNestedItemById(item: MenuItem, targetId: string): MenuItem {
  return {
    ...item,
    items: item.items
      .filter((child) => child.id !== targetId)
      .map((child) => removeNestedItemById(child, targetId)),
  };
}

// ---- Loader ----

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
  const { admin, session } = await authenticate.admin(request);
  const menuGid = `gid://shopify/Menu/${params.menuId}`;

  const [menuResponse, resourcesResponse] = await Promise.all([
    admin.graphql(GET_MENU_QUERY, { variables: { id: menuGid } }),
    admin.graphql(GET_RESOURCES_QUERY),
  ]);
  const data = await menuResponse.json();
  const resourcesData = await resourcesResponse.json();

  if (!data.data?.menu) {
    throw new Response("Menu not found", { status: 404 });
  }

  const menu = data.data.menu;

  // Load saved metadata for this menu's items
  const menuMeta = await prisma.menuMeta.findUnique({
    where: { shop_menuGid: { shop: session.shop, menuGid } },
  });
  const metaMap: Record<string, ItemMeta> = menuMeta?.data ? JSON.parse(menuMeta.data) : {};

  const scheduledDeploys = isPremium
    ? await prisma.scheduledDeploy.findMany({
        where: { shop: session.shop, menuGid, status: "pending" },
        orderBy: { scheduledAt: "asc" },
      })
    : [];

  const snapshots = isPremium
    ? await prisma.menuSnapshot.findMany({
        where: { shop: session.shop, menuGid },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  const collections: ShopifyResource[] = (resourcesData.data?.collections?.edges ?? []).map(
    ({ node }: any) => ({ id: node.id, handle: node.handle, title: node.title, resourceType: "COLLECTION" as const }),
  );
  const products: ShopifyResource[] = (resourcesData.data?.products?.edges ?? []).map(
    ({ node }: any) => ({ id: node.id, handle: node.handle, title: node.title, resourceType: "PRODUCT" as const }),
  );
  const pages: ShopifyResource[] = (resourcesData.data?.pages?.edges ?? []).map(
    ({ node }: any) => ({ id: node.id, handle: node.handle, title: node.title, resourceType: "PAGE" as const }),
  );

  return {
    isPremium,
    menu: {
      ...menu,
      items: normalizeItems(menu.items, metaMap),
    } as MenuData,
    scheduledDeploys: scheduledDeploys.map((d) => ({
      id: d.id,
      scheduledAt: d.scheduledAt.toISOString(),
      menuTitle: d.menuTitle,
    })),
    snapshots: snapshots.map((s) => ({
      id: s.id,
      note: s.note,
      menuTitle: s.menuTitle,
      createdAt: s.createdAt.toISOString(),
      data: s.data,
    })),
    collections,
    products,
    pages,
  };
};

// ---- Action ----

function extractMetaMap(items: MenuItem[]): Record<string, ItemMeta> {
  const map: Record<string, ItemMeta> = {};
  for (const item of items) {
    if (item.handle || item.seoKeywords || item.metaDescription || item.badge || item.openInNewTab || item.collectionTags) {
      map[item.id] = {
        handle: item.handle || "",
        seoKeywords: item.seoKeywords || "",
        metaDescription: item.metaDescription || "",
        badge: item.badge || null,
        openInNewTab: item.openInNewTab || false,
        collectionTags: item.collectionTags || "",
      };
    }
    if (item.items?.length) {
      Object.assign(map, extractMetaMap(item.items));
    }
  }
  return map;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { isPremium } = await (await import("../utils/billing.server")).getShopPlan(request);
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
    if (!isPremium) return { success: false, intent: "save_draft", error: "plan_limit" };
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
    if (!isPremium) return { success: false, intent: "schedule", error: "plan_limit" };
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

  if (intent === "delete_snapshot") {
    if (!isPremium) return { success: false, intent: "delete_snapshot", error: "plan_limit" };
    const snapshotId = formData.get("snapshotId") as string;
    await prisma.menuSnapshot.delete({ where: { id: snapshotId } });
    return { success: true, intent: "delete_snapshot" };
  }

  if (intent === "cancel_schedule") {
    if (!isPremium) return { success: false, intent: "cancel_schedule", error: "plan_limit" };
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

    // Fire deploy webhooks (fire-and-forget, don't block deploy response)
    const webhooks = await prisma.webhookConfig.findMany({
      where: { shop: session.shop },
    });
    if (webhooks.length > 0) {
      const payload = JSON.stringify({
        shop: session.shop,
        menuId: menuGid,
        menuTitle,
        menuHandle,
        deployedAt: new Date().toISOString(),
      });
      Promise.allSettled(
        webhooks.map((wh) =>
          fetch(wh.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(10000),
          }).catch(() => {}),
        ),
      );
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
        {item.badge && (() => {
          const bc = BADGE_MAP[item.badge] ?? { bg: "#F1F1F1", text: "#616161" };
          return (
            <span
              style={{
                fontSize: 9,
                background: bc.bg,
                color: bc.text,
                padding: "1px 4px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                fontWeight: 700,
              }}
            >
              {item.badge}
            </span>
          );
        })()}
      </div>
      {hasChildren &&
        item.items.map((child, ci) => (
          <TreeNode key={child.id} item={child} isLast={ci === item.items.length - 1} depth={depth + 1} />
        ))}
    </div>
  );
}

// ---- Snapshot Diff ----

type DiffStatus = "added" | "removed" | "changed" | "unchanged";

type DiffEntry = {
  title: string;
  status: DiffStatus;
  details: string[];
  children: DiffEntry[];
};

function diffMenuItems(oldItems: MenuItem[], newItems: MenuItem[]): DiffEntry[] {
  const result: DiffEntry[] = [];
  const newMap = new Map(newItems.map((i) => [i.title.toLowerCase().trim(), i]));
  const seen = new Set<string>();

  for (const oldItem of oldItems) {
    const key = oldItem.title.toLowerCase().trim();
    seen.add(key);
    const newItem = newMap.get(key);
    if (!newItem) {
      result.push({ title: oldItem.title, status: "removed", details: [], children: diffMenuItems(oldItem.items ?? [], []) });
    } else {
      const details: string[] = [];
      if ((oldItem.url || "") !== (newItem.url || "")) {
        details.push(`URL: "${oldItem.url || "—"}" → "${newItem.url || "—"}"`);
      }
      if (oldItem.type !== newItem.type) {
        details.push(`Type: ${oldItem.type} → ${newItem.type}`);
      }
      const children = diffMenuItems(oldItem.items ?? [], newItem.items ?? []);
      const childChanged = children.some((c) => c.status !== "unchanged");
      result.push({
        title: oldItem.title,
        status: details.length > 0 || childChanged ? "changed" : "unchanged",
        details,
        children,
      });
    }
  }

  for (const newItem of newItems) {
    const key = newItem.title.toLowerCase().trim();
    if (!seen.has(key)) {
      result.push({ title: newItem.title, status: "added", details: [], children: diffMenuItems([], newItem.items ?? []) });
    }
  }

  return result;
}

function countDiffStatus(entries: DiffEntry[], status: DiffStatus): number {
  let n = 0;
  for (const e of entries) {
    if (e.status === status) n++;
    n += countDiffStatus(e.children, status);
  }
  return n;
}

const DIFF_COLORS: Record<DiffStatus, { bg: string; text: string; prefix: string }> = {
  added:     { bg: "#E3F4E8", text: "#1B7B3D", prefix: "+" },
  removed:   { bg: "#FCEAE8", text: "#D72C0D", prefix: "−" },
  changed:   { bg: "#FFF8E6", text: "#8C6B2E", prefix: "~" },
  unchanged: { bg: "transparent", text: "#303030", prefix: " " },
};

function DiffNode({ entry, depth = 0 }: { entry: DiffEntry; depth?: number }) {
  const c = DIFF_COLORS[entry.status];
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 6,
          background: c.bg,
          marginBottom: 2,
          marginLeft: depth * 20,
        }}
      >
        <span
          style={{
            color: c.text,
            fontWeight: 700,
            fontFamily: "monospace",
            width: 14,
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          {c.prefix}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text
            as="span"
            variant="bodySm"
            fontWeight={entry.status !== "unchanged" ? "semibold" : "regular"}
          >
            <span
              style={{
                color: c.text,
                textDecoration: entry.status === "removed" ? "line-through" : undefined,
              }}
            >
              {entry.title || "(Untitled)"}
            </span>
          </Text>
          {entry.details.map((d, i) => (
            <div key={i} style={{ marginTop: 2 }}>
              <Text as="span" variant="bodySm" tone="subdued">
                {d}
              </Text>
            </div>
          ))}
        </div>
      </div>
      {entry.children.map((child, i) => (
        <DiffNode key={i} entry={child} depth={depth + 1} />
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
  onDuplicate,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  bulkMode,
  selected,
  isCollapsed,
  onCollapseToggle,
}: {
  item: MenuItem;
  depth: number;
  isExpanded: boolean;
  isDragOver?: boolean;
  dragPosition?: "above" | "below" | "child";
  noMargin?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  bulkMode?: boolean;
  selected?: boolean;
  isCollapsed?: boolean;
  onCollapseToggle?: () => void;
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
      {/* Drop indicator line */}
      {isDragOver && dragPosition !== "child" && (
        <div
          style={{
            position: "absolute",
            top: dragPosition === "above" ? -1 : undefined,
            bottom: dragPosition === "below" ? -1 : undefined,
            left: 0,
            right: 0,
            height: 2,
            background: "#2C6ECB",
            borderRadius: 1,
            zIndex: 10,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#2C6ECB",
            }}
          />
        </div>
      )}
      {/* Child drop indicator — indented line at bottom */}
      {isDragOver && dragPosition === "child" && (
        <div
          style={{
            position: "absolute",
            bottom: -1,
            left: 40,
            right: 0,
            height: 2,
            background: "#2C6ECB",
            borderRadius: 1,
            zIndex: 10,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#2C6ECB",
            }}
          />
        </div>
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
          paddingLeft: 12,
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
        {/* Bulk select checkbox */}
        {bulkMode && (
          <div
            style={{
              flexShrink: 0,
              width: 18,
              height: 18,
              border: selected ? "2px solid #2C6ECB" : "2px solid #C9CCCF",
              borderRadius: 4,
              background: selected ? "#2C6ECB" : "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.1s",
              cursor: "pointer",
            }}
          >
            {selected && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}

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

        {/* Collapse toggle chevron */}
        {depth === 0 && item.items.length > 0 && onCollapseToggle && (
          <div
            style={{ flexShrink: 0, display: "flex", cursor: "pointer", color: "#8C9196", padding: "2px" }}
            onClick={(e) => {
              e.stopPropagation();
              onCollapseToggle();
            }}
            title={isCollapsed ? "Sub-menüyü genişlet" : "Sub-menüyü daralt"}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#2C6ECB"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#8C9196"; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transition: "transform 0.15s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
              <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="span" variant="bodyMd" fontWeight={isExpanded ? "semibold" : "regular"} tone={isEmpty ? "subdued" : undefined}>
            {title}
          </Text>
        </div>
        {item.badge && (() => {
          const bc = BADGE_MAP[item.badge] ?? { bg: "#F1F1F1", text: "#616161" };
          return (
            <div
              style={{
                flexShrink: 0,
                padding: "2px 6px",
                borderRadius: 4,
                background: bc.bg,
                color: bc.text,
                fontSize: 10,
                fontWeight: 700,
                whiteSpace: "nowrap",
                letterSpacing: "0.3px",
              }}
            >
              {item.badge}
            </div>
          );
        })()}
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
        {onDuplicate && (
          <div
            style={{ flexShrink: 0, display: "flex", cursor: "pointer", color: "#8C9196" }}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#2C6ECB"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#8C9196"; }}
          >
            <Icon source={DuplicateIcon} />
          </div>
        )}
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
  initialExpandedChildId,
  onChange,
  onDelete,
  onDuplicate,
  onToggle,
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
  initialExpandedChildId?: string | null;
  onChange: (updated: MenuItem) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onToggle: () => void;
  onSubDragStart: (e: React.DragEvent, index: number) => void;
  onSubDragEnd: (e: React.DragEvent) => void;
  onSubDragOver: (e: React.DragEvent, index: number) => void;
  onSubDragLeave: (e: React.DragEvent) => void;
  onSubDrop: (e: React.DragEvent, index: number) => void;
  dragOverSubId: string | null;
  dragSubPosition: "above" | "below" | "child" | null;
}) {
  const [expandedChildId, setExpandedChildId] = useState<string | null>(initialExpandedChildId ?? null);

  useEffect(() => {
    setExpandedChildId(initialExpandedChildId ?? null);
  }, [initialExpandedChildId, item.id]);

  const handleTypeChange = useCallback(
    (val: string) => {
      const typeInfo = ALL_LINK_TYPES[val];
      const updated: MenuItem = { ...item, type: val };
      // Always clear url and resourceId when changing type
      updated.url = "";
      updated.resourceId = null;
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
    setExpandedChildId(newItem.id);
  }, [item, onChange]);

  const handleSubDuplicate = useCallback(
    (i: number) => {
      const clone = deepCloneItem(item.items[i]);
      const next = [...item.items];
      next.splice(i + 1, 0, clone);
      onChange({ ...item, items: next });
    },
    [item, onChange],
  );

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
        onDuplicate={onDuplicate}
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

          {/* Badge picker */}
          <div>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Badge <span style={{ fontWeight: 400, color: "#8C9196" }}>(optional)</span>
            </Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => onChange({ ...item, badge: null })}
                style={{
                  padding: "3px 10px",
                  borderRadius: 20,
                  border: !item.badge ? "1.5px solid #2C6ECB" : "1px solid #C9CCCF",
                  background: !item.badge ? "#E8F0FE" : "#fff",
                  color: !item.badge ? "#2C6ECB" : "#6D7175",
                  fontSize: 12,
                  fontWeight: !item.badge ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                None
              </button>
              {BADGE_OPTIONS.map((opt) => {
                const isSelected = item.badge === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ ...item, badge: isSelected ? null : opt.value })}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 20,
                      border: isSelected ? `1.5px solid ${opt.text}` : "1px solid #C9CCCF",
                      background: isSelected ? opt.bg : "#fff",
                      color: isSelected ? opt.text : "#6D7175",
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Open in New Tab */}
          <Checkbox
            label="Open in new tab"
            checked={item.openInNewTab}
            onChange={(val) => onChange({ ...item, openInNewTab: val })}
          />

          {/* Link Type Picker */}
          <LinkTypePicker value={item.type} onChange={handleTypeChange} />

          {/* Smart URL Field */}
          <SmartUrlField item={item} onChange={onChange} />

          {/* Collection tag filter — only for COLLECTION type */}
          {item.type === "COLLECTION" && (
            <TextField
              label="Filter collection by tags (optional)"
              value={item.collectionTags}
              onChange={(val) => onChange({ ...item, collectionTags: val })}
              autoComplete="off"
              placeholder="Şapkalar, mavi, yaz"
              helpText="Comma-separated tags to filter products shown in this collection"
            />
          )}

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
          {depth < MAX_NESTING_DEPTH && (
            <InlineStack align="end">
              <Button size="slim" onClick={handleAddSubItem}>
                + Add sub-item
              </Button>
            </InlineStack>
          )}

          {/* Sub-items */}
          {item.items.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <Divider />
              <div style={{ marginTop: 8 }}>
                <BlockStack gap="0">
                  {item.items.map((sub, i) => {
                    const isSubExpanded = expandedChildId === sub.id;

                    if (isSubExpanded) {
                      return (
                        <div key={sub.id} style={{ paddingLeft: 20 }}>
                          <ExpandedForm
                            item={sub}
                            depth={depth + 1}
                            onChange={(u) => handleSubChange(i, u)}
                            onDelete={() => handleSubDelete(i)}
                            onToggle={() => setExpandedChildId(null)}
                            initialExpandedChildId={null}
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
                          depth={depth + 1}
                          isExpanded={false}
                          isDragOver={depth === 0 ? dragOverSubId === sub.id : undefined}
                          dragPosition={depth === 0 ? dragSubPosition ?? undefined : undefined}
                          onToggle={() => setExpandedChildId((prev) => (prev === sub.id ? null : sub.id))}
                          onDelete={() => handleSubDelete(i)}
                          onDuplicate={() => handleSubDuplicate(i)}
                          onDragStart={(e) => {
                            if (depth === 0) onSubDragStart(e, i);
                          }}
                          onDragEnd={(e) => {
                            if (depth === 0) onSubDragEnd(e);
                          }}
                          onDragOver={(e) => {
                            if (depth === 0) onSubDragOver(e, i);
                          }}
                          onDragLeave={(e) => {
                            if (depth === 0) onSubDragLeave(e);
                          }}
                          onDrop={(e) => {
                            if (depth === 0) onSubDrop(e, i);
                          }}
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

// ---- Resource Browser ----

function ResourceItem({
  resource,
  onAdd,
  onDragStart,
}: {
  resource: ShopifyResource;
  onAdd: (resource: ShopifyResource) => void;
  onDragStart: (e: React.DragEvent, resource: ShopifyResource) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const typeColors: Record<string, { bg: string; text: string }> = {
    COLLECTION: { bg: "#E8F0FE", text: "#2C6ECB" },
    PRODUCT: { bg: "#E3F4E8", text: "#1B7B3D" },
    PAGE: { bg: "#FFF3E0", text: "#B45309" },
  };
  const colors = typeColors[resource.resourceType] || { bg: "#F1F1F1", text: "#616161" };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, resource)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "7px 12px",
        gap: 8,
        cursor: "grab",
        background: hovered ? "#F6F6F7" : "transparent",
        borderBottom: "1px solid #F1F1F1",
        transition: "background 0.1s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: hovered ? 600 : 400, color: "#303030", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {resource.title}
        </div>
        <div style={{ fontSize: 11, color: "#6D7175", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          /{resource.handle}
        </div>
      </div>
      {hovered ? (
        <button
          type="button"
          onClick={() => onAdd(resource)}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: 600,
            color: colors.text,
            background: colors.bg,
            border: `1px solid ${colors.text}30`,
            borderRadius: 4,
            cursor: "pointer",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          + Add
        </button>
      ) : (
        <div style={{ width: 42, flexShrink: 0 }} />
      )}
    </div>
  );
}

function ResourceBrowser({
  collections,
  products,
  pages,
  onAdd,
}: {
  collections: ShopifyResource[];
  products: ShopifyResource[];
  pages: ShopifyResource[];
  onAdd: (resource: ShopifyResource) => void;
}) {
  const [tab, setTab] = useState<"collections" | "products" | "pages" | "link">("collections");
  const [search, setSearch] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  const currentList = tab === "collections" ? collections : tab === "products" ? products : tab === "pages" ? pages : [];
  const filtered = search
    ? currentList.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()) || r.handle.toLowerCase().includes(search.toLowerCase()))
    : currentList;

  const handleResourceDragStart = (e: React.DragEvent, resource: ShopifyResource) => {
    e.dataTransfer.setData("application/tree-master-resource", JSON.stringify(resource));
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleAddCustomLink = () => {
    const trimTitle = customTitle.trim();
    const trimUrl = customUrl.trim();
    if (!trimTitle || !trimUrl) return;
    onAdd({ id: "", handle: slugify(trimTitle), title: trimTitle, resourceType: "HTTP", url: trimUrl });
    setCustomTitle("");
    setCustomUrl("");
  };

  const tabs = [
    { id: "collections", label: "Collections", icon: CollectionIcon, count: collections.length },
    { id: "products", label: "Products", icon: ProductIcon, count: products.length },
    { id: "pages", label: "Pages", icon: PageIcon, count: pages.length },
    { id: "link", label: "Custom Link", icon: LinkIcon, count: null },
  ] as const;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
        {/* Header */}
        <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #E1E3E5" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#303030" }}>Add to menu</div>
          <div style={{ fontSize: 11, color: "#6D7175", marginTop: 2 }}>Drag or click + to add</div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #E1E3E5" }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setSearch(""); }}
                style={{
                  flex: 1,
                  padding: "8px 2px",
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  color: active ? "#2C6ECB" : "#6D7175",
                  background: active ? "#F0F5FF" : "none",
                  border: "none",
                  borderBottom: active ? "2px solid #2C6ECB" : "2px solid transparent",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  transition: "color 0.1s, background 0.1s",
                }}
              >
                <span style={{ display: "flex", color: active ? "#2C6ECB" : "#8C9196" }}>
                  <Icon source={t.icon} />
                </span>
                <span style={{ lineHeight: 1.2 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {tab !== "link" ? (
          <div>
            {/* Search */}
            <div style={{ padding: "8px 10px" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${tab}...`}
                style={{
                  width: "100%",
                  padding: "5px 9px",
                  fontSize: 12,
                  border: "1px solid #C9CCCF",
                  borderRadius: 6,
                  outline: "none",
                  boxSizing: "border-box",
                  color: "#303030",
                }}
              />
            </div>
            {/* List */}
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "20px 16px", textAlign: "center", color: "#6D7175", fontSize: 12 }}>
                  {search ? "No results" : `No ${tab} found`}
                </div>
              ) : (
                filtered.map((resource) => (
                  <ResourceItem
                    key={resource.id}
                    resource={resource}
                    onAdd={onAdd}
                    onDragStart={handleResourceDragStart}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          /* Custom Link Form */
          <div style={{ padding: "12px 14px" }}>
            <BlockStack gap="300">
              <TextField
                label="Link text"
                value={customTitle}
                onChange={setCustomTitle}
                autoComplete="off"
                placeholder="e.g. Shop Now"
              />
              <TextField
                label="URL"
                value={customUrl}
                onChange={setCustomUrl}
                autoComplete="off"
                placeholder="https://..."
              />
              <Button
                variant="primary"
                disabled={!customTitle.trim() || !customUrl.trim()}
                onClick={handleAddCustomLink}
              >
                Add to Menu
              </Button>
            </BlockStack>
          </div>
        )}
    </div>
  );
}

// ---- Main page ----

export default function MenuEditor() {
  const { menu, scheduledDeploys, snapshots, collections, products, pages, isPremium } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [items, setItemsRaw] = useState<MenuItem[]>(menu.items);
  const [menuTitle, setMenuTitle] = useState(menu.title);
  const [menuHandle, setMenuHandle] = useState(menu.handle);
  const [savedItems, setSavedItems] = useState<string>(JSON.stringify(menu.items));
  const [savedTitle, setSavedTitle] = useState(menu.title);
  const [savedHandle, setSavedHandle] = useState(menu.handle);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(
    () => new Set(menu.items.filter((item) => item.items.length > 0).map((item) => item.id))
  );
  const [scheduleDate, setScheduleDate] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [compareSnapshot, setCompareSnapshot] = useState<{ id: string; note: string | null; menuTitle: string; createdAt: string; data: string } | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBadgeOpen, setBulkBadgeOpen] = useState(false);

  // Drag state for top-level items
  const dragRef = useRef<{ fromIndex: number } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<"above" | "below" | "child" | null>(null);

  // Drag state for sub-items (per expanded parent)
  const subDragRef = useRef<{ parentId: string; fromIndex: number } | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [dragSubPosition, setDragSubPosition] = useState<"above" | "below" | "child" | null>(null);

  // Undo stack
  const undoStack = useRef<MenuItem[][]>([]);
  const setItems = useCallback((updater: MenuItem[] | ((prev: MenuItem[]) => MenuItem[])) => {
    setItemsRaw((prev) => {
      undoStack.current = [...undoStack.current, prev].slice(-50);
      return typeof updater === "function" ? updater(prev) : updater;
    });
  }, []);

  const isSubmitting = navigation.state === "submitting";
  const prevActionRef = useRef<string>("");

  // Dirty check
  const isDirty = menuTitle !== savedTitle || menuHandle !== savedHandle || JSON.stringify(items) !== savedItems;

  // Undo (Ctrl+Z / Cmd+Z)
  const handleUndo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    setItemsRaw(snapshot);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo]);

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
        setSavedHandle(menuHandle);
      }
      if (actionData.intent === "save_draft") {
        shopify.toast.show("Draft saved!");
        setSavedItems(JSON.stringify(items));
        setSavedTitle(menuTitle);
        setSavedHandle(menuHandle);
      }
      if (actionData.intent === "schedule") {
        shopify.toast.show("Deploy scheduled!");
        setShowSchedule(false);
        setScheduleDate("");
      }
      if (actionData.intent === "cancel_schedule") {
        shopify.toast.show("Schedule cancelled.");
      }
      if (actionData.intent === "delete_snapshot") {
        shopify.toast.show("Snapshot deleted.");
      }
    }
  }, [actionData, shopify, items, menuTitle]);

  const handleDiscard = useCallback(() => {
    setItemsRaw(JSON.parse(savedItems));
    undoStack.current = [];
    setMenuTitle(savedTitle);
    setMenuHandle(savedHandle);
    setExpandedId(null);
    setExpandedSubId(null);
  }, [savedItems, savedTitle, savedHandle]);

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

  const handleAddResource = useCallback((resource: ShopifyResource, insertIndex?: number) => {
    const urlMap: Record<string, string> = {
      COLLECTION: `/collections/${resource.handle}`,
      PRODUCT: `/products/${resource.handle}`,
      PAGE: `/pages/${resource.handle}`,
    };
    const url = resource.resourceType === "HTTP" ? (resource.url || "") : (urlMap[resource.resourceType] || "");
    const newItem: MenuItem = {
      id: newId(),
      title: resource.title,
      url,
      type: resource.resourceType,
      resourceId: resource.resourceType !== "HTTP" ? resource.id : null,
      handle: resource.handle || slugify(resource.title),
      seoKeywords: "",
      metaDescription: "",
      badge: null,
      openInNewTab: false,
      collectionTags: "",
      items: [],
    };
    setItems((prev) => {
      if (insertIndex !== undefined) {
        const next = [...prev];
        next.splice(Math.max(0, Math.min(next.length, insertIndex)), 0, newItem);
        return next;
      }
      return [...prev, newItem];
    });
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

  const handleDuplicate = useCallback((index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const clone = deepCloneItem(next[index]);
      next.splice(index + 1, 0, clone);
      return next;
    });
  }, []);

  const handleRestore = useCallback((data: string) => {
    const parsed = JSON.parse(data) as MenuItem[];
    setItemsRaw(parsed);
    undoStack.current = [];
    setExpandedId(null);
    setExpandedSubId(null);
    shopify.toast.show("Snapshot restored!");
  }, [shopify]);

  const handleDeleteSnapshot = useCallback((snapshotId: string) => {
    const fd = new FormData();
    fd.append("intent", "delete_snapshot");
    fd.append("snapshotId", snapshotId);
    fd.append("menuTitle", menuTitle);
    fd.append("menuHandle", menuHandle);
    fd.append("items", JSON.stringify(items));
    submit(fd, { method: "post" });
  }, [menuTitle, menuHandle, items, submit]);

  const handleSaveDraft = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "save_draft");
    fd.append("menuTitle", menuTitle);
    fd.append("menuHandle", menuHandle);
    fd.append("items", JSON.stringify(items));
    if (draftNote.trim()) fd.append("note", draftNote.trim());
    submit(fd, { method: "post" });
    setDraftNote("");
  }, [menuTitle, menuHandle, items, draftNote, submit]);

  // ---- Bulk edit handlers ----

  const handleBulkDelete = useCallback(() => {
    setItems((prev) =>
      prev
        .filter((item) => !selectedIds.has(item.id))
        .map((item) => ({
          ...item,
          items: item.items
            .filter((sub) => !selectedIds.has(sub.id))
            .map((sub) => ({
              ...sub,
              items: (sub.items ?? []).filter((nested) => !selectedIds.has(nested.id)),
            })),
        }))
    );
    setSelectedIds(new Set());
    setBulkMode(false);
    setExpandedId(null);
  }, [selectedIds]);

  const handleBulkSetBadge = useCallback((badge: string | null) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...(selectedIds.has(item.id) ? { ...item, badge } : item),
        items: item.items.map((sub) =>
          selectedIds.has(sub.id) ? { ...sub, badge } : sub,
        ),
      }))
    );
    setSelectedIds(new Set());
    setBulkBadgeOpen(false);
    setBulkMode(false);
  }, [selectedIds]);

  const toggleBulkMode = useCallback(() => {
    setBulkMode((v) => !v);
    setSelectedIds(new Set());
    setExpandedId(null);
    setExpandedSubId(null);
  }, []);

  const toggleItemSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    const isResourceDrag = e.dataTransfer.types.includes("application/tree-master-resource");
    const isSubDrag = !!subDragRef.current;
    if (!dragRef.current && !isResourceDrag && !isSubDrag) return;
    if (dragRef.current?.fromIndex === index) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isResourceDrag ? "copy" : "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    const relativeX = e.clientX - rect.left;

    // Sub-item being dragged: right 40% = child drop, left 60% = above/below (promote to root)
    if (isSubDrag) {
      const isChildDrop = relativeX > rect.width * 0.6;
      setDragOverId(items[index]?.id ?? null);
      setDragPosition(isChildDrop ? "child" : e.clientY < midY ? "above" : "below");
      return;
    }
    const isChildDrop = !isResourceDrag && relativeX > rect.width * 0.05;

    if (isChildDrop) {
      setDragOverId(items[index]?.id ?? null);
      setDragPosition("child");
    } else {
      setDragOverId(items[index]?.id ?? null);
      setDragPosition(e.clientY < midY ? "above" : "below");
    }
  }, [items]);

  const handleTopDragLeave = useCallback(() => {
    setDragOverId(null);
    setDragPosition(null);
  }, []);

  const handleTopDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    setDragOverId(null);
    setDragPosition(null);

    // Resource drop from left panel
    const resourceData = e.dataTransfer.getData("application/tree-master-resource");
    if (resourceData) {
      e.stopPropagation();
      try {
        const resource = JSON.parse(resourceData) as ShopifyResource;
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertIndex = e.clientY >= midY ? toIndex + 1 : toIndex;
        handleAddResource(resource, insertIndex);
      } catch (_) {}
      return;
    }

    // Sub-item drag: extract from parent, insert as top-level or as child of target
    if (subDragRef.current) {
      const { parentId, fromIndex: subFromIndex } = subDragRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      const isChildDrop = relativeX > rect.width * 0.6;
      const insertBelow = e.clientY >= rect.top + rect.height / 2;
      setItems((prev) => {
        const parentIndex = prev.findIndex((it) => it.id === parentId);
        if (parentIndex === -1) return prev;
        const extracted = prev[parentIndex].items[subFromIndex];
        if (!extracted) return prev;
        const withoutSub = prev.map((it, i) =>
          i === parentIndex ? { ...it, items: it.items.filter((_, si) => si !== subFromIndex) } : it
        );
        if (isChildDrop) {
          // Add as child of target item
          const adjustedIndex = parentIndex < toIndex ? toIndex - 1 : toIndex;
          const target = withoutSub[adjustedIndex];
          if (!target || target.id === parentId) return withoutSub;
          const result = [...withoutSub];
          result[adjustedIndex] = { ...target, items: [...(target.items ?? []), extracted] };
          return result;
        }
        const insertAt = Math.min(withoutSub.length, insertBelow ? toIndex + 1 : toIndex);
        const result = [...withoutSub];
        result.splice(insertAt, 0, extracted);
        return result;
      });
      subDragRef.current = null;
      return;
    }

    if (!dragRef.current) return;
    const fromIndex = dragRef.current.fromIndex;
    const rect = e.currentTarget.getBoundingClientRect();

    // Check if this is a "make child" drop (dragged far enough to the right)
    const relativeX = e.clientX - rect.left;
    const isChildDrop = relativeX > rect.width * 0.05 && fromIndex !== toIndex;

    if (isChildDrop) {
      setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        const target = next[adjustedIndex];
        if (!target) return next;
        next[adjustedIndex] = { ...target, items: [...(target.items ?? []), moved] };
        return next;
      });
      dragRef.current = null;
      return;
    }

    const midY = rect.top + rect.height / 2;
    const dropBelow = e.clientY >= midY;

    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      let insertAt: number;
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
  }, [handleAddResource]);

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

  const handleSubDrop = useCallback((e: React.DragEvent, toIndex: number, targetParentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!subDragRef.current) return;

    const { parentId: sourceParentId, fromIndex } = subDragRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const dropBelow = e.clientY >= midY;

    setItems((prev) => {
      if (sourceParentId === targetParentId && fromIndex === toIndex) return prev;

      const next = [...prev];
      const sourceParentIndex = next.findIndex((it) => it.id === sourceParentId);
      if (sourceParentIndex === -1) return prev;
      const sourceParent = { ...next[sourceParentIndex], items: [...next[sourceParentIndex].items] };
      const [moved] = sourceParent.items.splice(fromIndex, 1);
      if (!moved) return prev;
      next[sourceParentIndex] = sourceParent;

      const targetParentIndex = next.findIndex((it) => it.id === targetParentId);
      if (targetParentIndex === -1) return next;
      const targetParent = { ...next[targetParentIndex], items: [...next[targetParentIndex].items] };

      let insertAt: number;
      if (sourceParentId === targetParentId && fromIndex < toIndex) {
        insertAt = dropBelow ? toIndex : toIndex - 1;
      } else if (sourceParentId === targetParentId) {
        insertAt = dropBelow ? toIndex + 1 : toIndex;
      } else {
        insertAt = dropBelow ? toIndex + 1 : toIndex;
      }
      insertAt = Math.max(0, Math.min(targetParent.items.length, insertAt));
      targetParent.items.splice(insertAt, 0, moved);
      next[targetParentIndex] = targetParent;
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
      fd.append("menuHandle", menuHandle);
      fd.append("items", JSON.stringify(items));
      submit(fd, { method: "post" });
    },
    [items, menuTitle, menuHandle, submit],
  );

  const totalItemCount = countItemsRecursive(items);

  const renderNestedSubtree = useCallback(
    (children: MenuItem[], rootItem: MenuItem, rootIndex: number, depth: number, level1ParentId?: string): JSX.Element | null => {
      if (children.length === 0) return null;

      return (
        <div style={{ position: "relative", marginLeft: 20, marginTop: 3 }}>
          {children.map((child, idx) => {
            const isLast = idx === children.length - 1;
            return (
            <div key={child.id} style={{ position: "relative", paddingLeft: 20 }}>
              {/* Per-item vertical connector: full height for non-last, row-center only for last */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  ...(isLast ? { height: 22 } : { bottom: 0 }),
                  width: 1,
                  background: "#E1E3E5",
                  borderRadius: 1,
                }}
              />
              {/* Horizontal branch at fixed row center */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 21,
                  width: 20,
                  height: 1,
                  background: "#E1E3E5",
                }}
              />
              <ItemRow
                item={child}
                depth={depth}
                isExpanded={false}
                bulkMode={bulkMode}
                selected={selectedIds.has(child.id)}
                onToggle={() => {
                  if (bulkMode) { toggleItemSelect(child.id); return; }
                  setExpandedId(rootItem.id);
                  setExpandedSubId(level1ParentId ?? null);
                }}
                onDelete={() => {
                  const updatedRoot = removeNestedItemById(rootItem, child.id);
                  handleChange(rootIndex, updatedRoot);
                }}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => {}}
                onDrop={(e) => e.preventDefault()}
              />
              {renderNestedSubtree(child.items ?? [], rootItem, rootIndex, depth + 1, level1ParentId)}
            </div>
            );
          })}
        </div>
      );
    },
    [handleChange, bulkMode, selectedIds, toggleItemSelect],
  );

  const errors =
    actionData && !actionData.success
      ? (actionData as { errors?: { field: string; message: string }[] }).errors ?? []
      : [];

  return (
    <Page backAction={{ url: "/app/menus" }} title={menuTitle} subtitle={`Handle: /${menuHandle}  ·  ${totalItemCount} items`}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>
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
              <BlockStack gap="300">
                <TextField
                  label="Menu title"
                  value={menuTitle}
                  onChange={setMenuTitle}
                  autoComplete="off"
                />
                <TextField
                  label="Menu handle"
                  value={menuHandle}
                  onChange={(val) => setMenuHandle(slugify(val))}
                  autoComplete="off"
                  prefix="/"
                  helpText="URL-friendly identifier for this menu"
                />
              </BlockStack>
            </Card>

            <Card padding="0">
              <Box paddingBlock="300" paddingInline="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Menu Items
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">{`${totalItemCount} items`}</Badge>
                    {items.length > 0 && (
                      <Button
                        size="slim"
                        variant={bulkMode ? "primary" : "plain"}
                        onClick={toggleBulkMode}
                      >
                        {bulkMode ? "Cancel" : "Select"}
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>
              </Box>
              <Divider />

              {/* Bulk action bar */}
              {bulkMode && selectedIds.size > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 14px",
                    background: "#EEF3FE",
                    borderBottom: "1px solid #C4D3F8",
                  }}
                >
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {selectedIds.size} selected
                  </Text>
                  <Button
                    size="slim"
                    onClick={() => setBulkBadgeOpen(true)}
                  >
                    Set Badge
                  </Button>
                  <Button
                    size="slim"
                    tone="critical"
                    onClick={handleBulkDelete}
                  >
                    Delete
                  </Button>
                  <Button
                    size="slim"
                    variant="plain"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Deselect all
                  </Button>
                </div>
              )}

              <div
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/tree-master-resource")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  const data = e.dataTransfer.getData("application/tree-master-resource");
                  if (data) {
                    e.preventDefault();
                    try { handleAddResource(JSON.parse(data) as ShopifyResource); } catch (_) {}
                  }
                }}
              >
              {items.length === 0 ? (
                <Box padding="600">
                  <BlockStack gap="300" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No items yet. Use the panel on the right to add collections, products, pages or custom links.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <div style={{ padding: "12px" }}>
                  <BlockStack gap="0">
                    {items.map((item, index) => {
                      const isExpanded = expandedId === item.id;

                      if (isExpanded) {
                        // If a sub-item was clicked from the flat list, show its form directly
                        if (expandedSubId) {
                          const subIdx = item.items.findIndex((s) => s.id === expandedSubId);
                          const subItem = subIdx !== -1 ? item.items[subIdx] : null;
                          if (subItem) {
                            return (
                              <ExpandedForm
                                key={expandedSubId}
                                item={subItem}
                                depth={1}
                                initialExpandedChildId={null}
                                onChange={(updated) => {
                                  const newSubs = [...item.items];
                                  newSubs[subIdx] = updated;
                                  handleChange(index, { ...item, items: newSubs });
                                }}
                                onDelete={() => {
                                  const newSubs = item.items.filter((s) => s.id !== expandedSubId);
                                  handleChange(index, { ...item, items: newSubs });
                                  setExpandedId(null);
                                  setExpandedSubId(null);
                                }}
                                onDuplicate={() => {
                                  const newSubs = [...item.items];
                                  const clone = deepCloneItem(subItem);
                                  newSubs.splice(subIdx + 1, 0, clone);
                                  handleChange(index, { ...item, items: newSubs });
                                }}
                                onToggle={() => { setExpandedId(null); setExpandedSubId(null); }}
                                onSubDragStart={() => {}}
                                onSubDragEnd={() => {}}
                                onSubDragOver={() => {}}
                                onSubDragLeave={() => {}}
                                onSubDrop={() => {}}
                                dragOverSubId={null}
                                dragSubPosition={null}
                              />
                            );
                          }
                        }

                        return (
                          <ExpandedForm
                            key={item.id}
                            item={item}
                            depth={0}
                            initialExpandedChildId={null}
                            onChange={(u) => handleChange(index, u)}
                            onDelete={() => handleDelete(index)}
                            onDuplicate={() => handleDuplicate(index)}
                            onToggle={() => handleToggle(item.id)}
                            onSubDragStart={(e, i) => handleSubDragStart(item.id, e, i)}
                            onSubDragEnd={handleSubDragEnd}
                            onSubDragOver={(e, i) => handleSubDragOver(e, i, item.items)}
                            onSubDragLeave={handleSubDragLeave}
                            onSubDrop={(e, i) => handleSubDrop(e, i, item.id)}
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
                            bulkMode={bulkMode}
                            selected={selectedIds.has(item.id)}
                            isCollapsed={collapsedParentIds.has(item.id)}
                            onCollapseToggle={() => setCollapsedParentIds(prev => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })}
                            onToggle={() => bulkMode ? toggleItemSelect(item.id) : handleToggle(item.id)}
                            onDelete={() => handleDelete(index)}
                            onDuplicate={() => handleDuplicate(index)}
                            onDragStart={(e) => handleTopDragStart(e, index)}
                            onDragEnd={handleTopDragEnd}
                            onDragOver={(e) => handleTopDragOver(e, index)}
                            onDragLeave={handleTopDragLeave}
                            onDrop={(e) => handleTopDrop(e, index)}
                          />
                          {/* Show sub-items under parent, collapsible */}
                          {item.items.length > 0 && !collapsedParentIds.has(item.id) && (
                            <div style={{ position: "relative", marginLeft: 20, marginTop: 3 }}>
                              {item.items.map((sub, si) => {
                                const isSubLast = si === item.items.length - 1;
                                return (
                                <div
                                  key={sub.id}
                                  style={{ position: "relative", paddingLeft: 20 }}
                                  onDragOver={(e) => {
                                    const isRootDrag = !!dragRef.current;
                                    const isSubDrag = !!subDragRef.current;
                                    if (!isRootDrag && !isSubDrag) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.dataTransfer.dropEffect = "move";
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const relativeX = e.clientX - rect.left;
                                    const midY = rect.top + rect.height / 2;
                                    const pos = relativeX > rect.width * 0.16 ? "child" : e.clientY < midY ? "above" : "below";

                                    if (isSubDrag) {
                                      // Avoid showing drop indicator on the dragged row itself.
                                      const sameItem = subDragRef.current?.parentId === item.id && subDragRef.current?.fromIndex === si;
                                      if (!sameItem) {
                                        setDragOverSubId(sub.id);
                                        setDragSubPosition(pos);
                                      }
                                      return;
                                    }

                                    // Root item → insert into this parent's sub-items or nest under current sub-item.
                                    setDragOverSubId(sub.id);
                                    setDragSubPosition(pos);
                                  }}
                                  onDragLeave={() => {
                                    setDragOverSubId(null);
                                    setDragSubPosition(null);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const relativeX = e.clientX - rect.left;
                                    const isChildDrop = relativeX > rect.width * 0.16;
                                    const dropBelow = e.clientY >= rect.top + rect.height / 2;
                                    if (subDragRef.current) {
                                      if (isChildDrop) {
                                        // Sub-item → child of sub-item (create one deeper level)
                                        const { parentId: sourceParentId, fromIndex } = subDragRef.current;
                                        setItems((prev) => {
                                          const sourceParentIndex = prev.findIndex((it) => it.id === sourceParentId);
                                          if (sourceParentIndex === -1) return prev;
                                          const sourceParent = prev[sourceParentIndex];
                                          const moved = sourceParent.items[fromIndex];
                                          if (!moved || moved.id === sub.id) return prev;

                                          const next = [...prev];
                                          next[sourceParentIndex] = {
                                            ...sourceParent,
                                            items: sourceParent.items.filter((_, idx) => idx !== fromIndex),
                                          };

                                          const targetParentIndex = next.findIndex((it) => it.id === item.id);
                                          if (targetParentIndex === -1) return next;
                                          const targetParent = next[targetParentIndex];
                                          const targetSubIndex = targetParent.items.findIndex((s) => s.id === sub.id);
                                          if (targetSubIndex === -1) return next;
                                          const targetSub = targetParent.items[targetSubIndex];
                                          const targetChildren = [...(targetSub.items ?? []), moved];
                                          const updatedSubs = [...targetParent.items];
                                          updatedSubs[targetSubIndex] = { ...targetSub, items: targetChildren };
                                          next[targetParentIndex] = { ...targetParent, items: updatedSubs };
                                          return next;
                                        });
                                        subDragRef.current = null;
                                        setDragOverSubId(null);
                                        setDragSubPosition(null);
                                        return;
                                      }

                                      // Sub-item reorder as sibling
                                      handleSubDrop(e, si, item.id);
                                    } else if (dragRef.current) {
                                      if (isChildDrop) {
                                        // Root item → child of this sub-item
                                        const fromIndex = dragRef.current.fromIndex;
                                        setItems((prev) => {
                                          const next = [...prev];
                                          const [moved] = next.splice(fromIndex, 1);
                                          const targetParentIndex = next.findIndex((it) => it.id === item.id);
                                          if (!moved || targetParentIndex === -1) return next;
                                          const targetParent = next[targetParentIndex];
                                          const targetSubIndex = targetParent.items.findIndex((s) => s.id === sub.id);
                                          if (targetSubIndex === -1) return next;
                                          const targetSub = targetParent.items[targetSubIndex];
                                          const targetChildren = [...(targetSub.items ?? []), moved];
                                          const updatedSubs = [...targetParent.items];
                                          updatedSubs[targetSubIndex] = { ...targetSub, items: targetChildren };
                                          next[targetParentIndex] = { ...targetParent, items: updatedSubs };
                                          return next;
                                        });
                                        dragRef.current = null;
                                        setDragOverId(null);
                                        setDragPosition(null);
                                        setDragOverSubId(null);
                                        setDragSubPosition(null);
                                        return;
                                      }

                                      // Root item → sibling among this parent's sub-items
                                      const fromIndex = dragRef.current.fromIndex;
                                      setItems((prev) => {
                                        const next = [...prev];
                                        const [moved] = next.splice(fromIndex, 1);
                                        const targetParentIndex = next.findIndex((it) => it.id === item.id);
                                        const parent = targetParentIndex !== -1 ? next[targetParentIndex] : null;
                                        if (!moved || !parent) return next;
                                        const newItems = [...(parent.items ?? [])];
                                        const targetSubIndex = newItems.findIndex((s) => s.id === sub.id);
                                        const safeInsertAt = targetSubIndex === -1 ? newItems.length : dropBelow ? targetSubIndex + 1 : targetSubIndex;
                                        const adjustedInsert = Math.min(newItems.length, safeInsertAt);
                                        newItems.splice(Math.max(0, adjustedInsert), 0, moved);
                                        next[targetParentIndex] = { ...parent, items: newItems };
                                        return next;
                                      });
                                      dragRef.current = null;
                                      setDragOverId(null);
                                      setDragPosition(null);
                                      setDragOverSubId(null);
                                      setDragSubPosition(null);
                                    }
                                  }}
                                >
                                  {/* Per-item vertical connector */}
                                  <div style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 0,
                                    ...(isSubLast ? { height: 22 } : { bottom: 0 }),
                                    width: 1,
                                    background: "#E1E3E5",
                                    borderRadius: 1,
                                  }} />
                                  {/* Horizontal branch at fixed row center */}
                                  <div style={{
                                    position: "absolute",
                                    left: 0,
                                    top: 21,
                                    width: 20,
                                    height: 1,
                                    background: "#E1E3E5",
                                  }} />
                                  <ItemRow
                                    item={sub}
                                    depth={1}
                                    isExpanded={false}
                                    isDragOver={dragOverSubId === sub.id}
                                    dragPosition={dragSubPosition ?? undefined}
                                    bulkMode={bulkMode}
                                    selected={selectedIds.has(sub.id)}
                                    onToggle={() => {
                                      if (bulkMode) { toggleItemSelect(sub.id); return; }
                                      setExpandedId(item.id);
                                      setExpandedSubId(sub.id);
                                    }}
                                    onDelete={() => {
                                      const next = item.items.filter((s) => s.id !== sub.id);
                                      handleChange(index, { ...item, items: next });
                                    }}
                                    onDragStart={(e) => handleSubDragStart(item.id, e, si)}
                                    onDragEnd={handleSubDragEnd}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDragLeave={() => {}}
                                    onDrop={(e) => e.preventDefault()}
                                  />
                                  {renderNestedSubtree(sub.items ?? [], item, index, 2, sub.id)}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </BlockStack>

                </div>
              )}
              </div>
            </Card>
          </BlockStack>
        <div style={{ position: "sticky", top: 16 }}>
        <BlockStack gap="400">
            <ResourceBrowser
              collections={collections}
              products={products}
              pages={pages}
              onAdd={handleAddResource}
            />
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


            {/* Scheduled Publishing */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ display: "flex", color: "#8C6B2E" }}>
                      <Icon source={ClockIcon} />
                    </div>
                    <Text as="h2" variant="headingMd">
                      Schedule Deploy
                    </Text>
                  </InlineStack>
                  {!isPremium && <Badge tone="warning">Premium</Badge>}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Plan menu changes for a future date. Perfect for sales events, seasonal updates, or launches.
                </Text>

                {!isPremium ? (
                  <Button fullWidth url="/app/pricing" icon={CalendarIcon}>
                    Upgrade to Schedule
                  </Button>
                ) : (
                  <>
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
                                fd.append("menuHandle", menuHandle);
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
                              fd.append("menuHandle", menuHandle);
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
                  </>
                )}
              </BlockStack>
            </Card>

            {/* History */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    History
                  </Text>
                  {!isPremium && <Badge tone="warning">Premium</Badge>}
                </InlineStack>
                {!isPremium ? (
                  <>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Save snapshots and restore previous menu versions anytime.
                    </Text>
                    <Button fullWidth url="/app/pricing">
                      Upgrade to Use History
                    </Button>
                  </>
                ) : snapshots.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No snapshots yet.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {snapshots.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          background: "#FAFAFA",
                          border: "1px solid #E1E3E5",
                          borderRadius: 8,
                          padding: "8px 12px",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text as="p" variant="bodySm" fontWeight="semibold" truncate>
                            {snapshot.note || snapshot.menuTitle}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {new Date(snapshot.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        </div>
                        <InlineStack gap="100">
                          <Button
                            size="slim"
                            onClick={() => setCompareSnapshot(snapshot)}
                          >
                            Compare
                          </Button>
                          <Button
                            size="slim"
                            onClick={() => handleRestore(snapshot.data)}
                          >
                            Restore
                          </Button>
                          <Button
                            size="slim"
                            tone="critical"
                            variant="plain"
                            onClick={() => handleDeleteSnapshot(snapshot.id)}
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </div>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
        </BlockStack>
        </div>
      </div>
      <Box paddingBlockEnd="1600" />

      {/* Bulk Badge Modal */}
      <Modal
        open={bulkBadgeOpen}
        onClose={() => setBulkBadgeOpen(false)}
        title={`Set Badge for ${selectedIds.size} item(s)`}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Choose a badge to apply to all selected items, or remove any existing badges.
            </Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={() => handleBulkSetBadge(null)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "1px solid #C9CCCF",
                  background: "#fff",
                  color: "#6D7175",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                None (remove badge)
              </button>
              {BADGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleBulkSetBadge(opt.value)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: `1.5px solid ${opt.text}`,
                    background: opt.bg,
                    color: opt.text,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Snapshot Compare Modal */}
      {compareSnapshot && (() => {
        const snapshotItems = JSON.parse(compareSnapshot.data) as MenuItem[];
        const diff = diffMenuItems(snapshotItems, items);
        const addedCount = countDiffStatus(diff, "added");
        const removedCount = countDiffStatus(diff, "removed");
        const changedCount = countDiffStatus(diff, "changed");
        const allUnchanged = addedCount === 0 && removedCount === 0 && changedCount === 0;
        return (
          <Modal
            open={!!compareSnapshot}
            onClose={() => setCompareSnapshot(null)}
            title="Snapshot vs Current"
          >
            <Modal.Section>
              <BlockStack gap="400">
                <Text as="p" variant="bodySm" tone="subdued">
                  Comparing snapshot from{" "}
                  {new Date(compareSnapshot.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {compareSnapshot.note ? ` — "${compareSnapshot.note}"` : ""} against the current editor state.
                </Text>

                <InlineStack gap="200">
                  {addedCount > 0 && <Badge tone="success">{`+${addedCount} added`}</Badge>}
                  {removedCount > 0 && <Badge tone="critical">{`−${removedCount} removed`}</Badge>}
                  {changedCount > 0 && <Badge tone="warning">{`~${changedCount} changed`}</Badge>}
                  {allUnchanged && <Badge>{"No changes"}</Badge>}
                </InlineStack>

                <div
                  style={{
                    background: "#FAFAFA",
                    border: "1px solid #E1E3E5",
                    borderRadius: 8,
                    padding: "12px",
                    maxHeight: 400,
                    overflowY: "auto",
                  }}
                >
                  {diff.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Both versions are empty.
                    </Text>
                  ) : (
                    diff.map((entry, i) => <DiffNode key={i} entry={entry} />)
                  )}
                </div>

                <InlineStack align="end" gap="200">
                  <Button onClick={() => setCompareSnapshot(null)}>Close</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      handleRestore(compareSnapshot.data);
                      setCompareSnapshot(null);
                    }}
                  >
                    Restore this Snapshot
                  </Button>
                </InlineStack>
              </BlockStack>
            </Modal.Section>
          </Modal>
        );
      })()}
    </Page>
  );
}
