import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_EDITOR_THEME, EDITOR_THEMES } from "../lib/editor-themes";

interface EditorSettingsState {
  theme: string;
  setTheme: (theme: string) => void;
}

/**
 * Editor preferences, saved in localStorage so they survive a reload.
 * Add more settings here later (font size, tab size, word wrap...).
 */
export const useEditorSettings = create<EditorSettingsState>()(
  persist(
    (set) => ({
      theme: DEFAULT_EDITOR_THEME,
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "onlineide-editor-settings",
      storage: createJSONStorage(() => localStorage),
      // If a saved theme no longer exists, fall back to the default
      merge: (persisted, current) => {
        const saved = persisted as Partial<EditorSettingsState> | undefined;
        const valid = EDITOR_THEMES.some((t) => t.id === saved?.theme);
        return { ...current, ...saved, theme: valid ? saved!.theme! : current.theme };
      },
    }
  )
);