interface TerminalClipboardPasteOptions {
  isApplePlatform?: boolean;
}

function applePlatform(navigator: Navigator | undefined): boolean {
  if (!navigator) return false;
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function installTerminalClipboardPaste(
  container: HTMLElement,
  options: TerminalClipboardPasteOptions = {},
): () => void {
  const browserNavigator = container.ownerDocument.defaultView?.navigator;
  const isApplePlatform = options.isApplePlatform ?? applePlatform(browserNavigator);

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() !== "v" ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      (isApplePlatform
        ? !event.metaKey || event.ctrlKey
        : !event.ctrlKey || event.metaKey)
    ) {
      return;
    }

    // ghostty-web 0.4 recognizes paste by the physical KeyV code. Stop its
    // key encoder for layouts where the V character lives on another key,
    // but preserve the browser default so it can dispatch a trusted paste
    // event without requesting Clipboard API access.
    event.stopImmediatePropagation();
  };

  container.addEventListener("keydown", onKeyDown, true);
  return () => container.removeEventListener("keydown", onKeyDown, true);
}
