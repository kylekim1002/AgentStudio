"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DOCUMENT_TEMPLATES,
  DocumentSectionKey,
  DocumentTemplate,
  TemplateCanvasItem,
  TemplateCanvasItemType,
  TemplateCanvasPage,
  normalizeDocumentTemplates,
} from "@/lib/documentTemplates";

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

const SECTION_OPTIONS: Array<{ key: DocumentSectionKey; label: string }> = [
  { key: "passage", label: "지문" },
  { key: "reading", label: "독해" },
  { key: "vocabulary", label: "어휘" },
  { key: "grammar", label: "문법" },
  { key: "writing", label: "쓰기" },
  { key: "assessment", label: "평가지" },
];

const ITEM_TYPE_OPTIONS: Array<{ value: TemplateCanvasItemType; label: string }> = [
  { value: "section", label: "섹션 블록" },
  { value: "text", label: "텍스트 블록" },
  { value: "image", label: "이미지 블록" },
];

interface ImagePromptPreset {
  id: string;
  name: string;
  prompt: string;
}

type DragMode = "move" | "resize-se" | "resize-e" | "resize-s";

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultTemplate(index: number): DocumentTemplate {
  return {
    id: `canvas-template-${Date.now()}-${index}`,
    name: `새 캔버스 템플릿 ${index}`,
    description: "",
    previewLabel: "캔버스",
    pageSize: "A4",
    layout: "canvas",
    accentColor: "#2563EB",
    visibleSections: ["passage", "reading", "assessment"],
    blocks: [],
    pages: [
      {
        id: createId("page"),
        name: "1페이지",
        items: [],
      },
    ],
  };
}

