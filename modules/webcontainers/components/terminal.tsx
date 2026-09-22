"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
// Type-only imports: the real xterm code is loaded in the browser inside useEffect,
// because xterm touches `window`/`self` on import and would crash Next.js SSR.
import type { Terminal, ITheme } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Copy, Trash2, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalProps {
  webcontainerUrl?: string; // kept for compatibility, currently unused
  className?: string;
  theme?: "dark" | "light";
  webContainerInstance?: WebContainer | null;
}

// Methods exposed through the ref
export interface TerminalRef {
  writeToTerminal: (data: string) => void;
  clearTerminal: () => void;
  focusTerminal: () => void;
}

const TERMINAL_THEMES: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#09090B",
    foreground: "#FAFAFA",
    cursor: "#FAFAFA",
    cursorAccent: "#09090B",
    selectionBackground: "#27272A", // `selection` was renamed in xterm 5+
    black: "#18181B",
    red: "#EF4444",
    green: "#22C55E",
    yellow: "#EAB308",
    blue: "#3B82F6",
    magenta: "#A855F7",
    cyan: "#06B6D4",
    white: "#F4F4F5",
    brightBlack: "#3F3F46",
    brightRed: "#F87171",
    brightGreen: "#4ADE80",
    brightYellow: "#FDE047",
    brightBlue: "#60A5FA",
    brightMagenta: "#C084FC",
    brightCyan: "#22D3EE",
    brightWhite: "#FFFFFF",
  },
  light: {
    background: "#FFFFFF",
    foreground: "#18181B",
    cursor: "#18181B",
    cursorAccent: "#FFFFFF",
    selectionBackground: "#E4E4E7",
    black: "#18181B",
    red: "#DC2626",
    green: "#16A34A",
    yellow: "#CA8A04",
    blue: "#2563EB",
    magenta: "#9333EA",
    cyan: "#0891B2",
    white: "#F4F4F5",
    brightBlack: "#71717A",
    brightRed: "#EF4444",
    brightGreen: "#22C55E",
    brightYellow: "#EAB308",
    brightBlue: "#3B82F6",
    brightMagenta: "#A855F7",
    brightCyan: "#06B6D4",
    brightWhite: "#FAFAFA",
  },
};

const PROMPT = "$ ";

