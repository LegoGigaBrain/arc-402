import React, { useState, useEffect, useCallback } from "react";
import { Box, Text } from "../renderer/index.js";
import type { WCCallbacks } from "../walletconnect.js";
import { renderQR } from "../ui/qr-render.js";

export type WCStage = "connecting" | "connected" | "chain-switching" | "ready" | "error";

interface WalletConnectPairingProps {
  projectId: string;
  chainId: number;
  onComplete: (result: { account: string }) => void;
  onError: (err: string) => void;
  /** Called once the component mounts — parent passes the connect function */
  connect: (callbacks: WCCallbacks) => Promise<{ account: string }>;
}

/**
 * Renders WalletConnect pairing inside the Ink TUI viewport:
 * - ASCII QR code
 * - Deep links for MetaMask, Rainbow, Trust, etc.
 * - Status transitions: connecting → connected → chain-switching → ready
 */
export function WalletConnectPairing({
  onComplete,
  onError,
  connect,
}: WalletConnectPairingProps) {
  const [stage, setStage] = useState<WCStage>("connecting");
  const [uri, setUri] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<string | null>(null);
  const [qrLines, setQrLines] = useState<string[]>([]);
  const [detail, setDetail] = useState<string>("");

  const handleUri = useCallback((wcUri: string, wcLinks: Record<string, string>) => {
    setUri(wcUri);
    setLinks(wcLinks);
    // Generate ASCII QR using our compact renderer
    try {
      const lines = renderQR(wcUri);
      setQrLines(lines);
    } catch {
      // QR rendering is best-effort
    }
  }, []);

  const handleStatus = useCallback((status: WCStage, statusDetail?: string) => {
    setStage(status);
    if (statusDetail) setDetail(statusDetail);
    if (status === "connected" && statusDetail) {
      setAccount(statusDetail);
    }
  }, []);

  useEffect(() => {
    const callbacks: WCCallbacks = {
      onUri: handleUri,
      onStatus: handleStatus,
    };
    connect(callbacks)
      .then((result) => onComplete(result))
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));
  }, [connect, handleUri, handleStatus, onComplete, onError]);

  const statusIcon = stage === "error" ? "✗" : stage === "ready" ? "✓" : "◈";
  const statusColor = stage === "error" ? "red" : stage === "ready" ? "green" : "cyan";

  const statusMessages: Record<WCStage, string> = {
    connecting: "Waiting for wallet approval...",
    connected: `Connected: ${account ?? ""}`,
    "chain-switching": `Switching chain${detail ? `: ${detail}` : ""}...`,
    ready: `Ready — ${account ?? ""}`,
    error: detail || "Connection failed",
  };

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="cyan" bold>WalletConnect Pairing</Text>
      <Text> </Text>

      {/* Status */}
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text>{statusMessages[stage]}</Text>
      </Box>
      <Text> </Text>

      {/* Deep links */}
      {uri && stage === "connecting" && (
        <>
          <Text dimColor>Tap a link for your wallet app:</Text>
          <Text> </Text>
          {Object.entries(links).map(([name, link]) => (
            <Box key={name} flexDirection="column">
              <Text color="white">{name}:</Text>
              <Text dimColor>{link}</Text>
              <Text> </Text>
            </Box>
          ))}

          {/* QR code */}
          {qrLines.length > 0 && (
            <>
              <Text dimColor>Or scan QR:</Text>
              {qrLines.map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
            </>
          )}
        </>
      )}
    </Box>
  );
}