function duplicatePages(pages: TemplateCanvasPage[]) {
  return pages.map((page, pageIndex) => ({
    ...page,
    id: createId("page"),
    name: `${pageIndex + 1}페이지`,
    items: page.items.map((item) => ({
      ...item,
      id: createId("item"),
    })),
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapValue(value: number, enabled: boolean, step = 2) {
  if (!enabled) return value;
  return Math.round(value / step) * step;
}

function alignItem(item: TemplateCanvasItem, target: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") {
  switch (target) {
    case "left":
      return { x: 8 };
    case "center-x":
      return { x: clamp((PAGE_WIDTH_MM - item.w) / 2, 0, PAGE_WIDTH_MM - item.w) };
    case "right":
      return { x: clamp(PAGE_WIDTH_MM - item.w - 8, 0, PAGE_WIDTH_MM - item.w) };
    case "top":
      return { y: 8 };
    case "center-y":
      return { y: clamp((PAGE_HEIGHT_MM - item.h) / 2, 0, PAGE_HEIGHT_MM - item.h) };
    case "bottom":
      return { y: clamp(PAGE_HEIGHT_MM - item.h - 8, 0, PAGE_HEIGHT_MM - item.h) };
    default:
      return {};
  }
}

function alignSelection(items: TemplateCanvasItem[], target: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") {
  if (items.length === 0) return new Map<string, Partial<TemplateCanvasItem>>();
  const minX = Math.min(...items.map((item) => item.x));
  const maxRight = Math.max(...items.map((item) => item.x + item.w));
  const minY = Math.min(...items.map((item) => item.y));
  const maxBottom = Math.max(...items.map((item) => item.y + item.h));
  const centerX = (minX + maxRight) / 2;
  const centerY = (minY + maxBottom) / 2;

  return new Map(
    items.map((item) => {
      switch (target) {
        case "left":
          return [item.id, { x: minX }];
        case "center-x":
          return [item.id, { x: clamp(centerX - item.w / 2, 0, PAGE_WIDTH_MM - item.w) }];
        case "right":
          return [item.id, { x: clamp(maxRight - item.w, 0, PAGE_WIDTH_MM - item.w) }];
        case "top":
          return [item.id, { y: minY }];
        case "center-y":
          return [item.id, { y: clamp(centerY - item.h / 2, 0, PAGE_HEIGHT_MM - item.h) }];
        case "bottom":
          return [item.id, { y: clamp(maxBottom - item.h, 0, PAGE_HEIGHT_MM - item.h) }];
        default:
          return [item.id, {}];
      }
    })
  );
}

function distributeSelection(items: TemplateCanvasItem[], axis: "horizontal" | "vertical") {
  if (items.length < 3) return new Map<string, Partial<TemplateCanvasItem>>();
  const sorted = [...items].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const inner = sorted.slice(1, -1);
  const totalSize = sorted.reduce((sum, item) => sum + (axis === "horizontal" ? item.w : item.h), 0);
  const span =
    axis === "horizontal"
      ? last.x + last.w - first.x
      : last.y + last.h - first.y;
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor = axis === "horizontal" ? first.x + first.w + gap : first.y + first.h + gap;
  const updates = new Map<string, Partial<TemplateCanvasItem>>();

  inner.forEach((item) => {
    if (axis === "horizontal") {
      updates.set(item.id, { x: clamp(cursor, 0, PAGE_WIDTH_MM - item.w) });
      cursor += item.w + gap;
    } else {
      updates.set(item.id, { y: clamp(cursor, 0, PAGE_HEIGHT_MM - item.h) });
      cursor += item.h + gap;
    }
  });

  return updates;
}

function mmToPercentX(mm: number) {
  return (mm / PAGE_WIDTH_MM) * 100;
}

function mmToPercentY(mm: number) {
  return (mm / PAGE_HEIGHT_MM) * 100;
}

function pageSectionList(pages: TemplateCanvasPage[]) {
  return Array.from(
    new Set(
      pages.flatMap((page) =>
        page.items
          .map((item) => item.sectionKey)
          .filter((section): section is DocumentSectionKey => Boolean(section))
      )
    )
  );
}

function itemsOverlap(a: TemplateCanvasItem, b: TemplateCanvasItem) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>(DEFAULT_DOCUMENT_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(DEFAULT_DOCUMENT_TEMPLATES[0].id);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(DEFAULT_DOCUMENT_TEMPLATES[0].pages[0]?.id ?? null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [imagePrompts, setImagePrompts] = useState<ImagePromptPreset[]>([]);
  const [pastSnapshots, setPastSnapshots] = useState<DocumentTemplate[][]>([]);
  const [futureSnapshots, setFutureSnapshots] = useState<DocumentTemplate[][]>([]);
  const dragState = useRef<{
    templateId: string;
    pageId: string;
    itemId: string;
    mode: DragMode;
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const dragHistoryCapturedRef = useRef(false);

  useEffect(() => {
    fetch("/api/system-settings/document-templates")
      .then((res) => res.json())
      .then((data) => {
        const nextTemplates = normalizeDocumentTemplates(data.templates);
        setTemplates(nextTemplates);
        setSelectedTemplateId(nextTemplates[0]?.id ?? DEFAULT_DOCUMENT_TEMPLATES[0].id);
        setSelectedPageId(nextTemplates[0]?.pages[0]?.id ?? null);
      })
      .catch(() => {});

    fetch("/api/system-settings/image-prompts")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.prompts)) {
          setImagePrompts(data.prompts);
        }
      })
      .catch(() => {});
  }, []);

  function cloneTemplates(source: DocumentTemplate[]) {
    return JSON.parse(JSON.stringify(source)) as DocumentTemplate[];
  }

  function recordHistorySnapshot() {
    setPastSnapshots((prev) => [...prev.slice(-39), cloneTemplates(templates)]);
    setFutureSnapshots([]);
  }

  function restoreTemplates(nextTemplates: DocumentTemplate[]) {
    setTemplates(nextTemplates);
    const nextTemplate =
      nextTemplates.find((template) => template.id === selectedTemplateId) ?? nextTemplates[0] ?? null;
    const nextPage =
      nextTemplate?.pages.find((page) => page.id === selectedPageId) ?? nextTemplate?.pages[0] ?? null;
    const nextItem =
      nextPage?.items.find((item) => item.id === selectedItemId) ?? nextPage?.items[0] ?? null;
    setSelectedTemplateId(nextTemplate?.id ?? "");
    setSelectedPageId(nextPage?.id ?? null);
    setSelectedItemId(nextItem?.id ?? null);
  }

  function undo() {
    if (pastSnapshots.length === 0) return;
    const previous = pastSnapshots[pastSnapshots.length - 1];
    setPastSnapshots((prev) => prev.slice(0, -1));
    setFutureSnapshots((prev) => [cloneTemplates(templates), ...prev].slice(0, 40));
    restoreTemplates(cloneTemplates(previous));
  }

  function redo() {
    if (futureSnapshots.length === 0) return;
    const [next, ...rest] = futureSnapshots;
    setFutureSnapshots(rest);
    setPastSnapshots((prev) => [...prev.slice(-39), cloneTemplates(templates)]);
    restoreTemplates(cloneTemplates(next));
  }

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId, templates]
  );
  const selectedPage = useMemo(
    () => selectedTemplate?.pages.find((page) => page.id === selectedPageId) ?? selectedTemplate?.pages[0] ?? null,
    [selectedPageId, selectedTemplate]
  );
  const selectedItem = useMemo(
    () => selectedPage?.items.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, selectedPage]
  );
  const selectedItems = useMemo(() => {
    if (!selectedPage) return [];
    if (selectedItemIds.length === 0) return selectedItem ? [selectedItem] : [];
    return selectedPage.items.filter((item) => selectedItemIds.includes(item.id));
  }, [selectedItem, selectedItemIds, selectedPage]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (isTypingTarget) return;

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedItemId(null);
        setSelectedItemIds([]);
        return;
      }

      const targetIds = selectedItemIds.length > 0 ? selectedItemIds : selectedItem ? [selectedItem.id] : [];
      if (targetIds.length === 0 || !selectedPage || !selectedTemplate) return;

      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateItems(targetIds);
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !selectedItems.some((item) => item.locked)) {
        event.preventDefault();
        removeItems(targetIds);
        return;
      }

      const arrowMap: Partial<Record<string, { x?: number; y?: number }>> = {
        ArrowLeft: { x: -1 },
        ArrowRight: { x: 1 },
        ArrowUp: { y: -1 },
        ArrowDown: { y: 1 },
      };
      const movement = arrowMap[event.key];
      if (!movement || selectedItems.some((item) => item.locked)) return;

      event.preventDefault();
      recordHistorySnapshot();
      batchUpdateItems(
        targetIds,
        (item) => ({
          x:
            movement.x !== undefined
              ? clamp(item.x + movement.x, 0, PAGE_WIDTH_MM - item.w)
              : item.x,
          y:
            movement.y !== undefined
              ? clamp(item.y + movement.y, 0, PAGE_HEIGHT_MM - item.h)
              : item.y,
        }),
        { recordHistory: false }
      );
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    futureSnapshots.length,
    pastSnapshots.length,
    redo,
    selectedItemIds,
    selectedItems,
    selectedItem,
    selectedPage,
    selectedTemplate,
    templates,
    undo,
  ]);
  const pageWarnings = useMemo(() => {
    if (!selectedPage) return [];
    const warnings: Array<{ type: "overlap" | "out_of_bounds"; itemIds: string[]; message: string }> = [];

    selectedPage.items.forEach((item) => {
      if (item.x < 0 || item.y < 0 || item.x + item.w > PAGE_WIDTH_MM || item.y + item.h > PAGE_HEIGHT_MM) {
        warnings.push({
          type: "out_of_bounds",
          itemIds: [item.id],
          message: `‘${item.label}’ 블록이 A4 페이지 밖으로 나가 있습니다.`,
        });
      }
    });

    for (let index = 0; index < selectedPage.items.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < selectedPage.items.length; compareIndex += 1) {
        const left = selectedPage.items[index];
        const right = selectedPage.items[compareIndex];
        if (itemsOverlap(left, right)) {
          warnings.push({
            type: "overlap",
            itemIds: [left.id, right.id],
            message: `‘${left.label}’와 ‘${right.label}’ 블록이 겹칩니다.`,
          });
        }
      }
    }

    return warnings;
  }, [selectedPage]);
  const warningItemIds = useMemo(
    () => new Set(pageWarnings.flatMap((warning) => warning.itemIds)),
    [pageWarnings]
  );

  useEffect(() => {
    if (!selectedTemplate) return;
    if (!selectedTemplate.pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(selectedTemplate.pages[0]?.id ?? null);
      setSelectedItemId(null);
    }
  }, [selectedPageId, selectedTemplate]);

  useEffect(() => {
    if (!selectedPage) {
      setSelectedItemId(null);
      setSelectedItemIds([]);
      return;
    }
    if (!selectedPage.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(selectedPage.items[0]?.id ?? null);
    }
    setSelectedItemIds((prev) => prev.filter((id) => selectedPage.items.some((item) => item.id === id)));
  }, [selectedItemId, selectedPage]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragState.current) return;
      const { templateId, pageId, itemId, mode, startX, startY, origin } = dragState.current;
      const dxPx = event.clientX - startX;
      const dyPx = event.clientY - startY;
      const dxMm = (dxPx / 640) * PAGE_WIDTH_MM;
      const dyMm = (dyPx / 900) * PAGE_HEIGHT_MM;

      setTemplates((prev) =>
        prev.map((template) => {
          if (template.id !== templateId) return template;
          const pages = template.pages.map((page) => {
            if (page.id !== pageId) return page;
            return {
              ...page,
              items: page.items.map((item) => {
                if (item.id !== itemId) return item;
                if (item.locked) return item;
                if (mode === "move") {
                  const nextX = snapValue(origin.x + dxMm, snapToGrid);
                  const nextY = snapValue(origin.y + dyMm, snapToGrid);
                  return {
                    ...item,
                    x: clamp(nextX, 0, PAGE_WIDTH_MM - item.w),
                    y: clamp(nextY, 0, PAGE_HEIGHT_MM - item.h),
                  };
                }
                if (mode === "resize-e") {
                  const nextW = snapValue(origin.w + dxMm, snapToGrid);
                  return {
                    ...item,
                    w: clamp(nextW, 10, PAGE_WIDTH_MM - item.x),
                  };
                }
                if (mode === "resize-s") {
                  const nextH = snapValue(origin.h + dyMm, snapToGrid);
                  return {
                    ...item,
                    h: clamp(nextH, 8, PAGE_HEIGHT_MM - item.y),
                  };
                }
                const nextW = snapValue(origin.w + dxMm, snapToGrid);
                const nextH = snapValue(origin.h + dyMm, snapToGrid);
                return {
                  ...item,
                  w: clamp(nextW, 10, PAGE_WIDTH_MM - item.x),
                  h: clamp(nextH, 8, PAGE_HEIGHT_MM - item.y),
                };
              }),
            };
          });
          return {
            ...template,
            pages,
            visibleSections: pageSectionList(pages),
            updatedAt: new Date().toISOString(),
          };
        })
      );
    }

    function handlePointerUp() {
      dragState.current = null;
      dragHistoryCapturedRef.current = false;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [snapToGrid]);

  function updateTemplate(patch: Partial<DocumentTemplate>) {
    if (!selectedTemplate) return;
    recordHistorySnapshot();
    setTemplates((prev) =>
      prev.map((template) =>
        template.id === selectedTemplate.id
          ? {
              ...template,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : template
      )
    );
  }

  function updatePages(nextPages: TemplateCanvasPage[]) {
    updateTemplate({
      pages: nextPages,
      visibleSections: pageSectionList(nextPages),
    });
  }

  function updatePage(pageId: string, patch: Partial<TemplateCanvasPage>) {
    if (!selectedTemplate) return;
    recordHistorySnapshot();
    const nextPages = selectedTemplate.pages.map((page) =>
      page.id === pageId ? { ...page, ...patch } : page
    );
    updatePages(nextPages);
  }

  function updateItem(itemId: string, patch: Partial<TemplateCanvasItem>, options?: { recordHistory?: boolean }) {
    if (!selectedPage || !selectedTemplate) return;
    if (options?.recordHistory !== false) {
      recordHistorySnapshot();
    }
    const nextPages = selectedTemplate.pages.map((page) => {
      if (page.id !== selectedPage.id) return page;
      return {
        ...page,
        items: page.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      };
    });
    updatePages(nextPages);
  }

  function batchUpdateItems(
    itemIds: string[],
    updater: (item: TemplateCanvasItem) => Partial<TemplateCanvasItem>,
    options?: { recordHistory?: boolean }
  ) {
    if (!selectedPage || !selectedTemplate || itemIds.length === 0) return;
    if (options?.recordHistory !== false) {
      recordHistorySnapshot();
    }
    const idSet = new Set(itemIds);
    const nextPages = selectedTemplate.pages.map((page) => {
      if (page.id !== selectedPage.id) return page;
      return {
        ...page,
        items: page.items.map((item) => (idSet.has(item.id) ? { ...item, ...updater(item) } : item)),
      };
    });
    updatePages(nextPages);
  }

  function addTemplate() {
    recordHistorySnapshot();
    const next = defaultTemplate(templates.length + 1);
    setTemplates((prev) => [...prev, next]);
    setSelectedTemplateId(next.id);
    setSelectedPageId(next.pages[0]?.id ?? null);
    setSelectedItemId(null);
  }

  function duplicateTemplate() {
    if (!selectedTemplate) return;
    recordHistorySnapshot();
    const duplicated: DocumentTemplate = {
      ...selectedTemplate,
      id: createId("template"),
      name: `${selectedTemplate.name} 복사본`,
      pages: duplicatePages(selectedTemplate.pages),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    setTemplates((prev) => [...prev, duplicated]);
    setSelectedTemplateId(duplicated.id);
    setSelectedPageId(duplicated.pages[0]?.id ?? null);
    setSelectedItemId(null);
  }

  function addPage() {
    if (!selectedTemplate) return;
    recordHistorySnapshot();
    const nextPage: TemplateCanvasPage = {
      id: createId("page"),
      name: `${selectedTemplate.pages.length + 1}페이지`,
      items: [],
    };
    updatePages([...selectedTemplate.pages, nextPage]);
    setSelectedPageId(nextPage.id);
    setSelectedItemId(null);
  }

  function duplicatePage(pageId: string) {
    if (!selectedTemplate) return;
    const sourcePage = selectedTemplate.pages.find((page) => page.id === pageId);
    if (!sourcePage) return;
    recordHistorySnapshot();
    const duplicatedPage: TemplateCanvasPage = {
      ...sourcePage,
      id: createId("page"),
      name: `${selectedTemplate.pages.length + 1}페이지`,
      items: sourcePage.items.map((item) => ({
        ...item,
        id: createId("item"),
      })),
    };
    updatePages([...selectedTemplate.pages, duplicatedPage]);
    setSelectedPageId(duplicatedPage.id);
    setSelectedItemId(null);
  }

  function removePage(pageId: string) {
    if (!selectedTemplate || selectedTemplate.pages.length <= 1) return;
    recordHistorySnapshot();
    const nextPages = selectedTemplate.pages.filter((page) => page.id !== pageId);
    updatePages(nextPages);
    setSelectedPageId(nextPages[0]?.id ?? null);
    setSelectedItemId(null);
  }

  function addItem(type: TemplateCanvasItemType) {
    if (!selectedPage || !selectedTemplate) return;
    recordHistorySnapshot();
    const sectionKey = SECTION_OPTIONS[0].key;
    const nextItem: TemplateCanvasItem =
      type === "section"
        ? {
            id: createId("item"),
            type,
            label: "새 섹션",
            sectionKey,
            x: 12,
            y: 12,
            w: 60,
            h: 28,
          }
        : type === "image"
          ? {
              id: createId("item"),
              type,
              label: "새 이미지",
              x: 12,
              y: 12,
              w: 40,
              h: 32,
              imagePromptPresetId: imagePrompts[0]?.id ?? null,
              imagePromptText: imagePrompts[0]?.prompt ?? "",
              imageBindingIndex: null,
            }
          : {
              id: createId("item"),
              type,
              label: "새 텍스트",
              x: 12,
              y: 12,
              w: 50,
              h: 18,
              textContent: "텍스트를 입력하세요",
            };
    const nextPages = selectedTemplate.pages.map((page) =>
      page.id === selectedPage.id
        ? { ...page, items: [...page.items, nextItem] }
        : page
    );
    updatePages(nextPages);
    setSelectedItemId(nextItem.id);
  }

  function removeItem(itemId: string) {
    if (!selectedPage || !selectedTemplate) return;
    recordHistorySnapshot();
    const nextPages = selectedTemplate.pages.map((page) =>
      page.id === selectedPage.id
        ? { ...page, items: page.items.filter((item) => item.id !== itemId) }
        : page
    );
    updatePages(nextPages);
    setSelectedItemId(null);
    setSelectedItemIds([]);
  }

  function removeItems(itemIds: string[]) {
    if (!selectedPage || !selectedTemplate || itemIds.length === 0) return;
    recordHistorySnapshot();
    const idSet = new Set(itemIds);
    const nextPages = selectedTemplate.pages.map((page) =>
      page.id === selectedPage.id
        ? { ...page, items: page.items.filter((item) => !idSet.has(item.id)) }
        : page
    );
    updatePages(nextPages);
    setSelectedItemId(null);
    setSelectedItemIds([]);
  }

  function duplicateItem(itemId: string) {
    if (!selectedPage || !selectedTemplate) return;
    recordHistorySnapshot();
    const source = selectedPage.items.find((item) => item.id === itemId);
    if (!source) return;
    const duplicated: TemplateCanvasItem = {
      ...source,
      id: createId("item"),
      label: `${source.label} 복사본`,
      x: clamp(source.x + 6, 0, PAGE_WIDTH_MM - source.w),
      y: clamp(source.y + 6, 0, PAGE_HEIGHT_MM - source.h),
      locked: false,
    };
    const nextPages = selectedTemplate.pages.map((page) =>
      page.id === selectedPage.id
        ? { ...page, items: [...page.items, duplicated] }
        : page
    );
    updatePages(nextPages);
    setSelectedItemId(duplicated.id);
    setSelectedItemIds([duplicated.id]);
  }

  function duplicateItems(itemIds: string[]) {
    if (!selectedPage || !selectedTemplate || itemIds.length === 0) return;
    recordHistorySnapshot();
    const idSet = new Set(itemIds);
    const createdIds: string[] = [];
    const nextPages = selectedTemplate.pages.map((page) => {
      if (page.id !== selectedPage.id) return page;
      const duplicates = page.items
        .filter((item) => idSet.has(item.id))
        .map((source) => {
          const duplicated: TemplateCanvasItem = {
            ...source,
            id: createId("item"),
            label: `${source.label} 복사본`,
            x: clamp(source.x + 6, 0, PAGE_WIDTH_MM - source.w),
            y: clamp(source.y + 6, 0, PAGE_HEIGHT_MM - source.h),
            locked: false,
          };
          createdIds.push(duplicated.id);
          return duplicated;
        });
      return {
        ...page,
        items: [...page.items, ...duplicates],
      };
    });
    updatePages(nextPages);
    setSelectedItemId(createdIds[0] ?? null);
    setSelectedItemIds(createdIds);
  }

  async function saveTemplates() {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/system-settings/document-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error ?? "저장 실패");
      return;
    }
    const nextTemplates = normalizeDocumentTemplates(data.templates);
    setTemplates(nextTemplates);
    setSelectedTemplateId((current) => nextTemplates.find((item) => item.id === current)?.id ?? nextTemplates[0]?.id ?? "");
    setMessage("템플릿이 저장되었습니다.");
    window.setTimeout(() => setMessage(null), 2500);
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>, item: TemplateCanvasItem, mode: DragMode) {
    if (!selectedTemplate || !selectedPage) return;
    if (item.locked) return;
    if (!dragHistoryCapturedRef.current) {
      recordHistorySnapshot();
      dragHistoryCapturedRef.current = true;
    }
    event.preventDefault();
    event.stopPropagation();
    dragState.current = {
      templateId: selectedTemplate.id,
      pageId: selectedPage.id,
      itemId: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: item.x, y: item.y, w: item.w, h: item.h },
    };
    setSelectedItemId(item.id);
    setSelectedItemIds([item.id]);
  }

  function handleSelectItem(itemId: string, additive: boolean) {
    if (additive) {
      setSelectedItemIds((prev) => {
        const exists = prev.includes(itemId);
        const next = exists ? prev.filter((id) => id !== itemId) : [...prev, itemId];
        setSelectedItemId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    setSelectedItemId(itemId);
    setSelectedItemIds([itemId]);
  }

  function applySelectionAlignment(target: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") {
    if (selectedItems.length < 2) return;
    const updates = alignSelection(selectedItems, target);
    batchUpdateItems(selectedItems.map((item) => item.id), (item) => updates.get(item.id) ?? {});
  }

  function applySelectionDistribution(axis: "horizontal" | "vertical") {
    if (selectedItems.length < 3) return;
    const updates = distributeSelection(selectedItems, axis);
    batchUpdateItems(selectedItems.map((item) => item.id), (item) => updates.get(item.id) ?? {});
  }

  const promptNameMap = useMemo(
    () => new Map(imagePrompts.map((prompt) => [prompt.id, prompt.name])),
    [imagePrompts]
  );

  return (
    <div style={{ flex: 1, overflow: "auto", background: "var(--color-bg)" }}>
      <div style={{ maxWidth: "1460px", margin: "0 auto", padding: "28px 24px 44px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "13px", color: "var(--color-text-subtle)", marginBottom: "6px" }}>문서 템플릿</div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "750", color: "var(--color-text)", letterSpacing: "-0.03em" }}>
              A4 템플릿 관리
            </h1>
            <p style={{ marginTop: "10px", fontSize: "14px", color: "var(--color-text-muted)", lineHeight: 1.7, maxWidth: "880px" }}>
              페이지를 추가하고, A4 캔버스 위에 블록을 자유롭게 배치할 수 있습니다. 이미지 블록은 기본 프롬프트 프리셋과 연결할 수 있고, 실제 생성 시 프리셋을 불러와 수정하는 구조를 전제로 합니다.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {message && <div style={{ fontSize: "12px", color: "var(--color-primary)" }}>{message}</div>}
            <button
              type="button"
              onClick={undo}
              disabled={pastSnapshots.length === 0}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "700",
                cursor: pastSnapshots.length === 0 ? "not-allowed" : "pointer",
                opacity: pastSnapshots.length === 0 ? 0.5 : 1,
              }}
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={futureSnapshots.length === 0}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "700",
                cursor: futureSnapshots.length === 0 ? "not-allowed" : "pointer",
                opacity: futureSnapshots.length === 0 ? 0.5 : 1,
              }}
            >
              다시하기
            </button>
            <button
              type="button"
              onClick={() => setSnapToGrid((prev) => !prev)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: `1px solid ${snapToGrid ? "var(--color-primary)" : "var(--color-border)"}`,
                background: snapToGrid ? "var(--color-primary-light)" : "var(--color-surface)",
                color: snapToGrid ? "var(--color-primary)" : "var(--color-text)",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer",
              }}
            >
              {snapToGrid ? "스냅 ON" : "스냅 OFF"}
            </button>
            <button
              type="button"
              onClick={duplicateTemplate}
              disabled={!selectedTemplate}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "700",
                cursor: selectedTemplate ? "pointer" : "not-allowed",
                opacity: selectedTemplate ? 1 : 0.5,
              }}
            >
              템플릿 복제
            </button>
            <button
              type="button"
              onClick={addTemplate}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              템플릿 추가
            </button>
            <button
              type="button"
              onClick={() => void saveTemplates()}
              disabled={saving}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "none",
                background: "var(--color-primary)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "700",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "저장 중..." : "템플릿 저장"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 320px", gap: "16px" }}>
          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", fontSize: "13px", fontWeight: "700", color: "var(--color-text)" }}>
              템플릿 목록
            </div>
            <div style={{ display: "grid" }}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setSelectedPageId(template.pages[0]?.id ?? null);
                    setSelectedItemId(null);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px minmax(0, 1fr)",
                    gap: "12px",
                    alignItems: "center",
                    padding: "14px 16px",
                    border: "none",
                    borderTop: "1px solid var(--color-border)",
                    background: selectedTemplateId === template.id ? "var(--color-primary-light)" : "var(--color-surface)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{
                    width: "72px",
                    height: "96px",
                    borderRadius: "10px",
                    border: `1px solid ${template.accentColor}33`,
                    background: "#fff",
                    boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
                    padding: "8px",
                    boxSizing: "border-box",
                    display: "grid",
                    alignContent: "start",
                    gap: "4px",
                  }}>
                    {template.pages[0]?.items.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        style={{
                          height: item.type === "image" ? "16px" : "8px",
                          borderRadius: "6px",
                          background: item.type === "image" ? `${template.accentColor}2B` : "#E2E8F0",
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-text)" }}>{template.name}</div>
                    <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                      {template.description || "설명이 없습니다."}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {selectedTemplate && (
            <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px" }}>
              <div style={{ display: "grid", gap: "14px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                    작업 기록: {pastSnapshots.length}단계
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-subtle)" }}>
                    단축키: ⌘/Ctrl+Z, ⇧+⌘/Ctrl+Z
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 180px", gap: "10px" }}>
                  <input
                    value={selectedTemplate.name}
                    onChange={(e) => updateTemplate({ name: e.target.value })}
                    placeholder="템플릿명"
                    style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                  />
                  <input
                    value={selectedTemplate.previewLabel}
                    onChange={(e) => updateTemplate({ previewLabel: e.target.value })}
                    placeholder="미리보기 라벨"
                    style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px" }}
                  />
                  <input
                    type="color"
                    value={selectedTemplate.accentColor}
                    onChange={(e) => updateTemplate({ accentColor: e.target.value })}
                    style={{ width: "100%", height: "42px", padding: "4px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "#fff" }}
                  />
                </div>

                <textarea
                  value={selectedTemplate.description}
                  onChange={(e) => updateTemplate({ description: e.target.value })}
                  rows={2}
                  placeholder="템플릿 설명"
                  style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "13px", resize: "vertical" }}
                />

                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  {selectedTemplate.pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => {
                        setSelectedPageId(page.id);
                        setSelectedItemId(null);
                      }}
                      style={{
                        padding: "7px 10px",
                        borderRadius: "999px",
                        border: `1px solid ${selectedPage?.id === page.id ? selectedTemplate.accentColor : "var(--color-border)"}`,
                        background: selectedPage?.id === page.id ? `${selectedTemplate.accentColor}18` : "var(--color-surface)",
                        color: selectedPage?.id === page.id ? selectedTemplate.accentColor : "var(--color-text-muted)",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      {page.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addPage}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "999px",
                      border: "1px dashed var(--color-border-strong)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    + 페이지 추가
                  </button>
                  {selectedPage && (
                    <button
                      type="button"
                      onClick={() => duplicatePage(selectedPage.id)}
                      style={{
                        padding: "7px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      현재 페이지 복제
                    </button>
                  )}
                  {selectedPage && selectedTemplate.pages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePage(selectedPage.id)}
                      style={{
                        padding: "7px 10px",
                        borderRadius: "999px",
                        border: "1px solid #FECACA",
                        background: "#FEF2F2",
                        color: "#B91C1C",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      현재 페이지 삭제
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {ITEM_TYPE_OPTIONS.map((itemType) => (
                    <button
                      key={itemType.value}
                      type="button"
                      onClick={() => addItem(itemType.value)}
                      disabled={!selectedPage}
                      style={{
                        padding: "7px 10px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: selectedPage ? "pointer" : "not-allowed",
                        opacity: selectedPage ? 1 : 0.5,
                      }}
                    >
                      + {itemType.label}
                    </button>
                  ))}
                </div>

                {pageWarnings.length > 0 && (
                  <div style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #FECACA",
                    background: "#FEF2F2",
                    display: "grid",
                    gap: "6px",
                  }}>
                    <div style={{ fontSize: "12px", fontWeight: "800", color: "#B91C1C" }}>
                      레이아웃 경고
                    </div>
                    {pageWarnings.map((warning, index) => (
                      <div key={`${warning.type}-${index}`} style={{ fontSize: "11px", color: "#991B1B", lineHeight: 1.55 }}>
                        • {warning.message}
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    background: "#E5E7EB",
                    borderRadius: "18px",
                    padding: "24px 0 40px",
                    overflowX: "auto",
                  }}
                >
                  <div style={{ width: "640px", margin: "0 auto" }}>
                    <div
                      style={{
                        position: "relative",
                        width: "640px",
                        aspectRatio: "210 / 297",
                        borderRadius: "2px",
                        background: "#fff",
                        backgroundImage: snapToGrid
                          ? "linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)"
                          : "none",
                        backgroundSize: snapToGrid ? "12.190476px 12.121212px" : "auto",
                        boxShadow: "0 18px 40px rgba(15,23,42,0.12)",
                        overflow: "hidden",
                        border: "1px solid #E5E7EB",
                      }}
                    >
                      {selectedPage?.items.map((item) => {
                        const isActive = selectedItemId === item.id;
                        const isSelected = selectedItemIds.includes(item.id);
                        const hasWarning = warningItemIds.has(item.id);
                        return (
                          <div
                            key={item.id}
                            onClick={(event) => handleSelectItem(item.id, event.shiftKey)}
                            onPointerDown={(event) => beginDrag(event, item, "move")}
                            style={{
                              position: "absolute",
                              left: `${mmToPercentX(item.x)}%`,
                              top: `${mmToPercentY(item.y)}%`,
                              width: `${mmToPercentX(item.w)}%`,
                              height: `${mmToPercentY(item.h)}%`,
                              borderRadius: "10px",
                              border: `2px solid ${hasWarning ? "#DC2626" : isSelected ? selectedTemplate.accentColor : "#CBD5E1"}`,
                              background:
                                item.type === "image"
                                  ? "linear-gradient(135deg, #F8FAFC, #E2E8F0)"
                                  : item.type === "text"
                                    ? "#FFF7ED"
                                    : `${selectedTemplate.accentColor}12`,
                              padding: "10px",
                              boxSizing: "border-box",
                              cursor: item.locked ? "default" : "move",
                              userSelect: "none",
                              overflow: "hidden",
                              boxShadow: isSelected ? "0 0 0 3px rgba(37,99,235,0.12)" : "none",
                            }}
                          >
                            <div style={{ fontSize: "11px", fontWeight: "800", color: item.type === "section" ? selectedTemplate.accentColor : "var(--color-text)", display: "flex", alignItems: "center", gap: "6px" }}>
                              {item.label}
                              {item.locked && (
                                <span style={{ fontSize: "10px", color: "#B45309", background: "#FEF3C7", padding: "2px 6px", borderRadius: "999px" }}>
                                  잠금
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                              {item.type === "section" && (SECTION_OPTIONS.find((section) => section.key === item.sectionKey)?.label ?? "섹션")}
                              {item.type === "text" && (item.textContent || "텍스트 블록")}
                              {item.type === "image" && (
                                item.imagePromptPresetId ? promptNameMap.get(item.imagePromptPresetId) ?? "이미지 프롬프트" : "이미지 프롬프트 미지정"
                              )}
                              {item.type === "image" && typeof item.imageBindingIndex === "number" && (
                                <span style={{ display: "block", marginTop: "4px", color: "#1D4ED8" }}>
                                  생성 이미지 슬롯 {item.imageBindingIndex + 1}
                                </span>
                              )}
                            </div>
                            {!item.locked && (
                              <>
                                <div
                                  onPointerDown={(event) => beginDrag(event, item, "resize-e")}
                                  style={{ position: "absolute", right: "-6px", top: "50%", transform: "translateY(-50%)", width: "12px", height: "40px", borderRadius: "999px", background: selectedTemplate.accentColor, cursor: "ew-resize" }}
                                />
                                <div
                                  onPointerDown={(event) => beginDrag(event, item, "resize-s")}
                                  style={{ position: "absolute", left: "50%", bottom: "-6px", transform: "translateX(-50%)", width: "40px", height: "12px", borderRadius: "999px", background: selectedTemplate.accentColor, cursor: "ns-resize" }}
                                />
                                <div
                                  onPointerDown={(event) => beginDrag(event, item, "resize-se")}
                                  style={{ position: "absolute", right: "-6px", bottom: "-6px", width: "14px", height: "14px", borderRadius: "999px", background: selectedTemplate.accentColor, cursor: "nwse-resize" }}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                  글자가 많아 A4 박스를 넘길 수 있는 문제는 블록별로 `권장 높이`를 먼저 잡고, 실제 export 시 넘치는 텍스트는 자동으로 다음 페이지로 이어붙이거나 별도 overflow 페이지를 생성하는 방식이 가장 안전합니다. 지금 구조는 그 자동 분할 로직을 얹을 수 있게 `페이지/아이템 단위`로 바뀐 상태입니다.
                </div>
              </div>
            </section>
          )}

          <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "14px", padding: "18px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--color-text)", marginBottom: "10px" }}>선택 블록 속성</div>
            {!selectedItem ? (
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                A4 캔버스의 블록을 클릭하면 여기서 위치, 크기, 타입별 옵션을 조정할 수 있습니다.
              </div>
            ) : selectedItems.length > 1 ? (
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                  {selectedItems.length}개 블록이 선택되었습니다. Shift+클릭으로 선택을 추가/해제할 수 있습니다.
                </div>
                <div style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>일괄 정렬</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                    {([
                      { key: "left", label: "좌측" },
                      { key: "center-x", label: "가운데" },
                      { key: "right", label: "우측" },
                      { key: "top", label: "상단" },
                      { key: "center-y", label: "중앙" },
                      { key: "bottom", label: "하단" },
                    ] as const).map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => applySelectionAlignment(action.key)}
                        style={{
                          padding: "8px 6px",
                          borderRadius: "8px",
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-text)",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>일괄 분배</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => applySelectionDistribution("horizontal")}
                      disabled={selectedItems.length < 3}
                      style={{
                        padding: "8px 6px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: selectedItems.length < 3 ? "not-allowed" : "pointer",
                        opacity: selectedItems.length < 3 ? 0.5 : 1,
                      }}
                    >
                      가로 분배
                    </button>
                    <button
                      type="button"
                      onClick={() => applySelectionDistribution("vertical")}
                      disabled={selectedItems.length < 3}
                      style={{
                        padding: "8px 6px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: selectedItems.length < 3 ? "not-allowed" : "pointer",
                        opacity: selectedItems.length < 3 ? 0.5 : 1,
                      }}
                    >
                      세로 분배
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => duplicateItems(selectedItems.map((item) => item.id))}
                    style={{
                      padding: "9px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer",
                    }}
                  >
                    선택 복제
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItems(selectedItems.map((item) => item.id))}
                    disabled={selectedItems.some((item) => item.locked)}
                    style={{
                      padding: "9px 10px",
                      borderRadius: "8px",
                      border: "1px solid #FECACA",
                      background: "#FEF2F2",
                      color: "#B91C1C",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: selectedItems.some((item) => item.locked) ? "not-allowed" : "pointer",
                      opacity: selectedItems.some((item) => item.locked) ? 0.5 : 1,
                    }}
                  >
                    선택 삭제
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>라벨</span>
                  <input
                    value={selectedItem.label}
                    onChange={(e) => updateItem(selectedItem.id, { label: e.target.value })}
                    style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>X</span>
                    <input type="number" value={Math.round(selectedItem.x)} onChange={(e) => updateItem(selectedItem.id, { x: clamp(Number(e.target.value), 0, PAGE_WIDTH_MM - selectedItem.w) })} style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }} />
                  </label>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>Y</span>
                    <input type="number" value={Math.round(selectedItem.y)} onChange={(e) => updateItem(selectedItem.id, { y: clamp(Number(e.target.value), 0, PAGE_HEIGHT_MM - selectedItem.h) })} style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }} />
                  </label>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>W</span>
                    <input type="number" value={Math.round(selectedItem.w)} onChange={(e) => updateItem(selectedItem.id, { w: clamp(Number(e.target.value), 10, PAGE_WIDTH_MM - selectedItem.x) })} style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }} />
                  </label>
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>H</span>
                    <input type="number" value={Math.round(selectedItem.h)} onChange={(e) => updateItem(selectedItem.id, { h: clamp(Number(e.target.value), 8, PAGE_HEIGHT_MM - selectedItem.y) })} style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }} />
                  </label>
                </div>

                <div style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>빠른 정렬</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                    {([
                      { key: "left", label: "좌측" },
                      { key: "center-x", label: "가운데" },
                      { key: "right", label: "우측" },
                      { key: "top", label: "상단" },
                      { key: "center-y", label: "중앙" },
                      { key: "bottom", label: "하단" },
                    ] as const).map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => updateItem(selectedItem.id, alignItem(selectedItem, action.key))}
                        disabled={selectedItem.locked}
                        style={{
                          padding: "8px 6px",
                          borderRadius: "8px",
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-text)",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: selectedItem.locked ? "not-allowed" : "pointer",
                          opacity: selectedItem.locked ? 0.5 : 1,
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--color-text)" }}>
                  <input
                    type="checkbox"
                    checked={selectedItem.locked === true}
                    onChange={(e) => updateItem(selectedItem.id, { locked: e.target.checked })}
                  />
                  이 블록 잠금
                </label>

                {selectedItem.type === "section" && (
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>연결 섹션</span>
                    <select
                      value={selectedItem.sectionKey ?? "passage"}
                      onChange={(e) => updateItem(selectedItem.id, { sectionKey: e.target.value as DocumentSectionKey })}
                      style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                    >
                      {SECTION_OPTIONS.map((section) => (
                        <option key={section.key} value={section.key}>{section.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedItem.type === "text" && (
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>텍스트 내용</span>
                    <textarea
                      value={selectedItem.textContent ?? ""}
                      onChange={(e) => updateItem(selectedItem.id, { textContent: e.target.value })}
                      rows={5}
                      style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px", resize: "vertical" }}
                    />
                  </label>
                )}

                {selectedItem.type === "image" && (
                  <>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>연결 이미지 슬롯</span>
                      <select
                        value={selectedItem.imageBindingIndex ?? ""}
                        onChange={(e) =>
                          updateItem(selectedItem.id, {
                            imageBindingIndex: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                          })
                        }
                        style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                      >
                        <option value="">자동 연결</option>
                        {Array.from({ length: 8 }).map((_, index) => (
                          <option key={index} value={index}>
                            생성 이미지 {index + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>기본 프롬프트 프리셋</span>
                      <select
                        value={selectedItem.imagePromptPresetId ?? ""}
                        onChange={(e) => {
                          const presetId = e.target.value || null;
                          const preset = imagePrompts.find((prompt) => prompt.id === presetId);
                          updateItem(selectedItem.id, {
                            imagePromptPresetId: presetId,
                            imagePromptText: preset?.prompt ?? selectedItem.imagePromptText ?? "",
                          });
                        }}
                        style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px" }}
                      >
                        <option value="">프리셋 없음</option>
                        {imagePrompts.map((prompt) => (
                          <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-text)" }}>기본 이미지 프롬프트</span>
                      <textarea
                        value={selectedItem.imagePromptText ?? ""}
                        onChange={(e) => updateItem(selectedItem.id, { imagePromptText: e.target.value })}
                        rows={6}
                        style={{ padding: "8px 9px", borderRadius: "8px", border: "1px solid var(--color-border)", fontSize: "12px", resize: "vertical" }}
                      />
                    </label>
                    <div style={{ fontSize: "11px", color: "var(--color-text-subtle)", lineHeight: 1.6 }}>
                      템플릿에 저장된 프롬프트는 기본값으로 자동 불러오고, 실제 이미지 생성 시 드롭다운에서 다른 프리셋으로 바꾸거나 텍스트를 직접 수정하는 흐름을 전제로 합니다. 연결 이미지 슬롯을 지정하면 생성된 이미지 중 몇 번째 결과를 이 블록이 우선 사용해야 하는지도 고정할 수 있습니다.
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => duplicateItem(selectedItem.id)}
                  style={{
                    marginTop: "6px",
                    padding: "9px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-text)",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  이 블록 복제
                </button>

                <button
                  type="button"
                  onClick={() => removeItem(selectedItem.id)}
                  style={{
                    marginTop: "6px",
                    padding: "9px 10px",
                    borderRadius: "8px",
                    border: "1px solid #FECACA",
                    background: "#FEF2F2",
                    color: "#B91C1C",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  이 블록 삭제
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
