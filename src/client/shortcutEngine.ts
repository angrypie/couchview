import { useCallback, useEffect, useRef, useState } from "react";

import {
  COMMAND_IDS,
  shortcutSequenceKey,
  type CommandId,
  type ShortcutModifier,
  type ShortcutSequence,
  type ShortcutStroke,
} from "../shared/settings.ts";
import type { RuntimeCommand } from "./commands.ts";

const SHORTCUT_TIMEOUT_MS = 1_000;

function applePlatform(navigatorValue: Navigator | undefined): boolean {
  if (!navigatorValue) return false;
  const userAgentData = (navigatorValue as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform = userAgentData?.platform ||
    navigatorValue.platform ||
    navigatorValue.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function normalizedKey(event: KeyboardEvent): string | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === "Dead" ||
    event.key === "Process" ||
    [
      "Alt",
      "AltGraph",
      "Control",
      "Fn",
      "FnLock",
      "Hyper",
      "Meta",
      "OS",
      "Shift",
      "Super",
      "Symbol",
      "SymbolLock",
    ].includes(event.key)
  ) {
    return null;
  }
  if (event.key === " ") return "Space";
  if (event.key === "Esc") return "Escape";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function shortcutStrokeFromEvent(
  event: KeyboardEvent,
  isApple = applePlatform(event.view?.navigator),
): ShortcutStroke | null {
  const key = normalizedKey(event);
  if (!key) return null;
  const modifiers: ShortcutModifier[] = [];
  const primary = isApple ? event.metaKey : event.ctrlKey;
  if (primary) modifiers.push("mod");
  if (event.ctrlKey && isApple) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey && !isApple) modifiers.push("meta");
  return { key, modifiers };
}

function strokesEqual(left: ShortcutStroke, right: ShortcutStroke): boolean {
  return shortcutSequenceKey([left]) === shortcutSequenceKey([right]);
}

function isPrefix(
  prefix: readonly ShortcutStroke[],
  sequence: ShortcutSequence,
): boolean {
  return prefix.length <= sequence.length &&
    prefix.every((item, index) => strokesEqual(item, sequence[index]!));
}

function isTypingSurface(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable=true], [data-shortcut-capture]",
  ));
}

function keyLabel(key: string): string {
  const labels: Record<string, string> = {
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    Escape: "Esc",
    Space: "Space",
  };
  return labels[key] ?? (key.length === 1 ? key.toLocaleUpperCase() : key);
}

export function formatShortcut(
  sequence: ShortcutSequence | null,
  isApple = applePlatform(typeof navigator === "undefined" ? undefined : navigator),
): string {
  if (!sequence || sequence.length === 0) return "Unassigned";
  return sequence.map((stroke) => {
    const modifiers = stroke.modifiers.map((modifier) => {
      if (modifier === "mod") return isApple ? "⌘" : "Ctrl";
      if (modifier === "ctrl") return "Ctrl";
      if (modifier === "alt") return isApple ? "⌥" : "Alt";
      if (modifier === "shift") return isApple ? "⇧" : "Shift";
      return isApple ? "⌘" : "Meta";
    });
    return [...modifiers, keyLabel(stroke.key)].join(isApple ? "" : "+");
  }).join(" ");
}

interface ShortcutEngineOptions {
  bindings: Record<CommandId, ShortcutSequence | null>;
  commands: Record<CommandId, RuntimeCommand>;
  paletteOpen: boolean;
  recording: boolean;
  restricted: boolean;
}

export interface ShortcutEngineResult {
  pending: ShortcutSequence;
  clearPending(): void;
}

export function useShortcutEngine({
  bindings,
  commands,
  paletteOpen,
  recording,
  restricted,
}: ShortcutEngineOptions): ShortcutEngineResult {
  const [pending, setPending] = useState<ShortcutSequence>([]);
  const timeoutRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setPending([]);
  }, []);

  useEffect(
    () => clearPending(),
    [bindings, clearPending, paletteOpen, recording, restricted],
  );

  useEffect(() => {
    const onBlur = () => clearPending();
    const onKeyDown = (event: KeyboardEvent) => {
      if (recording) return;
      if (event.key === "Escape" && pending.length > 0) {
        event.preventDefault();
        clearPending();
        return;
      }
      const stroke = shortcutStrokeFromEvent(event);
      if (!stroke) return;
      const typing = isTypingSurface(event.target);
      const onlyPalette = restricted || typing || paletteOpen;
      const candidateIds = onlyPalette
        ? (["palette.open"] as CommandId[])
        : [...COMMAND_IDS];
      let nextPending = [...pending, stroke];
      let candidates = candidateIds.filter((commandId) => {
        const binding = bindings[commandId];
        return binding ? isPrefix(nextPending, binding) : false;
      });
      if (candidates.length === 0 && pending.length > 0) {
        nextPending = [stroke];
        candidates = candidateIds.filter((commandId) => {
          const binding = bindings[commandId];
          return binding ? isPrefix(nextPending, binding) : false;
        });
      }
      if (candidates.length === 0) {
        clearPending();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const exactId = candidates.find((commandId) => {
        const binding = bindings[commandId];
        return binding?.length === nextPending.length;
      });
      if (exactId) {
        const command = commands[exactId];
        clearPending();
        if (event.repeat && (!command.repeatable || nextPending.length > 1)) return;
        if (command.enabled) command.perform();
        return;
      }
      if (event.repeat) {
        clearPending();
        return;
      }
      setPending(nextPending);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(clearPending, SHORTCUT_TIMEOUT_MS);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    bindings,
    clearPending,
    commands,
    paletteOpen,
    pending,
    recording,
    restricted,
  ]);

  return { pending, clearPending };
}
