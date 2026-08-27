export interface MenuPositionOptions {
  clickX: number;
  clickY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}

export interface SubmenuPositionOptions {
  parentRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
  };
  submenuWidth: number;
  submenuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}

export interface PositionResult {
  x: number;
  y: number;
  flippedX?: boolean;
  flippedY?: boolean;
}

/**
 * Calculates clamped viewport coordinates for a context menu popup.
 */
export function calculateMenuPosition(options: MenuPositionOptions): PositionResult {
  const { clickX, clickY, menuWidth, menuHeight, viewportWidth, viewportHeight, padding = 8 } = options;

  let x = clickX;
  let y = clickY;
  let flippedX = false;
  let flippedY = false;

  if (x + menuWidth > viewportWidth - padding) {
    x = Math.max(padding, clickX - menuWidth);
    if (x + menuWidth > viewportWidth - padding) {
      x = Math.max(padding, viewportWidth - menuWidth - padding);
    }
    flippedX = true;
  }

  if (y + menuHeight > viewportHeight - padding) {
    y = Math.max(padding, clickY - menuHeight);
    if (y + menuHeight > viewportHeight - padding) {
      y = Math.max(padding, viewportHeight - menuHeight - padding);
    }
    flippedY = true;
  }

  x = Math.max(padding, Math.min(x, Math.max(padding, viewportWidth - menuWidth - padding)));
  y = Math.max(padding, Math.min(y, Math.max(padding, viewportHeight - menuHeight - padding)));

  return { x, y, flippedX, flippedY };
}

/**
 * Calculates clamped coordinates for a nested submenu.
 */
export function calculateSubmenuPosition(options: SubmenuPositionOptions): PositionResult {
  const { parentRect, submenuWidth, submenuHeight, viewportWidth, viewportHeight, padding = 8 } = options;

  let x = parentRect.right + 2;
  let y = parentRect.top - 4;
  let flippedX = false;
  let flippedY = false;

  // If opening to the right overflows, flip to the left of the parent item
  if (x + submenuWidth > viewportWidth - padding) {
    x = parentRect.left - submenuWidth - 2;
    flippedX = true;
  }

  // If still out of bounds on the left, clamp
  if (x < padding) {
    x = padding;
  }

  // If overflowing vertically at bottom, shift up
  if (y + submenuHeight > viewportHeight - padding) {
    y = Math.max(padding, viewportHeight - submenuHeight - padding);
    flippedY = true;
  }

  if (y < padding) {
    y = padding;
  }

  return { x, y, flippedX, flippedY };
}
