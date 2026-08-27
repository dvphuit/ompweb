"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Copy,
  Folder,
  FolderOpen,
  GitFork,
  MessageSquare,
  Moon,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
  Trash2,
  Archive,
  Pencil,
  Terminal,
  ExternalLink,
  AtSign,
  X,
  FileCode,
  Sparkles,
  Scissors,
  Clipboard,
  CheckSquare,
} from "lucide-react";
import { ContextMenu } from "./ui/ContextMenu";
import type {
  ContextMenuContextValue,
  ContextMenuEntry,
  ContextMenuState,
} from "@/lib/context-menu-types";
import { copyText, pasteText } from "@/lib/clipboard";
import { toast } from "./ui/toast";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";

const ContextMenuCtx = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuCtx);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return ctx;
}

export interface ContextMenuActions {
  onNewSession?: (cwd?: string) => void;
  onOpenCommandPalette?: () => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: (tab?: string) => void;
  onSelectSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentName: string) => void;
  onForkSession?: (sessionId: string, entryId?: string) => void;
  onArchiveSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  onOpenFile?: (filePath: string, fileName?: string) => void;
  onCloseTab?: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseTabsToRight?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onInsertMention?: (text: string) => void;
  onQuoteInChat?: (text: string) => void;
  onHideProject?: (projectPath: string) => void;
  activeCwd?: string | null;
}

interface ContextMenuProviderProps {
  children: ReactNode;
  actions?: ContextMenuActions;
}

