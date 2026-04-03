import React, { useState, useEffect } from "react";
import { Text } from "../../renderer/index.js";
import { useInput } from "ink";

interface CustomTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  focus?: boolean;
  /** When true, Enter key is NOT handled — let parent handle it (e.g. dropdown selection) */
  suppressEnter?: boolean;
}

/**
 * Minimal text input that does NOT intercept Tab, Up, Down, Escape, or Ctrl+C,
 * allowing parent useInput handlers to receive those keys.
 */
export function CustomTextInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  suppressEnter = false,
}: CustomTextInputProps) {
  const [cursorPos, setCursorPos] = useState(value.length);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Keep cursor within bounds when value changes externally
  useEffect(() => {
    setCursorPos((pos) => Math.min(pos, value.length));
  }, [value]);

  // Blink cursor
  useEffect(() => {
    if (!focus) return;
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(timer);
  }, [focus]);

  useInput(
    (input, key) => {
      // Keys we explicitly do NOT handle — let parent see them:
      // Tab, Up, Down, Escape, Ctrl+C
      if (key.tab || key.upArrow || key.downArrow || key.escape) return;
      if (input === "\x03") return; // Ctrl+C

      // Enter/Return — submit (unless suppressed for dropdown selection)
      if (key.return) {
        if (!suppressEnter) {
          onSubmit?.(value);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          const next = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          setCursorPos(cursorPos - 1);
          onChange(next);
        }
        return;
      }

      // Left arrow
      if (key.leftArrow) {
        setCursorPos((p) => Math.max(0, p - 1));
        return;
      }

      // Right arrow
      if (key.rightArrow) {
        setCursorPos((p) => Math.min(value.length, p + 1));
        return;
      }

      // Home (Ctrl+A)
      if (input === "\x01") {
        setCursorPos(0);
        return;
      }

      // End (Ctrl+E)
      if (input === "\x05") {
        setCursorPos(value.length);
        return;
      }

      // Ctrl+U — clear line
      if (input === "\x15") {
        setCursorPos(0);
        onChange("");
        return;
      }

      // Ctrl+K — kill to end of line
      if (input === "\x0B") {
        onChange(value.slice(0, cursorPos));
        return;
      }

      // Ignore other control characters
      if (input.length > 0 && input.charCodeAt(0) < 32) return;

      // Regular character input (including paste)
      if (input.length > 0) {
        const next =
          value.slice(0, cursorPos) + input + value.slice(cursorPos);
        setCursorPos(cursorPos + input.length);
        onChange(next);
      }
    },
    { isActive: focus }
  );

  if (!focus) {
    return <Text dimColor>{value}</Text>;
  }

  const before = value.slice(0, cursorPos);
  const cursorChar = cursorPos < value.length ? value[cursorPos] : " ";
  const after = value.slice(cursorPos + 1);

  return (
    <Text>
      {before}
      <Text inverse={cursorVisible}>{cursorChar}</Text>
      {after}
    </Text>
  );
}
