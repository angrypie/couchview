interface TerminalClipboardPasteOptions {
  isApplePlatform?: boolean;
  onPaste(text: string): void;
  readText?: () => Promise<string>;
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
  options: TerminalClipboardPasteOptions,
): () => void {
  const browserNavigator = container.ownerDocument.defaultView?.navigator;
  const isApplePlatform = options.isApplePlatform ?? applePlatform(browserNavigator);
  const canReadText = options.readText !== undefined || Boolean(browserNavigator?.clipboard?.readText);
  const readText = options.readText ?? (() => browserNavigator!.clipboard.readText());

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.code !== "KeyV" ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      (isApplePlatform
        ? !event.metaKey || event.ctrlKey
        : !event.ctrlKey || event.metaKey) ||
      !canReadText
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void readText().then((text) => {
      if (text) options.onPaste(text);
    }).catch(() => {
      // Clipboard reads can be denied by browser or OS policy. Keep the
      // terminal focused and leave its contents unchanged in that case.
    });
  };

  container.addEventListener("keydown", onKeyDown, true);
  return () => container.removeEventListener("keydown", onKeyDown, true);
}
