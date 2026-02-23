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
  Select,
  Icon,
  Tooltip,
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

// ---- Menu Item Types ----

const MENU_ITEM_TYPES = [
  { value: "HTTP", label: "Custom URL" },
  { value: "FRONTPAGE", label: "Home" },
  { value: "CATALOG", label: "All Products" },
  { value: "SEARCH", label: "Search" },
  { value: "COLLECTION", label: "Collection" },
  { value: "PRODUCT", label: "Product" },
  { value: "PAGE", label: "Page" },
  { value: "BLOG", label: "Blog" },
  { value: "ARTICLE", label: "Article" },
];

const TYPE_LABELS: Record<string, string> = {};
for (const t of MENU_ITEM_TYPES) TYPE_LABELS[t.value] = t.label;

const AUTO_TYPES = ["FRONTPAGE", "CATALOG", "SEARCH"];
const URL_TYPES = ["HTTP", "FRONTEND_PAGE"];

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

    if (URL_TYPES.includes(item.type)) {
      input.url = item.url;
    } else if (AUTO_TYPES.includes(item.type)) {
      // Auto types don't need url or resourceId
    } else if (item.url) {
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
      items: normalizeItems(menu.items),
    } as MenuData,
    scheduledDeploys: scheduledDeploys.map((d) => ({
      id: d.id,
      scheduledAt: d.scheduledAt.toISOString(),
      menuTitle: d.menuTitle,
    })),
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
  const typeLabel = TYPE_LABELS[item.type] || item.type;
  const isAuto = AUTO_TYPES.includes(item.type);

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
        {isAuto && (
          <span
            style={{
              fontSize: 9,
              background: "#E4E5E7",
              color: "#6D7175",
              padding: "1px 4px",
              borderRadius: 3,
              whiteSpace: "nowrap",
            }}
          >
            {typeLabel}
          </span>
        )}
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
  onToggle: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const typeLabel = TYPE_LABELS[item.type] || item.type;
  const title = item.title || "(Untitled)";
  const isEmpty = !item.title;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      {/* Drop indicator line - only show above */}
      {isDragOver && (
        <div
          style={{
            position: "absolute",
            top: dragPosition === "above" ? -1 : undefined,
            bottom: dragPosition === "below" ? -1 : undefined,
            left: depth > 0 ? 44 : 12,
            right: 12,
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
          background: isExpanded ? "#F6F6F7" : "transparent",
          borderRadius: 8,
          transition: "background 0.1s ease",
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = "#FAFAFA";
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = "transparent";
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
        <div style={{ flexShrink: 0 }}>
          <Badge>{typeLabel}</Badge>
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
  const isAutoType = AUTO_TYPES.includes(item.type);
  const showUrlField = URL_TYPES.includes(item.type) || (!isAutoType && !item.resourceId);

  const handleTypeChange = useCallback(
    (val: string) => {
      const updated: MenuItem = { ...item, type: val };
      if (AUTO_TYPES.includes(val)) {
        updated.url = "";
        updated.resourceId = null;
      } else if (URL_TYPES.includes(val)) {
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
    <div
      style={{
        border: "1px solid #E1E3E5",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header row */}
      <ItemRow
        item={item}
        depth={0}
        isExpanded={true}
        onToggle={onToggle}
        onDelete={onDelete}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {}}
        onDrop={(e) => e.preventDefault()}
      />

      {/* Form */}
      <div style={{ borderTop: "1px solid #E1E3E5", padding: 16 }}>
        <BlockStack gap="300">
          {/* Title */}
          <TextField
            label="Title"
            value={item.title}
            onChange={(val) => onChange({ ...item, title: val })}
            autoComplete="off"
          />

          {/* Type + URL/Resource */}
          <InlineStack gap="300" blockAlign="end">
            <div style={{ minWidth: 160 }}>
              <Select
                label="Type"
                options={MENU_ITEM_TYPES}
                value={item.type}
                onChange={handleTypeChange}
              />
            </div>
            {showUrlField && (
              <div style={{ flex: 1 }}>
                <TextField
                  label="URL"
                  value={item.url}
                  onChange={(val) => onChange({ ...item, url: val })}
                  autoComplete="off"
                  placeholder="https://"
                />
              </div>
            )}
            {!showUrlField && item.resourceId && (
              <div style={{ flex: 1 }}>
                <TextField
                  label="Linked resource"
                  value={item.resourceId}
                  disabled
                  autoComplete="off"
                />
              </div>
            )}
            {isAutoType && !item.resourceId && (
              <div style={{ flex: 1, paddingTop: 24 }}>
                <Text as="p" variant="bodySm" tone="subdued">
                  This link is set automatically.
                </Text>
              </div>
            )}
          </InlineStack>

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
                  <Badge tone="info">{String(totalItemCount)} items</Badge>
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
                <div style={{ padding: "8px 12px" }}>
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

                  <div style={{ padding: "8px 0 4px" }}>
                    <Button onClick={handleAddItem} icon={
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    }>
                      Add menu item
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
