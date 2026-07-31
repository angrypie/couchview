export interface TerminalKeyInput {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

const KEY_CODES: Readonly<Record<string, string>> = {
  " ": "Space",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  Backspace: "Backspace",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Escape: "Escape",
  Home: "Home",
  Insert: "Insert",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Tab: "Tab",
  "'": "Quote",
  ",": "Comma",
  "-": "Minus",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "=": "Equal",
  "[": "BracketLeft",
  "\\": "Backslash",
  "]": "BracketRight",
  "`": "Backquote",
};

export function terminalKeyboardCode(key: string, code = ""): string {
  if (code) return code;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return KEY_CODES[key] ?? "";
}

export function terminalControlCharacter(key: string): string | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  const codePoint = upper.charCodeAt(0);
  if (codePoint >= 0x40 && codePoint <= 0x5f) {
    return String.fromCharCode(codePoint & 0x1f);
  }
  switch (key) {
    case " ":
    case "2":
      return "\x00";
    case "3":
      return "\x1b";
    case "4":
      return "\x1c";
    case "5":
      return "\x1d";
    case "6":
      return "\x1e";
    case "7":
      return "\x1f";
    case "8":
    case "?":
      return "\x7f";
    default:
      return null;
  }
}

export function terminalModifierOnlyKey(key: string): boolean {
  return [
    "Alt",
    "AltGraph",
    "CapsLock",
    "Control",
    "Dead",
    "Meta",
    "NumLock",
    "Process",
    "Shift",
    "Unidentified",
  ].includes(key);
}
