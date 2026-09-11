"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getFileIcon } from "./FileIcons";
import { SidebarPortalMenu } from "./SessionSidebar-chrome";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Keep the active tab visible when the bar overflows horizontally.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    if (tabRect.left < listRect.left) {
      list.scrollLeft -= listRect.left - tabRect.left;
    } else if (tabRect.right > listRect.right) {
      list.scrollLeft += tabRect.right - listRect.right;
    }
  }, [activeTabId, tabs]);

  // Overflow detection: the dropdown chevron only appears when tabs actually
  // clip. Re-check on tab changes and on resizes of the bar itself.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setOverflowing((prev) => {
      const next = list.scrollWidth > list.clientWidth + 1;
      return prev === next ? prev : next;
    });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(list);
    return () => ro.disconnect();
  }, [tabs]);

  // Closing tabs from inside the menu can unmount its anchor button — shut
  // the menu when there is nothing to overflow anymore.
  useEffect(() => {
    if (!overflowing) setMenuOpen(false);
  }, [overflowing]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-panel)",
        flexShrink: 0,
        height: 36,
      }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Open files"
        className="tabbar-scroll"
        style={{
          display: "flex",
          alignItems: "flex-end",
          background: "var(--bg-panel)",
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
          height: 36,
        }}
      >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-context-menu="tab"
            data-tab-id={tab.id}
            data-file-path={tab.filePath}
            data-tab-label={tab.label}
            className="tabbar-tab ui-focus-ring"
            onClick={() => onSelectTab(tab.id)}
            role="tab"
            tabIndex={isActive ? 0 : -1}
            aria-selected={isActive}
            aria-label={tab.filePath}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectTab(tab.id); }
              if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onCloseTab(tab.id); }
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                if (next) {
                  onSelectTab(next.id);
                  // Roving tabindex: move DOM focus to the newly selected tab
                  // so the visible focus ring follows the selection.
                  const nextEl = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`);
                  nextEl?.focus();
                }
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              paddingLeft: 12,
              paddingRight: 6,
              borderRight: "var(--bw) solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              position: "relative",
              transition: `background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)`,
            }}
          >
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 2,
                  background: "var(--accent)",
                  borderTopLeftRadius: "var(--radius-control)",
                  borderTopRightRadius: "var(--radius-control)",
                }}
              />
            )}
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {getFileIcon(tab.label, 13)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              tabIndex={-1}
              className="tabbar-close ui-focus-ring"
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: `background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)`,
              }}
              title={t("tabBar.close")}
              aria-label={t("tabBar.closeTab", { label: tab.label })}
            >
              <X size={11} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      </div>
      {overflowing && (
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          title={t("tabBar.showAllTabs")}
          aria-label={t("tabBar.showAllTabs")}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="ui-focus-ring"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            flexShrink: 0,
            padding: 0,
            background: menuOpen ? "var(--bg-hover)" : "transparent",
            border: "none",
            borderLeft: "var(--bw) solid var(--border)",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <ChevronDown
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            style={{
              transform: menuOpen ? "rotate(180deg)" : "none",
              transition: "transform var(--dur-fast) var(--ease-out-warm)",
            }}
          />
        </button>
      )}
      <SidebarPortalMenu
        anchor={menuButtonRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="below"
        align="end"
        minWidth={220}
        style={{ padding: 4, maxHeight: "min(50vh, 360px)", overflowY: "auto" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              role="menuitem"
              aria-current={isActive ? "true" : undefined}
              onClick={() => { onSelectTab(tab.id); setMenuOpen(false); }}
              onKeyDown={(event) => {
                // Delete closes without leaving the menu, so several tabs can
                // be pruned in one pass; Enter/Space selects and dismisses.
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
              className="sidebar-menu-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 6px 6px 9px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: isActive ? "var(--bg-selected)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 12,
                textAlign: "left",
              }}
            >
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: isActive ? 1 : 0.7 }}>
                {getFileIcon(tab.label, 13)}
              </span>
              <span
                title={tab.filePath}
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {tab.label}
              </span>
              {/* Mouse-only affordance (keyboard: Delete on the row); kept out of
                  the a11y tree so the row stays a single menuitem. */}
              <span
                aria-hidden="true"
                title={t("tabBar.close")}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, flexShrink: 0,
                  borderRadius: "var(--radius-control)",
                  color: "var(--text-dim)", cursor: "pointer",
                }}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </SidebarPortalMenu>
    </div>
  );
}
