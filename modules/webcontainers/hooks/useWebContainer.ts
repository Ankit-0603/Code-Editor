import { useState, useEffect, useCallback } from "react";
import { WebContainer } from "@webcontainer/api";
import type { TemplateFolder } from "@/modules/playground/lib/path-to-json";

interface UseWebContainerProps {
  templateData: TemplateFolder | null;
}

interface UseWebContainerReturn {
  serverUrl: string | null;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  destory: () => void;
}

// WebContainer.boot() may only be called ONCE per page. React Strict Mode (dev)
// runs effects twice, which made the second boot() throw. So the boot promise
// lives at module level and every mount shares it.
let bootPromise: Promise<WebContainer> | null = null;
let lastServerUrl: string | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

function getWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = WebContainer.boot().catch((err) => {
      bootPromise = null; // allow a retry after a failed boot
      throw err;
    });
  }
  return bootPromise;
}

function teardownWebContainer() {
  const pending = bootPromise;
  bootPromise = null;
  lastServerUrl = null;
  pending?.then((wc) => wc.teardown()).catch(() => {});
}

// `templateData` is accepted for API compatibility; mounting happens in WebContainerPreview.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useWebContainer = (_props: UseWebContainerProps): UseWebContainerReturn => {
  const [serverUrl, setServerUrl] = useState<string | null>(lastServerUrl);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<WebContainer | null>(null);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    // If Strict Mode's simulated unmount scheduled a teardown, cancel it
    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = null;
    }

    getWebContainer()
      .then((wc) => {
        if (!mounted) return;

        // Track the dev server URL here, so it survives the preview panel
        // being closed and reopened.
        unsubscribe = wc.on("server-ready", (_port, url) => {
          lastServerUrl = url;
          setServerUrl(url);
        });

        setInstance(wc);
        setServerUrl(lastServerUrl);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to initialize WebContainer:", err);
        if (!mounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to initialize WebContainer"
        );
        setIsLoading(false);
      });

    return () => {
      mounted = false;
      unsubscribe?.();
      // Defer the teardown: on a Strict Mode re-mount the effect runs again
      // right away and cancels this. On a real unmount (leaving the page) it runs.
      teardownTimer = setTimeout(() => {
        teardownTimer = null;
        teardownWebContainer();
      }, 0);
    };
  }, []);

  const writeFileSync = useCallback(
    async (path: string, content: string): Promise<void> => {
      if (!instance) {
        throw new Error("WebContainer instance is not available");
      }

      try {
        const folderPath = path.split("/").slice(0, -1).join("/");
        if (folderPath) {
          await instance.fs.mkdir(folderPath, { recursive: true });
        }
        await instance.fs.writeFile(path, content);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to write file";
        console.error(`Failed to write file at ${path}:`, err);
        throw new Error(`Failed to write file at ${path}: ${errorMessage}`);
      }
    },
    [instance]
  );

  const destory = useCallback(() => {
    teardownWebContainer();
    setInstance(null);
    setServerUrl(null);
  }, []);

  return { serverUrl, isLoading, error, instance, writeFileSync, destory };
};