const TerminalComponent = forwardRef<TerminalRef, TerminalProps>(
  ({ className, theme = "dark", webContainerInstance }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const term = useRef<Terminal | null>(null);
    const fitAddon = useRef<FitAddon | null>(null);
    const searchAddon = useRef<SearchAddon | null>(null);
    // Output written before xterm finished loading is kept here and flushed later
    const pendingWrites = useRef<string[]>([]);

    const [isReady, setIsReady] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [showSearch, setShowSearch] = useState(false);

    // Command line state
    const currentLine = useRef("");
    const commandHistory = useRef<string[]>([]);
    const historyIndex = useRef(-1);
    const currentProcess = useRef<WebContainerProcess | null>(null);
    const processInput = useRef<WritableStreamDefaultWriter<string> | null>(null);

    // Latest values in refs, so the xterm input handler never sees stale ones
    // and the terminal never has to be re-created when they change.
    const instanceRef = useRef<WebContainer | null>(webContainerInstance ?? null);
    const themeRef = useRef(theme);
    useEffect(() => {
      instanceRef.current = webContainerInstance ?? null;
    }, [webContainerInstance]);

    const write = useCallback((data: string) => {
      if (term.current) {
        term.current.write(data);
      } else {
        pendingWrites.current.push(data);
      }
    }, []);

    const writePrompt = useCallback(() => {
      write("\r\n" + PROMPT);
      currentLine.current = "";
    }, [write]);

    const clearTerminal = useCallback(() => {
      if (!term.current) return;
      term.current.clear();
      term.current.writeln("🚀 WebContainer Terminal");
      writePrompt();
    }, [writePrompt]);

    useImperativeHandle(
      ref,
      () => ({
        writeToTerminal: write,
        clearTerminal,
        focusTerminal: () => term.current?.focus(),
      }),
      [write, clearTerminal]
    );

    // Replace the text typed after the prompt (used by history navigation)
    const replaceLine = (text: string) => {
      const t = term.current;
      if (!t) return;
      t.write(
        "\r" + PROMPT + " ".repeat(currentLine.current.length) + "\r" + PROMPT + text
      );
      currentLine.current = text;
    };

    const executeCommand = async (command: string) => {
      const t = term.current;
      if (!t) return;

      const trimmed = command.trim();
      if (trimmed && commandHistory.current.at(-1) !== trimmed) {
        commandHistory.current.push(trimmed);
      }
      historyIndex.current = -1;

      // Built-in commands
      if (trimmed === "") {
        writePrompt();
        return;
      }
      if (trimmed === "clear") {
        t.clear();
        writePrompt();
        return;
      }
      if (trimmed === "history") {
        t.writeln("");
        commandHistory.current.forEach((cmd, index) => {
          t.writeln(`  ${index + 1}  ${cmd}`);
        });
        writePrompt();
        return;
      }
      if (trimmed === "help") {
        t.writeln("");
        t.writeln("Built-in commands:");
        t.writeln("  help      Show this message");
        t.writeln("  clear     Clear the terminal");
        t.writeln("  history   Show command history");
        t.writeln("Anything else runs inside the WebContainer (e.g. npm, node, ls).");
        t.writeln("Press Ctrl+C to stop a running command.");
        writePrompt();
        return;
      }

      const instance = instanceRef.current;
      if (!instance) {
        t.writeln("");
        t.writeln("⏳ WebContainer is still starting, please wait...");
        writePrompt();
        return;
      }

      const [cmd, ...args] = trimmed.split(/\s+/);
      t.writeln("");

      try {
        const proc = await instance.spawn(cmd, args, {
          terminal: { cols: t.cols, rows: t.rows },
        });
        currentProcess.current = proc;
        processInput.current = proc.input.getWriter();

        proc.output
          .pipeTo(
            new WritableStream({
              write(data) {
                term.current?.write(data);
              },
            })
          )
          .catch(() => {});

        await proc.exit;
      } catch {
        term.current?.writeln(`Command not found: ${cmd}`);
      } finally {
        processInput.current?.releaseLock();
        processInput.current = null;
        currentProcess.current = null;
        writePrompt();
      }
    };

    const handleTerminalInput = (data: string) => {
      const t = term.current;
      if (!t) return;

      // While a command runs, keystrokes go to that process (so interactive
      // prompts like `npm init` work). Ctrl+C stops it.
      if (currentProcess.current) {
        if (data === "\u0003") {
          t.write("^C");
          currentProcess.current.kill();
          return;
        }
        processInput.current?.write(data).catch(() => {});
        return;
      }

      switch (data) {
        case "\r": // Enter
          void executeCommand(currentLine.current);
          break;

        case "\u007F": // Backspace
          if (currentLine.current.length > 0) {
            currentLine.current = currentLine.current.slice(0, -1);
            t.write("\b \b");
          }
          break;

        case "\u0003": // Ctrl+C with nothing running
          t.write("^C");
          writePrompt();
          break;

        case "\u001b[A": // Up arrow
          if (commandHistory.current.length > 0) {
            if (historyIndex.current === -1) {
              historyIndex.current = commandHistory.current.length - 1;
            } else if (historyIndex.current > 0) {
              historyIndex.current--;
            }
            replaceLine(commandHistory.current[historyIndex.current]);
          }
          break;

        case "\u001b[B": // Down arrow
          if (historyIndex.current !== -1) {
            if (historyIndex.current < commandHistory.current.length - 1) {
              historyIndex.current++;
              replaceLine(commandHistory.current[historyIndex.current]);
            } else {
              historyIndex.current = -1;
              replaceLine("");
            }
          }
          break;

        default: {
          // Ignore other escape sequences (left/right arrows etc.)
          if (data.startsWith("\u001b")) break;
          // Typed or pasted text: keep printable characters only
          // eslint-disable-next-line no-control-regex
          const printable = data.replace(/[\x00-\x1f\x7f]/g, "");
          if (printable) {
            currentLine.current += printable;
            t.write(printable);
          }
          break;
        }
      }
    };

    // Always point xterm at the latest handler (it is re-created every render)
    const inputHandlerRef = useRef(handleTerminalInput);
    inputHandlerRef.current = handleTerminalInput;

    // Create the terminal once, in the browser only
    useEffect(() => {
      let disposed = false;
      let resizeObserver: ResizeObserver | null = null;

      (async () => {
        const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { SearchAddon }] =
          await Promise.all([
            import("@xterm/xterm"),
            import("@xterm/addon-fit"),
            import("@xterm/addon-web-links"),
            import("@xterm/addon-search"),
          ]);

        if (disposed || !containerRef.current) return;

        const terminal = new Terminal({
          cursorBlink: true,
          fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
          fontSize: 14,
          lineHeight: 1.2,
          letterSpacing: 0,
          theme: TERMINAL_THEMES[themeRef.current],
          allowTransparency: false,
          convertEol: true,
          scrollback: 1000,
          tabStopWidth: 4,
        });

        const fit = new FitAddon();
        const search = new SearchAddon();
        terminal.loadAddon(fit);
        terminal.loadAddon(new WebLinksAddon());
        terminal.loadAddon(search);
        terminal.open(containerRef.current);

        term.current = terminal;
        fitAddon.current = fit;
        searchAddon.current = search;

        terminal.onData((data) => inputHandlerRef.current(data));
        // Keep a running process's pty size in sync with the terminal
        terminal.onResize(({ cols, rows }) => {
          currentProcess.current?.resize({ cols, rows });
        });

        const safeFit = () => {
          try {
            fitAddon.current?.fit();
          } catch {
            // container not measurable yet (e.g. hidden); ignore
          }
        };
        requestAnimationFrame(safeFit);

        terminal.writeln("🚀 WebContainer Terminal");
        terminal.writeln("Type 'help' for available commands");

        // Flush anything written before the terminal existed
        pendingWrites.current.forEach((data) => terminal.write(data));
        pendingWrites.current = [];
        writePrompt();

        resizeObserver = new ResizeObserver(() => requestAnimationFrame(safeFit));
        resizeObserver.observe(containerRef.current);

        setIsReady(true);
      })();

      return () => {
        disposed = true;
        resizeObserver?.disconnect();
        currentProcess.current?.kill();
        currentProcess.current = null;
        term.current?.dispose();
        term.current = null;
        fitAddon.current = null;
        searchAddon.current = null;
        setIsReady(false);
      };
    }, [writePrompt]);

    // Apply theme changes without re-creating the terminal
    useEffect(() => {
      themeRef.current = theme;
      if (term.current) {
        term.current.options.theme = TERMINAL_THEMES[theme];
      }
    }, [theme, isReady]);

    // Announce the connection once both the terminal and the container exist
    useEffect(() => {
      if (!isReady || !webContainerInstance || isConnected) return;
      setIsConnected(true);
      term.current?.writeln("");
      term.current?.writeln("✅ Connected to WebContainer");
      term.current?.write("Ready to execute commands");
      writePrompt();
    }, [isReady, webContainerInstance, isConnected, writePrompt]);

    const copyTerminalContent = useCallback(async () => {
      const content = term.current?.getSelection();
      if (!content) return;
      try {
        await navigator.clipboard.writeText(content);
      } catch (error) {
        console.error("Failed to copy to clipboard:", error);
      }
    }, []);

    const downloadTerminalLog = useCallback(() => {
      if (!term.current) return;
      const buffer = term.current.buffer.active;
      let content = "";

      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) content += line.translateToString(true) + "\n";
      }

      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `terminal-log-${new Date().toISOString().slice(0, 19)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }, []);

    const searchInTerminal = useCallback((query: string) => {
      if (searchAddon.current && query) {
        searchAddon.current.findNext(query);
      }
    }, []);

    return (
      <div
        className={cn(
          "flex flex-col h-full bg-background border rounded-lg overflow-hidden",
          className
        )}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
            </div>
            <span className="text-sm font-medium">WebContainer Terminal</span>
            {isConnected && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs text-muted-foreground">Connected</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {showSearch && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    searchInTerminal(e.target.value);
                  }}
                  className="h-6 w-32 text-xs"
                />
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSearch(!showSearch)}
              className="h-6 w-6 p-0"
            >
              <Search className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={copyTerminalContent}
              className="h-6 w-6 p-0"
            >
              <Copy className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={downloadTerminalLog}
              className="h-6 w-6 p-0"
            >
              <Download className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={clearTerminal}
              className="h-6 w-6 p-0"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Terminal Content */}
        <div className="flex-1 relative">
          <div
            ref={containerRef}
            className="absolute inset-0 p-2"
            style={{ background: TERMINAL_THEMES[theme].background }}
          />
        </div>
      </div>
    );
  }
);

TerminalComponent.displayName = "TerminalComponent";

export default TerminalComponent;