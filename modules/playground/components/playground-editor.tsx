"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Editor, { type Monaco } from "@monaco-editor/react"
import type { editor as MonacoEditor } from "monaco-editor"
import { registerCompletion, type CompletionRegistration } from "monacopilot"

import type { TemplateFile } from "../lib/path-to-json"
import { configureMonaco, defaultEditorOptions, getEditorLanguage, registerEditorThemes } from "../lib/editor-config"
import { useEditorSettings } from "../hooks/useEditorSettings"

// Set to true to see AI completion logs in the browser console
const DEBUG = false

const COMPLETION_ENDPOINT = "/api/code-completion"

export interface RelatedFile {
  /** Path inside the project, e.g. "src/utils.ts" */
  path: string
  content: string
}

interface PlaygroundEditorProps {
  // The open file; its `id` (full path) gives each file its own editor model
  activeFile: (TemplateFile & { id?: string }) | undefined
  content: string
  onContentChange: (value: string) => void
  /** AI inline completions on/off (the AI toggle in the header) */
  aiEnabled: boolean
  /** Told when a completion request starts and finishes, for the header spinner */
  onAILoadingChange?: (loading: boolean) => void
  /** Libraries the project uses, e.g. ["react"], for more relevant completions */
  technologies?: string[]
  /** Other open files the AI can read for context (functions, types, names) */
  relatedFiles?: RelatedFile[]
}

/**
 * The code editor. AI inline completions come from Monacopilot: it watches
 * typing, asks /api/code-completion after a pause, and shows the answer as
 * ghost text. Tab accepts, Esc dismisses, Alt+\ asks for one on demand.
 */
export const PlaygroundEditor = ({
  activeFile,
  content,
  onContentChange,
  aiEnabled,
  onAILoadingChange,
  technologies,
  relatedFiles,
}: PlaygroundEditorProps) => {
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const registrationRef = useRef<CompletionRegistration | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [isRequesting, setIsRequesting] = useState(false)
  const [showAcceptHint, setShowAcceptHint] = useState(false)

  const language = getEditorLanguage(activeFile?.fileExtension || "")
  const filePath =
    activeFile?.id ??
    (activeFile ? [activeFile.filename, activeFile.fileExtension].filter(Boolean).join(".") : undefined)
  // The user's chosen theme; the <Editor theme> prop re-applies it on change
  const editorTheme = useEditorSettings((s) => s.theme)

  // Latest values for callbacks that are created once
  const latestRef = useRef({ onAILoadingChange, filePath, technologies, relatedFiles })
  latestRef.current = { onAILoadingChange, filePath, technologies, relatedFiles }

  // Ghost text needs Monaco's inline suggestions turned on
  const editorOptions = useMemo<MonacoEditor.IStandaloneEditorConstructionOptions>(
    () => ({
      ...defaultEditorOptions,
      inlineSuggest: { enabled: true, showToolbar: "onHover" },
    }),
    [],
  )

  // Report loading to the header (and clear it if we unmount mid-request)
  useEffect(() => {
    onAILoadingChange?.(isRequesting)
  }, [isRequesting, onAILoadingChange])

  // ---- Monacopilot registration -------------------------------------------
  // Re-registered when the language changes, because Monaco attaches the
  // completion provider to one language. File name, libraries and related
  // files change more often; they are updated in place below.
  useEffect(() => {
    const monaco = monacoRef.current
    if (!editor || !monaco || !aiEnabled) return

    const { filePath, technologies, relatedFiles } = latestRef.current

    const registration = registerCompletion(monaco, editor, {
      language,
      filename: filePath,
      technologies,
      relatedFiles,
      endpoint: COMPLETION_ENDPOINT,
      trigger: "onIdle", // ask after a short pause in typing, not on every key
      maxContextLines: 120, // lines of code around the cursor sent to the AI
      enableCaching: true, // reuse an answer when returning to the same spot

      // Our own fetch, so a new request cancels the previous one (saving
      // quota) and server errors come back as readable messages
      requestHandler: async ({ body }) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setIsRequesting(true)

        try {
          const res = await fetch(COMPLETION_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
          const data = await res.json().catch(() => null)
          if (!res.ok) {
            return { completion: null, error: data?.error || `Completion failed (${res.status})` }
          }
          return { completion: data?.completion ?? null, error: data?.error }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null
            setIsRequesting(false)
          }
        }
      },

      onCompletionShown: () => setShowAcceptHint(true),
      onCompletionAccepted: () => setShowAcceptHint(false),
      onCompletionRejected: () => setShowAcceptHint(false),
      onError: (error) => {
        if (DEBUG) console.warn("[AI completion]", error)
      },
    })

    registrationRef.current = registration

    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      setIsRequesting(false)
      setShowAcceptHint(false)
      registration.deregister()
      registrationRef.current = null
    }
  }, [editor, aiEnabled, language])

  // Keep the completion context current without re-registering
  useEffect(() => {
    registrationRef.current?.updateOptions(() => ({
      filename: filePath,
      technologies,
      relatedFiles,
    }))
  }, [filePath, technologies, relatedFiles])

  // ---- Editor setup --------------------------------------------------------
  const handleEditorDidMount = (
    instance: MonacoEditor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    monacoRef.current = monaco
    configureMonaco(monaco)

    // Alt+\ asks for a completion right away (same shortcut as VS Code).
    // Ctrl+Space keeps Monaco's normal autocomplete list.
    instance.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Backslash, () => {
      registrationRef.current?.trigger()
    })

    // The ghost text disappears when the cursor moves or the text changes
    instance.onDidChangeCursorPosition(() => setShowAcceptHint(false))

    setEditor(instance)
  }

  // Cancel any in-flight request when the editor goes away, and clear the
  // header spinner (the effect above can't run after unmounting)
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      latestRef.current.onAILoadingChange?.(false)
    }
  }, [])

  return (
    <div className="h-full relative">
      {aiEnabled && isRequesting && (
        <div className="pointer-events-none absolute top-2 right-4 z-10 flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          AI thinking…
        </div>
      )}

      {aiEnabled && showAcceptHint && !isRequesting && (
        <div className="pointer-events-none absolute top-2 right-4 z-10 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          <kbd className="font-mono text-foreground">Tab</kbd> accept ·{" "}
          <kbd className="font-mono text-foreground">Esc</kbd> dismiss
        </div>
      )}

      <Editor
        height="100%"
        value={content}
        onChange={(value) => onContentChange(value || "")}
        beforeMount={registerEditorThemes}
        onMount={handleEditorDidMount}
        theme={editorTheme}
        // One model per file: undo history and cursor stay with each file
        path={activeFile?.id}
        language={activeFile ? language : "plaintext"}
        options={editorOptions}
      />
    </div>
  )
}