export function ContextMenuProvider({
  children,
  actions = {},
}: ContextMenuProviderProps) {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const cmdKey = isMac ? "⌘" : "Ctrl+";

  const showContextMenu = useCallback(
    (x: number, y: number, items: ContextMenuEntry[], ariaLabel?: string) => {
      setMenuState({ x, y, items, ariaLabel });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  // Global right-click interceptor
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const items: ContextMenuEntry[] = [];
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const selection = window.getSelection();
      const selectionText = selection?.toString().trim();
      let isClickInsideSelection = false;

      if (selectionText && selection && selection.rangeCount > 0 && !isInput) {
        for (let i = 0; i < selection.rangeCount; i++) {
          const range = selection.getRangeAt(i);
          const rangeContainer = range.commonAncestorContainer;
          if (rangeContainer.contains(target) || target.contains(rangeContainer)) {
            isClickInsideSelection = true;
            break;
          }
        }
      }

      // 1. Text selection takes priority if click is within the active selection
      if (isClickInsideSelection && selectionText) {
        items.push({
          id: "copy-selection",
          label: t("contextMenu.copy"),
          icon: <Copy size={14} />,
          shortcut: `${cmdKey}C`,
          onSelect: async () => {
            await copyText(selectionText);
            toast.success(t("contextMenu.copied"));
          },
        });

        if (actions.onQuoteInChat) {
          items.push({
            id: "quote-selection",
            label: t("contextMenu.quoteInChat"),
            icon: <MessageSquare size={14} />,
            onSelect: () => {
              actions.onQuoteInChat?.(selectionText);
            },
          });
        }

        items.push({ type: "separator" });
        items.push({
          id: "select-all",
          label: t("contextMenu.selectAll"),
          shortcut: `${cmdKey}A`,
          onSelect: () => {
            document.execCommand("selectAll");
          },
        });

        showContextMenu(e.clientX, e.clientY, items, "Selection Menu");
        return;
      }

      // 2. Text input / textarea element
      if (isInput) {
        const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
        const hasSelection = (inputEl.selectionEnd ?? 0) - (inputEl.selectionStart ?? 0) > 0;
        const hasValue = inputEl.value !== undefined ? inputEl.value.length > 0 : (inputEl.innerText?.length ?? 0) > 0;

        items.push({
          id: "cut",
          label: t("contextMenu.cut"),
          icon: <Scissors size={14} />,
          shortcut: `${cmdKey}X`,
          disabled: !hasSelection,
          onSelect: async () => {
            if (inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
              const selected = inputEl.value.slice(inputEl.selectionStart, inputEl.selectionEnd);
              await copyText(selected);
              const val = inputEl.value;
              const start = inputEl.selectionStart;
              const end = inputEl.selectionEnd;
              inputEl.value = val.slice(0, start) + val.slice(end);
              inputEl.setSelectionRange(start, start);
              inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
          },
        });

        items.push({
          id: "copy",
          label: t("contextMenu.copy"),
          icon: <Copy size={14} />,
          shortcut: `${cmdKey}C`,
          disabled: !hasSelection && !hasValue,
          onSelect: async () => {
            if (hasSelection && inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
              await copyText(inputEl.value.slice(inputEl.selectionStart, inputEl.selectionEnd));
            } else if (hasValue) {
              await copyText(inputEl.value || inputEl.innerText || "");
            }
            toast.success(t("contextMenu.copied"));
          },
        });

        items.push({
          id: "paste",
          label: t("contextMenu.paste"),
          icon: <Clipboard size={14} />,
          shortcut: `${cmdKey}V`,
          onSelect: async () => {
            const pasted = await pasteText();
            if (pasted && inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
              const val = inputEl.value;
              const start = inputEl.selectionStart;
              const end = inputEl.selectionEnd;
              inputEl.value = val.slice(0, start) + pasted + val.slice(end);
              const newPos = start + pasted.length;
              inputEl.setSelectionRange(newPos, newPos);
              inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
          },
        });

        items.push({ type: "separator" });
        items.push({
          id: "select-all",
          label: t("contextMenu.selectAll"),
          icon: <CheckSquare size={14} />,
          shortcut: `${cmdKey}A`,
          disabled: !hasValue,
          onSelect: () => {
            if (typeof inputEl.select === "function") {
              inputEl.select();
            }
          },
        });

        items.push({
          id: "clear",
          label: t("contextMenu.clear"),
          disabled: !hasValue,
          onSelect: () => {
            inputEl.value = "";
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          },
        });

        showContextMenu(e.clientX, e.clientY, items, "Input Menu");
        return;
      }

      // 3. Session item in sidebar
      const sessionEl = target.closest<HTMLElement>("[data-context-menu='session']");
      if (sessionEl) {
        const sessionId = sessionEl.getAttribute("data-session-id");
        const sessionName = sessionEl.getAttribute("data-session-name") || "";
        const sessionCwd = sessionEl.getAttribute("data-session-cwd") || "";
        const hasChildren = sessionEl.getAttribute("data-session-has-children") === "true";

        if (sessionId) {
          if (actions.onRenameSession) {
            items.push({
              id: "rename-session",
              label: t("contextMenu.renameSession"),
              icon: <Pencil size={14} />,
              onSelect: () => actions.onRenameSession?.(sessionId, sessionName),
            });
          }

          if (actions.onForkSession) {
            items.push({
              id: "fork-session",
              label: t("contextMenu.forkSession"),
              icon: <GitFork size={14} />,
              onSelect: () => actions.onForkSession?.(sessionId),
            });
          }

          if (actions.onExportSession) {
            items.push({
              id: "export-session",
              label: t("contextMenu.exportHtml"),
              icon: <ExternalLink size={14} />,
              onSelect: () => actions.onExportSession?.(sessionId),
            });
          }

          items.push({ type: "separator" });

          items.push({
            id: "copy-session-id",
            label: t("contextMenu.copySessionId"),
            icon: <Copy size={14} />,
            onSelect: async () => {
              await copyText(sessionId);
              toast.success(t("contextMenu.copied"));
            },
          });

          if (sessionCwd) {
            items.push({
              id: "copy-session-path",
              label: t("contextMenu.copySessionPath"),
              icon: <Folder size={14} />,
              onSelect: async () => {
                await copyText(sessionCwd);
                toast.success(t("contextMenu.copied"));
              },
            });
          }

          items.push({ type: "separator" });

          if (actions.onArchiveSession) {
            items.push({
              id: "archive-session",
              label: t("contextMenu.archiveSession"),
              icon: <Archive size={14} />,
              disabled: hasChildren,
              onSelect: () => actions.onArchiveSession?.(sessionId),
            });
          }

          if (actions.onDeleteSession) {
            items.push({
              id: "delete-session",
              label: t("contextMenu.deleteSession"),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => actions.onDeleteSession?.(sessionId),
            });
          }

          showContextMenu(e.clientX, e.clientY, items, "Session Menu");
          return;
        }
      }

      // 4. Project card/row in sidebar
      const projectEl = target.closest<HTMLElement>("[data-context-menu='project']");
      if (projectEl) {
        const projectPath = projectEl.getAttribute("data-project-path");
        if (projectPath) {
          if (actions.onNewSession) {
            items.push({
              id: "project-new-session",
              label: t("contextMenu.newSession"),
              icon: <Plus size={14} />,
              shortcut: "Ctrl+Alt+N",
              onSelect: () => actions.onNewSession?.(projectPath),
            });
          }

          items.push({
            id: "project-copy-path",
            label: t("contextMenu.copyProjectPath"),
            icon: <Copy size={14} />,
            onSelect: async () => {
              await copyText(projectPath);
              toast.success(t("contextMenu.copied"));
            },
          });

          if (actions.onOpenSettings) {
            items.push({
              id: "project-settings-mcp",
              label: "MCP Servers…",
              icon: <Terminal size={14} />,
              onSelect: () => actions.onOpenSettings?.("mcp"),
            });
            items.push({
              id: "project-settings-skills",
              label: "Skills…",
              icon: <Sparkles size={14} />,
              onSelect: () => actions.onOpenSettings?.("skills"),
            });
          }

          if (actions.onHideProject) {
            items.push({ type: "separator" });
            items.push({
              id: "project-hide",
              label: t("contextMenu.hideProject"),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => actions.onHideProject?.(projectPath),
            });
          }

          showContextMenu(e.clientX, e.clientY, items, "Project Menu");
          return;
        }
      }

      // 5. File Explorer item (file / folder)
      const fileEl = target.closest<HTMLElement>("[data-context-menu='file']");
      if (fileEl) {
        const filePath = fileEl.getAttribute("data-file-path");
        const fileName = fileEl.getAttribute("data-file-name") || "";
        const isDir = fileEl.getAttribute("data-file-is-dir") === "true";
        const relativePath = fileEl.getAttribute("data-file-relative") || fileName;

        if (filePath) {
          if (!isDir && actions.onOpenFile) {
            items.push({
              id: "open-file",
              label: t("contextMenu.openFile"),
              icon: <FolderOpen size={14} />,
              onSelect: () => actions.onOpenFile?.(filePath, fileName),
            });
          }

          items.push({
            id: "copy-rel-path",
            label: t("contextMenu.copyRelativePath"),
            icon: <Copy size={14} />,
            onSelect: async () => {
              await copyText(relativePath);
              toast.success(t("contextMenu.copied"));
            },
          });

          items.push({
            id: "copy-abs-path",
            label: t("contextMenu.copyAbsolutePath"),
            icon: <Folder size={14} />,
            onSelect: async () => {
              await copyText(filePath);
              toast.success(t("contextMenu.copied"));
            },
          });

          if (actions.onInsertMention) {
            items.push({ type: "separator" });
            items.push({
              id: "insert-mention",
              label: t("contextMenu.insertMention"),
              icon: <AtSign size={14} />,
              onSelect: () => {
                const mention = isDir ? `@${relativePath}/` : `@${relativePath}`;
                actions.onInsertMention?.(mention);
              },
            });
          }

          showContextMenu(e.clientX, e.clientY, items, isDir ? "Folder Menu" : "File Menu");
          return;
        }
      }

      // 6. TabBar tab
      const tabEl = target.closest<HTMLElement>("[data-context-menu='tab']");
      if (tabEl) {
        const tabId = tabEl.getAttribute("data-tab-id");
        const tabFilePath = tabEl.getAttribute("data-file-path");

        if (tabId) {
          if (actions.onCloseTab) {
            items.push({
              id: "close-tab",
              label: t("contextMenu.closeTab"),
              icon: <X size={14} />,
              onSelect: () => actions.onCloseTab?.(tabId),
            });
          }

          if (actions.onCloseOtherTabs) {
            items.push({
              id: "close-other-tabs",
              label: t("contextMenu.closeOtherTabs"),
              onSelect: () => actions.onCloseOtherTabs?.(tabId),
            });
          }

          if (actions.onCloseTabsToRight) {
            items.push({
              id: "close-tabs-right",
              label: t("contextMenu.closeTabsToRight"),
              onSelect: () => actions.onCloseTabsToRight?.(tabId),
            });
          }

          if (actions.onCloseAllTabs) {
            items.push({ type: "separator" });
            items.push({
              id: "close-all-tabs",
              label: t("contextMenu.closeAllTabs"),
              onSelect: () => actions.onCloseAllTabs?.(),
            });
          }

          if (tabFilePath) {
            items.push({ type: "separator" });
            items.push({
              id: "copy-tab-path",
              label: t("contextMenu.copyAbsolutePath"),
              icon: <Copy size={14} />,
              onSelect: async () => {
                await copyText(tabFilePath);
                toast.success(t("contextMenu.copied"));
              },
            });
          }

          showContextMenu(e.clientX, e.clientY, items, "Tab Menu");
          return;
        }
      }

      // 7. Chat Message / Code Block
      const codeEl = target.closest<HTMLElement>("[data-context-menu='code-block']");
      if (codeEl) {
        const codeText = codeEl.getAttribute("data-code-content") || codeEl.innerText || "";
        if (codeText) {
          items.push({
            id: "copy-code",
            label: t("contextMenu.copyCode"),
            icon: <FileCode size={14} />,
            onSelect: async () => {
              await copyText(codeText);
              toast.success(t("contextMenu.copied"));
            },
          });
          if (actions.onQuoteInChat) {
            items.push({
              id: "quote-code",
              label: t("contextMenu.quoteInChat"),
              icon: <MessageSquare size={14} />,
              onSelect: () => actions.onQuoteInChat?.(`\`\`\`\n${codeText}\n\`\`\``),
            });
          }
          showContextMenu(e.clientX, e.clientY, items, "Code Menu");
          return;
        }
      }

      const messageEl = target.closest<HTMLElement>("[data-context-menu='message']");
      if (messageEl) {
        const messageText = messageEl.getAttribute("data-message-content") || messageEl.innerText || "";
        const entryId = messageEl.getAttribute("data-message-entry-id");

        if (messageText) {
          items.push({
            id: "copy-message",
            label: t("contextMenu.copyMessage"),
            icon: <Copy size={14} />,
            onSelect: async () => {
              await copyText(messageText);
              toast.success(t("contextMenu.copied"));
            },
          });

          if (entryId && actions.onForkSession) {
            items.push({
              id: "fork-from-message",
              label: t("contextMenu.forkSession"),
              icon: <GitFork size={14} />,
              onSelect: () => actions.onForkSession?.("", entryId),
            });
          }

          if (actions.onQuoteInChat) {
            items.push({
              id: "quote-message",
              label: t("contextMenu.quoteInChat"),
              icon: <MessageSquare size={14} />,
              onSelect: () => actions.onQuoteInChat?.(messageText),
            });
          }

          showContextMenu(e.clientX, e.clientY, items, "Message Menu");
          return;
        }
      }

      // 8. Global Desktop App Canvas Fallback
      if (actions.onNewSession) {
        items.push({
          id: "global-new-session",
          label: t("contextMenu.newSession"),
          icon: <Plus size={14} />,
          shortcut: "Ctrl+Alt+N",
          onSelect: () => actions.onNewSession?.(actions.activeCwd || undefined),
        });
      }

      if (actions.onOpenCommandPalette) {
        items.push({
          id: "global-command-palette",
          label: t("contextMenu.commandPalette"),
          icon: <Terminal size={14} />,
          shortcut: `${cmdKey}K`,
          onSelect: () => actions.onOpenCommandPalette?.(),
        });
      }

      items.push({ type: "separator" });

      if (actions.onToggleSidebar) {
        items.push({
          id: "global-toggle-sidebar",
          label: t("contextMenu.toggleSidebar"),
          icon: <PanelLeft size={14} />,
          onSelect: () => actions.onToggleSidebar?.(),
        });
      }

      items.push({
        id: "global-toggle-theme",
        label: t("contextMenu.toggleTheme"),
        icon: isDark ? <Sun size={14} /> : <Moon size={14} />,
        onSelect: () => toggleTheme(),
      });

      if (actions.onOpenSettings) {
        items.push({
          id: "global-settings",
          label: t("contextMenu.settings"),
          icon: <Settings2 size={14} />,
          onSelect: () => actions.onOpenSettings?.(),
        });
      }

      items.push({ type: "separator" });

      items.push({
        id: "global-refresh",
        label: t("contextMenu.refresh"),
        icon: <RefreshCw size={14} />,
        onSelect: () => window.location.reload(),
      });

      showContextMenu(e.clientX, e.clientY, items, "Desktop Menu");
    };

    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, [actions, cmdKey, isDark, showContextMenu, t, toggleTheme]);

  return (
    <ContextMenuCtx.Provider
      value={{
        showContextMenu,
        closeContextMenu,
        isOpen: menuState !== null,
      }}
    >
      {children}
      {menuState && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={menuState.items}
          ariaLabel={menuState.ariaLabel}
          onClose={closeContextMenu}
        />
      )}
    </ContextMenuCtx.Provider>
  );
}
