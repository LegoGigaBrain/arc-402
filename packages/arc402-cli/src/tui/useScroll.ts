import { useState, useCallback, useEffect } from "react";
import { InputSystem } from "../renderer/index.js";

interface UseScrollResult {
  scrollOffset: number;
  setScrollOffset: (offset: number) => void;
  viewportHeight: number;
  isAutoScroll: boolean;
  scrollUp: (lines?: number) => void;
  scrollDown: (lines?: number) => void;
  snapToBottom: () => void;
}

/**
 * Manages scroll state for the Viewport.
 * scrollOffset=0 means auto-scroll (pinned to bottom).
 * Positive scrollOffset means scrolled up by that many lines.
 */
export function useScroll(viewportHeight: number): UseScrollResult {
  const [scrollOffset, setScrollOffsetState] = useState(0);

  const isAutoScroll = scrollOffset === 0;

  const setScrollOffset = useCallback((offset: number) => {
    setScrollOffsetState(Math.max(0, offset));
  }, []);

  const scrollUp = useCallback(
    (lines?: number) => {
      const step = lines ?? viewportHeight;
      setScrollOffsetState((prev) => prev + step);
    },
    [viewportHeight]
  );

  const scrollDown = useCallback(
    (lines?: number) => {
      const step = lines ?? viewportHeight;
      setScrollOffsetState((prev) => Math.max(0, prev - step));
    },
    [viewportHeight]
  );

  const snapToBottom = useCallback(() => {
    setScrollOffsetState(0);
  }, []);

  // Wire page up/down to InputSystem
  useEffect(() => {
    const inputSystem = new InputSystem();
    inputSystem.on('key', (event) => {
      if (event.key === 'pgup') {
        scrollUp(viewportHeight);
      } else if (event.key === 'pgdn') {
        scrollDown(viewportHeight);
      }
    });
    inputSystem.start();
    return () => inputSystem.stop();
  }, [viewportHeight, scrollUp, scrollDown]);

  return {
    scrollOffset,
    setScrollOffset,
    viewportHeight,
    isAutoScroll,
    scrollUp,
    scrollDown,
    snapToBottom,
  };
}
