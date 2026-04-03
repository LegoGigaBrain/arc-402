import React, { useEffect } from "react";
import { Box, Text } from "../../renderer/index.js";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

export interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const VARIANT_CONFIG: Record<ToastVariant, { icon: string; color: string }> = {
  info: { icon: "◈", color: "cyan" },
  success: { icon: "✓", color: "green" },
  warning: { icon: "⚠", color: "yellow" },
  error: { icon: "✗", color: "red" },
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const { icon, color } = VARIANT_CONFIG[toast.variant];

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <Box>
      <Text color={color}>
        {icon} {toast.message}
      </Text>
    </Box>
  );
}

export interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <Box flexDirection="column">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </Box>
  );
}
