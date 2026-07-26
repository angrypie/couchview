const MIN_TERMINAL_FONT_SIZE = 6;
const MAX_TERMINAL_FONT_SIZE = 72;

interface TerminalFontShortcutOptions {
  initialFontSize: number;
  isApplePlatform?: boolean;
  onFontSizeChange(fontSize: number): void;
}

function boundedFontSize(fontSize: number): number {
  return Math.max(
    MIN_TERMINAL_FONT_SIZE,
    Math.min(MAX_TERMINAL_FONT_SIZE, fontSize),
  );
}

function applePlatform(navigator: Navigator | undefined): boolean {
  if (!navigator) return false;
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function fontSizeAction(
  event: KeyboardEvent,
  isApplePlatform: boolean,
): "increase" | "decrease" | "reset" | null {
  if (
    event.altKey ||
    event.isComposing ||
    (isApplePlatform
      ? !event.metaKey || event.ctrlKey
      : !event.ctrlKey || event.metaKey)
  ) {
    return null;
  }
  if (
    event.code === "Equal" ||
    event.code === "NumpadAdd" ||
    event.key === "+" ||
    event.key === "="
  ) {
    return "increase";
  }
  if (
    event.code === "Minus" ||
    event.code === "NumpadSubtract" ||
    event.key === "-"
  ) {
    return "decrease";
  }
  if (
    event.code === "Digit0" ||
    event.code === "Numpad0" ||
    event.key === "0"
  ) {
    return "reset";
  }
  return null;
}

export function installTerminalFontShortcuts(
  container: HTMLElement,
  options: TerminalFontShortcutOptions,
): () => void {
  const initialFontSize = boundedFontSize(options.initialFontSize);
  const isApplePlatform = options.isApplePlatform ?? applePlatform(
    container.ownerDocument.defaultView?.navigator,
  );
  let fontSize = initialFontSize;

  const onKeyDown = (event: KeyboardEvent) => {
    const action = fontSizeAction(event, isApplePlatform);
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const nextFontSize = boundedFontSize(
      action === "reset"
        ? initialFontSize
        : fontSize + (action === "increase" ? 1 : -1),
    );
    if (nextFontSize === fontSize) return;
    fontSize = nextFontSize;
    options.onFontSizeChange(fontSize);
  };

  container.addEventListener("keydown", onKeyDown, true);
  return () => container.removeEventListener("keydown", onKeyDown, true);
}
