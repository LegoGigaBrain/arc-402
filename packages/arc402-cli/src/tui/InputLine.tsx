import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { BUILTIN_CMDS, TUI_SUBCOMMANDS, TUI_TOP_LEVEL_COMMANDS } from "./command-catalog";
import { CompletionDropdown } from "./components/CompletionDropdown";

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
 */
export function InputLine({ onSubmit, isDisabled = false }: InputLineProps) {
  const [value, setValue] = useState("");
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
      setCompletions([]);
      setDropdownVisible(false);
      onSubmit(trimmed);
    },
    [onSubmit]
  );

  useInput(
    (input, key) => {
      if (isDisabled) return;

      // Escape — dismiss dropdown
      if (key.escape) {
        setDropdownVisible(false);
        return;
      }

      // Up arrow — history or cycle completion up
      if (key.upArrow) {
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
                setCompletions([]);
                setDropdownVisible(false);
              }
              return newIdx;
            } else if (idx > 0) {
              const newIdx = idx - 1;
              setValue(hist[newIdx]);
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

      // Down arrow — history or cycle completion down
      if (key.downArrow) {
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
                setCompletions([]);
                setDropdownVisible(false);
                return -1;
              } else {
                setValue(hist[newIdx]);
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

      // Tab — complete selected candidate or cycle
      if (input === "\t") {
        if (completions.length === 0) return;

        if (completions.length === 1) {
          const completed = completions[0] + " ";
          setValue(completed);
          setCompletions([]);
          setDropdownVisible(false);
          return;
        }

        // Multi: apply currently selected completion
        if (dropdownVisible) {
          const selected = completions[completionIdx];
          if (selected) {
            setValue(selected + " ");
            setCompletions([]);
            setDropdownVisible(false);
          }
          return;
        }

        // Reveal dropdown on first Tab
        setDropdownVisible(true);
        return;
      }
    },
    { isActive: !isDisabled }
  );

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
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          focus={!isDisabled}
        />
      </Box>
    </Box>
  );
}
