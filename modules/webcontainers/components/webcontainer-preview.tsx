"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { transformToWebContainerFormat } from "../hooks/transformer";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

import type { WebContainer } from "@webcontainer/api";
import type { TemplateFolder } from "@/modules/playground/lib/path-to-json";
import TerminalComponent, { type TerminalRef } from "./terminal";

interface WebContainerPreviewProps {
  templateData: TemplateFolder;
  serverUrl?: string | null; // from useWebContainer
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  /** Increment to reload the preview iframe (the editor bumps it after syncing a file) */
  reloadSignal?: number;
  forceResetup?: boolean; // Optional prop to force re-setup
}

const INITIAL_LOADING_STATE = {
  transforming: false,
  mounting: false,
  installing: false,
  starting: false,
  ready: false,
};

const WebContainerPreview = ({
  templateData,
  error,
  instance,
  isLoading,
  serverUrl,
  reloadSignal = 0,
  forceResetup = false,
}: WebContainerPreviewProps) => {
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [loadingState, setLoadingState] = useState(INITIAL_LOADING_STATE);
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 4;
  const [setupError, setSetupError] = useState<string | null>(null);

  // A ref (not state) guards the setup, so it can never run twice at once.
  // With state, Strict Mode could start two `npm install`s before the flag updated.
  const setupStarted = useRef(false);
  const terminalRef = useRef<TerminalRef>(null);

  const log = useCallback((message: string) => {
    terminalRef.current?.writeToTerminal(message);
  }, []);

  // Reset setup state when forceResetup changes
  useEffect(() => {
    if (forceResetup) {
      setupStarted.current = false;
      setPreviewUrl("");
      setCurrentStep(0);
      setSetupError(null);
      setLoadingState(INITIAL_LOADING_STATE);
    }
  }, [forceResetup]);

  // The server URL comes from useWebContainer, which listens for "server-ready".
  // This also works when the preview is reopened while the server is already running.
  useEffect(() => {
    if (!serverUrl) return;
    log(`🌐 Server ready at ${serverUrl}\r\n`);
    setPreviewUrl(serverUrl);
    setLoadingState((prev) => ({ ...prev, starting: false, ready: true }));
  }, [serverUrl, log]);

  useEffect(() => {
    if (!instance || !templateData || setupStarted.current) return;
    setupStarted.current = true;

    async function setupContainer(wc: WebContainer) {
      try {
        setSetupError(null);

        // Files already mounted (e.g. preview reopened): the server is running
        // or starting, and the serverUrl effect above finishes the job.
        const alreadyMounted = await wc.fs
          .readFile("package.json", "utf8")
          .then(
            () => true,
            () => false
          );

        if (alreadyMounted) {
          log("🔄 Reconnecting to existing WebContainer session...\r\n");
          setCurrentStep(4);
          setLoadingState((prev) => ({ ...prev, starting: true }));
          return;
        }

        // Step 1: transform data
        setLoadingState((prev) => ({ ...prev, transforming: true }));
        setCurrentStep(1);
        log("🔄 Transforming template data...\r\n");

        const files = transformToWebContainerFormat(templateData);

        setLoadingState((prev) => ({ ...prev, transforming: false, mounting: true }));
        setCurrentStep(2);

        // Step 2: mount files
        log("📁 Mounting files to WebContainer...\r\n");
        await wc.mount(files);
        log("✅ Files mounted successfully\r\n");

        setLoadingState((prev) => ({ ...prev, mounting: false, installing: true }));
        setCurrentStep(3);

        // Step 3: install dependencies
        log("📦 Installing dependencies...\r\n");
        const installProcess = await wc.spawn("npm", ["install"]);
        installProcess.output
          .pipeTo(new WritableStream({ write: (data) => log(data) }))
          .catch(() => {});

        const installExitCode = await installProcess.exit;
        if (installExitCode !== 0) {
          throw new Error(`Failed to install dependencies. Exit code: ${installExitCode}`);
        }
        log("✅ Dependencies installed successfully\r\n");

        setLoadingState((prev) => ({ ...prev, installing: false, starting: true }));
        setCurrentStep(4);

        // Step 4: start the server (serverUrl arrives via props when it's ready)
        log("🚀 Starting development server...\r\n");
        const startProcess = await wc.spawn("npm", ["run", "start"]);
        startProcess.output
          .pipeTo(new WritableStream({ write: (data) => log(data) }))
          .catch(() => {});
      } catch (err) {
        console.error("Error setting up container:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        log(`❌ Error: ${errorMessage}\r\n`);
        setSetupError(errorMessage);
        setLoadingState(INITIAL_LOADING_STATE);
      }
    }

    setupContainer(instance);
  }, [instance, templateData, forceResetup, log]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-6 rounded-lg bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <h3 className="text-lg font-medium">Initializing WebContainer</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Setting up the environment for your project...
          </p>
        </div>
      </div>
    );
  }

  if (error || setupError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5" />
            <h3 className="font-semibold">Error</h3>
          </div>
          <p className="text-sm">{error || setupError}</p>
        </div>
      </div>
    );
  }

  const getStepIcon = (stepIndex: number) => {
    if (stepIndex < currentStep || (stepIndex === currentStep && loadingState.ready)) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    } else if (stepIndex === currentStep) {
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    } else {
      return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepText = (stepIndex: number, label: string) => {
    const isActive = stepIndex === currentStep;
    const isComplete = stepIndex < currentStep;

    return (
      <span
        className={`text-sm font-medium ${
          isComplete ? "text-green-600" : isActive ? "text-blue-600" : "text-gray-500"
        }`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="h-full w-full flex flex-col">
      {previewUrl ? (
        <div className="flex-1 min-h-0">
          <iframe
            // The iframe is cross-origin, so it can't be reloaded directly.
            // Changing the URL is what makes the browser fetch the page again.
            src={
              reloadSignal
                ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${reloadSignal}`
                : previewUrl
            }
            className="w-full h-full border-none"
            title="WebContainer Preview"
          />
        </div>
      ) : (
        <div className="w-full max-w-md p-6 m-5 rounded-lg bg-white dark:bg-zinc-800 shadow-sm mx-auto">
          <Progress value={(currentStep / totalSteps) * 100} className="h-2 mb-6" />

          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-3">
              {getStepIcon(1)}
              {getStepText(1, "Transforming template data")}
            </div>
            <div className="flex items-center gap-3">
              {getStepIcon(2)}
              {getStepText(2, "Mounting files")}
            </div>
            <div className="flex items-center gap-3">
              {getStepIcon(3)}
              {getStepText(3, "Installing dependencies")}
            </div>
            <div className="flex items-center gap-3">
              {getStepIcon(4)}
              {getStepText(4, "Starting development server")}
            </div>
          </div>
        </div>
      )}

      {/* One terminal that stays mounted, so its output isn't lost when the preview appears */}
      <div className={previewUrl ? "h-64 border-t" : "flex-1 min-h-0 p-4"}>
        <TerminalComponent
          ref={terminalRef}
          webContainerInstance={instance}
          theme="dark"
          className="h-full"
        />
      </div>
    </div>
  );
};

export default WebContainerPreview;