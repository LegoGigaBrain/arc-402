import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { createProgram } from "../program";

const BUILTIN_CMDS = ["help", "exit", "quit", "clear", "status"];

interface InputLineProps {
  onSubmit: (value: string) => void;
  isDisabled?: boolean;
}

/**
 * Input line with command history navigation and tab completion.
 * Uses ink-text-input for text input with cursor.
 */
export function InputLine({ onSubmit, isDisabled = false }: InputLineProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [historyTemp, setHistoryTemp] = useState("");

  // Lazily build command list for tab completion
  const [topCmds] = useState<string[]>(() => {
    try {
      const prog = createProgram();
      return prog.commands.map((cmd) => cmd.name());
    } catch {
      return [];
    }
  });
  const [subCmds] = useState<Map<string, string[]>>(() => {
    try {
      const prog = createProgram();
      const map = new Map<string, string[]>();
      for (const cmd of prog.commands) {
        if (cmd.commands.length > 0) {
          map.set(cmd.name(), cmd.commands.map((s) => s.name()));
        }
      }
      return map;
    } catch {
      return new Map();
    }
  });

  const handleSubmit = useCallback(
    (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) return;

      // Add to history (avoid duplicate of last entry)
      setHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        return [...prev, trimmed];
      });
      setHistoryIdx(-1);
      setHistoryTemp("");
      setValue("");

      onSubmit(trimmed);
    },
    [onSubmit]
  );

  useInput(
    (_input, key) => {
      if (isDisabled) return;

      // Up arrow — history prev
      if (key.upArrow) {
        setHistory((hist) => {
          setHistoryIdx((idx) => {
            if (idx === -1) {
              setHistoryTemp(value);
              const newIdx = hist.length - 1;
              if (newIdx >= 0) setValue(hist[newIdx]);
              return newIdx;
            } else if (idx > 0) {
              const newIdx = idx - 1;
              setValue(hist[newIdx]);
              return newIdx;
            }
            return idx;
          });
          return hist;
        });
        return;
      }

      // Down arrow — history next
      if (key.downArrow) {
        setHistory((hist) => {
          setHistoryIdx((idx) => {
            if (idx >= 0) {
              const newIdx = idx + 1;
              if (newIdx >= hist.length) {
                setValue(historyTemp);
                return -1;
              } else {
                setValue(hist[newIdx]);
                return newIdx;
              }
            }
            return idx;
          });
          return hist;
        });
        return;
      }

      // Tab — completion
      if (_input === "\t") {
        const allTop = [...BUILTIN_CMDS, ...topCmds];
        const trimmed = value.trimStart();
        const spaceIdx = trimmed.indexOf(" ");

        let completions: string[];
        if (spaceIdx === -1) {
          completions = allTop.filter((cmd) => cmd.startsWith(trimmed));
        } else {
          const parent = trimmed.slice(0, spaceIdx);
          const rest = trimmed.slice(spaceIdx + 1);
          const subs = subCmds.get(parent) ?? [];
          completions = subs
            .filter((s) => s.startsWith(rest))
            .map((s) => `${parent} ${s}`);
        }

        if (completions.length === 0) return;

        if (completions.length === 1) {
          setValue(completions[0] + " ");
          return;
        }

        // Find common prefix
        const common = completions.reduce((a, b) => {
          let i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          return a.slice(0, i);
        });
        if (common.length > value.trimStart().length) {
          setValue(common);
        }
      }
    },
    { isActive: !isDisabled }
  );

  return (
    <Box>
      <Text color="cyan">◈</Text>
      <Text dimColor> arc402 </Text>
      <Text color="white">{">"} </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        focus={!isDisabled}
      />
    </Box>
  );
}
