"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import {
  calculateMenuPosition,
  calculateSubmenuPosition,
} from "@/lib/context-menu-position";
import type {
  ContextMenuEntry,
  ContextMenuSubmenu,
} from "@/lib/context-menu-types";

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
  ariaLabel?: string;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel = "Context Menu",
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x, y };
    return calculateMenuPosition({
      clickX: x,
      clickY: y,
      menuWidth: 200,
      menuHeight: Math.min(400, items.length * 30 + 10),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  });
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null);
  const submenuTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Viewport-clamped positioning once mounted and measured
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pos = calculateMenuPosition({
      clickX: x,
      clickY: y,
      menuWidth: rect.width || 200,
      menuHeight: rect.height || 200,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPosition({ x: pos.x, y: pos.y });
  }, [x, y, items]);

  // Position submenu when active
  useLayoutEffect(() => {
    if (!activeSubmenuId || !submenuTriggerRef.current) {
      setSubmenuPos(null);
      return;
    }
    const parentRect = submenuTriggerRef.current.getBoundingClientRect();
    const pos = calculateSubmenuPosition({
      parentRect: {
        left: parentRect.left,
        top: parentRect.top,
        right: parentRect.right,
        bottom: parentRect.bottom,
      },
      submenuWidth: 190,
      submenuHeight: 150,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setSubmenuPos({ x: pos.x, y: pos.y });
  }, [activeSubmenuId]);

  // Dismiss on outside click, window resize, or scroll
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleScroll = (event: Event) => {
      // If scroll happens outside the menu itself, close it
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleResize = () => onClose();
    const handleBlur = () => onClose();

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("touchstart", handlePointerDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("touchstart", handlePointerDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (activeSubmenuId) {
          setActiveSubmenuId(null);
        } else {
          onClose();
        }
        return;
      }

      const enabledIndices: number[] = [];
      items.forEach((item, idx) => {
        if (item.type !== "separator" && !item.disabled) {
          enabledIndices.push(idx);
        }
      });

      if (enabledIndices.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) => {
          const curPos = enabledIndices.indexOf(prev);
          const nextPos = curPos === -1 || curPos === enabledIndices.length - 1 ? 0 : curPos + 1;
          return enabledIndices[nextPos];
        });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => {
          const curPos = enabledIndices.indexOf(prev);
          const nextPos = curPos <= 0 ? enabledIndices.length - 1 : curPos - 1;
          return enabledIndices[nextPos];
        });
      } else if (event.key === "Home") {
        event.preventDefault();
        setHighlightedIndex(enabledIndices[0]);
      } else if (event.key === "End") {
        event.preventDefault();
        setHighlightedIndex(enabledIndices[enabledIndices.length - 1]);
      } else if (event.key === "ArrowRight") {
        const currentItem = items[highlightedIndex];
        if (currentItem && currentItem.type === "submenu" && !currentItem.disabled) {
          event.preventDefault();
          setActiveSubmenuId(currentItem.id);
        }
      } else if (event.key === "ArrowLeft") {
        if (activeSubmenuId) {
          event.preventDefault();
          setActiveSubmenuId(null);
        }
      } else if (event.key === "Enter" || event.key === " ") {
        const currentItem = items[highlightedIndex];
        if (!currentItem || currentItem.type === "separator" || currentItem.disabled) return;
        event.preventDefault();
        if (currentItem.type === "submenu") {
          setActiveSubmenuId(currentItem.id);
        } else {
          onClose();
          void currentItem.onSelect();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [items, highlightedIndex, activeSubmenuId, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  const activeSubmenu = items.find(
    (it): it is ContextMenuSubmenu => it.type === "submenu" && it.id === activeSubmenuId
  );

  return createPortal(
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        className="desktop-context-menu"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        {items.map((item, index) => {
          if (item.type === "separator") {
            return <div key={`sep-${index}`} role="separator" className="desktop-context-menu-separator" />;
          }

          const isSubmenu = item.type === "submenu";
          const isHighlighted = index === highlightedIndex || (isSubmenu && activeSubmenuId === item.id);

          if (isSubmenu) {
            return (
              <button
                key={item.id}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={activeSubmenuId === item.id}
                aria-disabled={item.disabled}
                disabled={item.disabled}
                data-highlighted={isHighlighted ? "true" : undefined}
                className="desktop-context-menu-item"
                onMouseEnter={(e) => {
                  setHighlightedIndex(index);
                  if (!item.disabled) {
                    submenuTriggerRef.current = e.currentTarget;
                    setActiveSubmenuId(item.id);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!item.disabled) {
                    submenuTriggerRef.current = e.currentTarget;
                    setActiveSubmenuId((cur) => (cur === item.id ? null : item.id));
                  }
                }}
              >
                {item.icon && <span className="desktop-context-menu-icon">{item.icon}</span>}
                <span className="desktop-context-menu-label">{item.label}</span>
                <span className="desktop-context-menu-submenu-arrow">
                  <ChevronRight size={13} strokeWidth={2} />
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              role="menuitem"
              aria-disabled={item.disabled}
              disabled={item.disabled}
              data-danger={item.danger ? "true" : undefined}
              data-highlighted={isHighlighted ? "true" : undefined}
              className="desktop-context-menu-item"
              onMouseEnter={() => {
                setHighlightedIndex(index);
                setActiveSubmenuId(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                onClose();
                void item.onSelect();
              }}
            >
              {item.icon && <span className="desktop-context-menu-icon">{item.icon}</span>}
              <span className="desktop-context-menu-label">{item.label}</span>
              {item.shortcut && <span className="desktop-context-menu-shortcut">{item.shortcut}</span>}
            </button>
          );
        })}
      </div>

      {activeSubmenu && submenuPos && (
        <div
          role="menu"
          aria-label={activeSubmenu.label}
          className="desktop-context-menu"
          style={{
            left: submenuPos.x,
            top: submenuPos.y,
          }}
          onMouseEnter={() => {
            // Keep submenu open while hovering over submenu items
          }}
        >
          {activeSubmenu.items.map((subItem, subIndex) => {
            if (subItem.type === "separator") {
              return <div key={`sub-sep-${subIndex}`} role="separator" className="desktop-context-menu-separator" />;
            }
            if (subItem.type === "submenu") return null;

            return (
              <button
                key={subItem.id}
                role="menuitem"
                aria-disabled={subItem.disabled}
                disabled={subItem.disabled}
                data-danger={subItem.danger ? "true" : undefined}
                className="desktop-context-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  if (subItem.disabled) return;
                  onClose();
                  void subItem.onSelect();
                }}
              >
                {subItem.icon && <span className="desktop-context-menu-icon">{subItem.icon}</span>}
                <span className="desktop-context-menu-label">{subItem.label}</span>
                {subItem.shortcut && <span className="desktop-context-menu-shortcut">{subItem.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>,
    document.body,
  );
}
