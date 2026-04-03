import React, { useState, useCallback, useEffect } from "react";
import { Box, Text } from "../renderer/index.js";
import { InputSystem } from "../renderer/index.js";
import { BUILTIN_CMDS, TUI_SUBCOMMANDS, TUI_TOP_LEVEL_COMMANDS } from "./command-catalog.js";
import { CompletionDropdown } from "./components/CompletionDropdown.js";

interface InputLineProps {
  onSubmit: (value: string) => void;
  isDisabled?: boolean;
}

const ALL_TOP = [...BUILTIN_CMDS, ...TUI_TOP_LEVEL_COMMANDS];
const SUB_MAP = new Map(Object.entries(TUI_SUBCOMMANDS));

/**
 * Input line with:
 * - Command history navigation (↑/↓)
 * - Live completion dropdown (Tab cycles, Esc dismisses)
 * - Tab expansion on single match
 * - Driven by raw InputSystem — no ink useInput, so arrow keys work reliably
 */
export function InputLine({ onSubmit, isDisabled = false }: InputLineProps) {
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [historyTemp, setHistoryTemp] = useState("");

  // Completion state
  const [completions, setCompletions] = useState<string[]>([]);
  const [completionIdx, setCompletionIdx] = useState(0);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  const computeCompletions = useCallback((input: string): string[] => {
    const trimmed = input.trimStart();
    if (!trimmed) return [];
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      return ALL_TOP.filter((cmd) => cmd.startsWith(trimmed) && cmd !== trimmed);
    }
    const parent = trimmed.slice(0, spaceIdx);
    const rest = trimmed.slice(spaceIdx + 1);
    const subs = SUB_MAP.get(parent) ?? [];
    return subs
      .filter((s) => s.startsWith(rest) && s !== rest)
      .map((s) => `${parent} ${s}`);
  }, []);

  const handleChange = useCallback((newVal: string) => {
    setValue(newVal);
    setCursorPos(newVal.length);
    const candidates = computeCompletions(newVal);
    setCompletions(candidates);
    setCompletionIdx(0);
    setDropdownVisible(candidates.length > 0);
  }, [computeCompletions]);

  const handleSubmit = useCallback(
    (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return;
      setHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        return [...prev, trimmed];
      });
      setHistoryIdx(-1);
      setHistoryTemp("");
      setValue("");
      setCursorPos(0);
      setCompletions([]);
      setDropdownVisible(false);
      onSubmit(trimmed);
    },
    [onSubmit]
  );

  useEffect(() => {
    if (isDisabled) return;

    const inputSystem = new InputSystem();
    inputSystem.on('key', (event) => {
      if (isDisabled) return;

      if (event.key === 'escape') {
        setDropdownVisible(false);
        return;
      }

      if (event.key === 'up') {
        if (dropdownVisible && completions.length > 0) {
          setCompletionIdx((idx) => Math.max(0, idx - 1));
          return;
        }
        setHistory((hist) => {
          setHistoryIdx((idx) => {
            if (idx === -1) {
              setHistoryTemp(value);
              const newIdx = hist.length - 1;
              if (newIdx >= 0) {
                setValue(hist[newIdx]);
                setCursorPos(hist[newIdx].length);
                setCompletions([]);
                setDropdownVisible(false);
              }
              return newIdx;
            } else if (idx > 0) {
              const newIdx = idx - 1;
              setValue(hist[newIdx]);
              setCursorPos(hist[newIdx].length);
              setCompletions([]);
              setDropdownVisible(false);
              return newIdx;
            }
            return idx;
          });
          return hist;
        });
        return;
      }

      if (event.key === 'down') {
        if (dropdownVisible && completions.length > 0) {
          setCompletionIdx((idx) => Math.min(completions.length - 1, idx + 1));
          return;
        }
        setHistory((hist) => {
          setHistoryIdx((idx) => {
            if (idx >= 0) {
              const newIdx = idx + 1;
              if (newIdx >= hist.length) {
                setValue(historyTemp);
                setCursorPos(historyTemp.length);
                setCompletions([]);
                setDropdownVisible(false);
                return -1;
              } else {
                setValue(hist[newIdx]);
                setCursorPos(hist[newIdx].length);
                setCompletions([]);
                setDropdownVisible(false);
                return newIdx;
              }
            }
            return idx;
          });
          return hist;
        });
        return;
      }

      if (event.key === 'tab') {
        if (completions.length === 0) return;
        if (completions.length === 1) {
          const completed = completions[0] + " ";
          handleChange(completed);
          return;
        }
        if (dropdownVisible) {
          const selected = completions[completionIdx];
          if (selected) {
            handleChange(selected + " ");
          }
          return;
        }
        setDropdownVisible(true);
        return;
      }

      if (event.key === 'enter') {
        handleSubmit(value);
        return;
      }

      if (event.key === 'backspace') {
        setValue((prev) => {
          const newVal = prev.slice(0, -1);
          setCursorPos(newVal.length);
          const candidates = computeCompletions(newVal);
          setCompletions(candidates);
          setCompletionIdx(0);
          setDropdownVisible(candidates.length > 0);
          return newVal;
        });
        return;
      }

      if (event.key === 'delete') {
        // forward delete — noop for now (cursor at end)
        return;
      }

      if (event.key === 'ctrl-c') {
        process.exit(0);
        return;
      }

      if (event.key === 'ctrl-u') {
        handleChange("");
        return;
      }

      if (event.key === 'ctrl-w') {
        // Delete word before cursor
        setValue((prev) => {
          const parts = prev.trimEnd().split(" ");
          parts.pop();
          const newVal = parts.join(" ") + (parts.length ? " " : "");
          setCursorPos(newVal.length);
          const candidates = computeCompletions(newVal);
          setCompletions(candidates);
          setCompletionIdx(0);
          setDropdownVisible(candidates.length > 0);
          return newVal;
        });
        return;
      }

      if (event.key === 'char' && event.char) {
        setValue((prev) => {
          const newVal = prev + event.char;
          setCursorPos(newVal.length);
          const candidates = computeCompletions(newVal);
          setCompletions(candidates);
          setCompletionIdx(0);
          setDropdownVisible(candidates.length > 0);
          return newVal;
        });
        return;
      }
    });

    inputSystem.start();
    return () => inputSystem.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisabled, dropdownVisible, completions, completionIdx, value, historyTemp, handleChange, handleSubmit, computeCompletions]);

  // Render cursor as block char at cursor position
  const displayValue = value.slice(0, cursorPos) + "█" + value.slice(cursorPos);

  return (
    <Box flexDirection="column">
      {dropdownVisible && completions.length > 0 && (
        <CompletionDropdown
          candidates={completions}
          selectedIndex={completionIdx}
          visible={dropdownVisible}
        />
      )}
      <Box>
        <Text color="cyan">◈</Text>
        <Text dimColor> arc402 </Text>
        <Text color="white">{">"} </Text>
        <Text color="white">{displayValue}</Text>
      </Box>
    </Box>
  );
}
