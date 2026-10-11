import { useCallback, useState } from "react";

/**
 * AI completion state for the playground header.
 *
 * Fetching, showing, accepting and rejecting suggestions are now handled by
 * Monacopilot inside the editor, so all that's left here is the on/off switch
 * and whether a request is running.
 */
export const useAISuggestions = () => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const toggleEnabled = useCallback(() => setIsEnabled((on) => !on), []);
  const setLoading = useCallback((loading: boolean) => setIsLoading(loading), []);

  return { isEnabled, isLoading, toggleEnabled, setLoading };
};