import type { editor } from "monaco-editor";
import type { ITheme } from "@xterm/xterm";

/**
 * Every editor theme in one place. Each entry describes:
 * - how Monaco should color code (`monaco`, or a built-in theme when omitted)
 * - which colors the terminal should use, so the two panels match
 *
 * To add a theme: append an entry here. Nothing else needs to change.
 */
export interface EditorThemeDef {
  id: string;
  label: string;
  kind: "light" | "dark";
  /** Omit for Monaco's built-in themes (vs, vs-dark, hc-black, hc-light) */
  monaco?: editor.IStandaloneThemeData;
  /** Merged over the light or dark terminal palette */
  terminal: Pick<ITheme, "background" | "foreground" | "cursor" | "selectionBackground">;
}

/** Small helper so each theme only lists the colors that make it distinct */
function makeTheme(
  base: "vs" | "vs-dark",
  c: {
    bg: string;
    fg: string;
    comment: string;
    keyword: string;
    string: string;
    number: string;
    fn: string;
    type: string;
    lineNumber: string;
    lineNumberActive: string;
    selection: string;
    lineHighlight: string;
    cursor: string;
    widget: string;
    border: string;
  }
): editor.IStandaloneThemeData {
  const strip = (hex: string) => hex.replace("#", "");
  return {
    base,
    inherit: true,
    rules: [
      { token: "comment", foreground: strip(c.comment), fontStyle: "italic" },
      { token: "keyword", foreground: strip(c.keyword) },
      { token: "keyword.control", foreground: strip(c.keyword) },
      { token: "storage.type", foreground: strip(c.keyword) },
      { token: "string", foreground: strip(c.string) },
      { token: "number", foreground: strip(c.number) },
      { token: "constant", foreground: strip(c.number) },
      { token: "entity.name.function", foreground: strip(c.fn) },
      { token: "support.function", foreground: strip(c.fn) },
      { token: "type", foreground: strip(c.type) },
      { token: "entity.name.type", foreground: strip(c.type) },
      { token: "tag", foreground: strip(c.keyword) },
      { token: "attribute.name", foreground: strip(c.fn) },
      { token: "attribute.value", foreground: strip(c.string) },
      { token: "delimiter", foreground: strip(c.fg) },
    ],
    colors: {
      "editor.background": c.bg,
      "editor.foreground": c.fg,
      "editorLineNumber.foreground": c.lineNumber,
      "editorLineNumber.activeForeground": c.lineNumberActive,
      "editorCursor.foreground": c.cursor,
      "editor.selectionBackground": c.selection,
      "editor.lineHighlightBackground": c.lineHighlight,
      "editor.lineHighlightBorder": c.lineHighlight,
      "editorGutter.background": c.bg,
      "minimap.background": c.bg,
      "editorSuggestWidget.background": c.widget,
      "editorSuggestWidget.border": c.border,
      "editorHoverWidget.background": c.widget,
      "editorHoverWidget.border": c.border,
      "editorWidget.background": c.widget,
      "editorWidget.border": c.border,
      "editorIndentGuide.background1": c.lineHighlight,
      "editorIndentGuide.activeBackground1": c.border,
    },
  };
}

export const EDITOR_THEMES: EditorThemeDef[] = [
  {
    id: "modern-dark",
    label: "OnlineIDE Dark",
    kind: "dark",
    // Your original theme, unchanged; its full definition lives in editor-config.ts
    terminal: { background: "#0D1117", foreground: "#E6EDF3", cursor: "#F0F6FC", selectionBackground: "#264F78" },
  },
  {
    id: "onlineide-light",
    label: "OnlineIDE Light",
    kind: "light",
    monaco: makeTheme("vs", {
      bg: "#FFFFFF", fg: "#1F2328", comment: "#6E7781", keyword: "#CF222E",
      string: "#0A3069", number: "#0550AE", fn: "#8250DF", type: "#953800",
      lineNumber: "#8C959F", lineNumberActive: "#1F2328", selection: "#DDEBFF",
      lineHighlight: "#F6F8FA", cursor: "#1F2328", widget: "#FFFFFF", border: "#D0D7DE",
    }),
    terminal: { background: "#FFFFFF", foreground: "#1F2328", cursor: "#1F2328", selectionBackground: "#DDEBFF" },
  },
  {
    id: "dracula",
    label: "Dracula",
    kind: "dark",
    monaco: makeTheme("vs-dark", {
      bg: "#282A36", fg: "#F8F8F2", comment: "#6272A4", keyword: "#FF79C6",
      string: "#F1FA8C", number: "#BD93F9", fn: "#50FA7B", type: "#8BE9FD",
      lineNumber: "#6272A4", lineNumberActive: "#F8F8F2", selection: "#44475A",
      lineHighlight: "#323442", cursor: "#F8F8F2", widget: "#21222C", border: "#44475A",
    }),
    terminal: { background: "#282A36", foreground: "#F8F8F2", cursor: "#F8F8F2", selectionBackground: "#44475A" },
  },
  {
    id: "monokai",
    label: "Monokai",
    kind: "dark",
    monaco: makeTheme("vs-dark", {
      bg: "#272822", fg: "#F8F8F2", comment: "#75715E", keyword: "#F92672",
      string: "#E6DB74", number: "#AE81FF", fn: "#A6E22E", type: "#66D9EF",
      lineNumber: "#90908A", lineNumberActive: "#F8F8F2", selection: "#49483E",
      lineHighlight: "#3E3D32", cursor: "#F8F8F0", widget: "#1E1F1C", border: "#414339",
    }),
    terminal: { background: "#272822", foreground: "#F8F8F2", cursor: "#F8F8F0", selectionBackground: "#49483E" },
  },
  {
    id: "nord",
    label: "Nord",
    kind: "dark",
    monaco: makeTheme("vs-dark", {
      bg: "#2E3440", fg: "#D8DEE9", comment: "#616E88", keyword: "#81A1C1",
      string: "#A3BE8C", number: "#B48EAD", fn: "#88C0D0", type: "#8FBCBB",
      lineNumber: "#4C566A", lineNumberActive: "#D8DEE9", selection: "#434C5E",
      lineHighlight: "#3B4252", cursor: "#D8DEE9", widget: "#3B4252", border: "#4C566A",
    }),
    terminal: { background: "#2E3440", foreground: "#D8DEE9", cursor: "#D8DEE9", selectionBackground: "#434C5E" },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    kind: "light",
    monaco: makeTheme("vs", {
      bg: "#FDF6E3", fg: "#586E75", comment: "#93A1A1", keyword: "#859900",
      string: "#2AA198", number: "#D33682", fn: "#268BD2", type: "#B58900",
      lineNumber: "#93A1A1", lineNumberActive: "#586E75", selection: "#EEE8D5",
      lineHighlight: "#EEE8D5", cursor: "#586E75", widget: "#EEE8D5", border: "#D3CBB7",
    }),
    terminal: { background: "#FDF6E3", foreground: "#586E75", cursor: "#586E75", selectionBackground: "#EEE8D5" },
  },
  {
    id: "hc-black",
    label: "High Contrast",
    kind: "dark",
    // Built into Monaco, so no definition needed
    terminal: { background: "#000000", foreground: "#FFFFFF", cursor: "#FFFFFF", selectionBackground: "#FFFFFF55" },
  },
];

export const DEFAULT_EDITOR_THEME = "modern-dark";

export function getEditorTheme(id: string): EditorThemeDef {
  return EDITOR_THEMES.find((t) => t.id === id) ?? EDITOR_THEMES[0];
}