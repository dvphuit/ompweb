import type React from "react";

export interface ContextMenuItem {
  type?: "action";
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ContextMenuSubmenu {
  type: "submenu";
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  items: ContextMenuEntry[];
}

export interface ContextMenuSeparator {
  type: "separator";
  id?: string;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSubmenu | ContextMenuSeparator;

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  ariaLabel?: string;
}

export interface ContextMenuContextValue {
  showContextMenu: (x: number, y: number, items: ContextMenuEntry[], ariaLabel?: string) => void;
  closeContextMenu: () => void;
  isOpen: boolean;
}
