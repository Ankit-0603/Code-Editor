import { useState, useCallback, useRef, useEffect } from "react";

interface AISuggestionsState {
  suggestion: string | null;
  isLoading: boolean;
  position: { line: number; column: number } | null;
  decoration: string[];
  isEnabled: boolean;
}

interface UseAISuggestionsReturn extends AISuggestionsState {
  toggleEnabled: () => void;
  fetchSuggestion: (type: string, editor: any) => Promise<void>;
  acceptSuggestion: (editor: any, monaco: any) => void;
  rejectSuggestion: (editor: any) => void;
  clearSuggestion: (editor: any) => void;
}

const EMPTY_SUGGESTION = { suggestion: null, position: null, decoration: [] as string[] };

export const useAISuggestions = (): UseAISuggestionsReturn => {
  const [state, setState] = useState<AISuggestionsState>({
    ...EMPTY_SUGGESTION,
    isLoading: false,
    isEnabled: true,
  });

  // Refs, so fetchSuggestion can check these without running code inside setState
  const enabledRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // Cancel any in-flight request when the page unmounts
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggleEnabled = useCallback(() => {
    enabledRef.current = !enabledRef.current;
    const enabled = enabledRef.current;
    if (!enabled) abortRef.current?.abort();
    setState((prev) =>
      enabled
        ? { ...prev, isEnabled: true }
        : { ...prev, ...EMPTY_SUGGESTION, isEnabled: false, isLoading: false }
    );
  }, []);

  const fetchSuggestion = useCallback(async (type: string, editor: any) => {
    if (!enabledRef.current || !editor) return;

    const model = editor.getModel();
    const cursorPosition = editor.getPosition();
    if (!model || !cursorPosition) return;

    // Only the newest request matters: cancel the previous one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const response = await fetch("/api/code-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent: model.getValue(),
          cursorLine: cursorPosition.lineNumber - 1,
          cursorColumn: cursorPosition.column - 1,
          suggestionType: type,
          // The editor model's path is the file path (e.g. "/src/index.js"),
          // which lets the server detect the language from the extension
          fileName: model.uri?.path?.replace(/^\//, "") || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();

      // A newer request started, or AI was switched off, while we waited
      if (requestId !== requestIdRef.current || !enabledRef.current) return;

      // Only show the suggestion if the cursor is still where we asked
      const now = editor.getPosition();
      const cursorMoved =
        !now ||
        now.lineNumber !== cursorPosition.lineNumber ||
        now.column !== cursorPosition.column;

      const suggestionText =
        typeof data.suggestion === "string" ? data.suggestion.trim() : "";

      if (!suggestionText) console.warn("No suggestion received from API.");

      setState((prev) =>
        suggestionText && !cursorMoved
          ? {
              ...prev,
              isLoading: false,
              suggestion: suggestionText,
              position: { line: cursorPosition.lineNumber, column: cursorPosition.column },
            }
          : { ...prev, isLoading: false }
      );
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return; // replaced by a newer request
      console.error("Error fetching code suggestion:", error);
      if (requestId === requestIdRef.current) {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    }
  }, []);

  const clearSuggestion = useCallback((editor: any) => {
    setState((currentState) => {
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }
      return { ...currentState, ...EMPTY_SUGGESTION };
    });
  }, []);

  // The editor inserts the accepted text itself, so here we only clear the
  // suggestion. (The old version wrapped its code in a function that was never
  // called, so accepting never cleared the suggestion.)
  const acceptSuggestion = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (editor: any, _monaco: any) => clearSuggestion(editor),
    [clearSuggestion]
  );

  const rejectSuggestion = useCallback(
    (editor: any) => clearSuggestion(editor),
    [clearSuggestion]
  );

  return {
    ...state,
    toggleEnabled,
    fetchSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    clearSuggestion,
  };
};