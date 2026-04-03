import React from "react";
import { Box, Text } from "ink";
import type { KernelPayload } from "./kernel-payload";
import { StatusCard } from "./components/commerce/StatusCard";
import { DiscoverList } from "./components/commerce/DiscoverList";
import { AgreementList } from "./components/commerce/AgreementList";
import { WorkroomCard } from "./components/commerce/WorkroomCard";
import { SubscribeCard } from "./components/commerce/SubscribeCard";
import { RoundsList } from "./components/commerce/RoundsList";
import { SquadCard } from "./components/commerce/SquadCard";

interface KernelPayloadRendererProps {
  payload: KernelPayload;
}

/**
 * Maps typed KernelPayload structs to Phase 2 Ink commerce components.
 * This is the bridge that makes real inline component rendering viable:
 * the kernel returns data, this component renders it inside the Ink tree.
 */
export function KernelPayloadRenderer({ payload }: KernelPayloadRendererProps) {
  switch (payload.type) {
    case "status":
      return (
        <Box flexDirection="column">
          <StatusCard {...payload.props} />
          {payload.guidance?.map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      );

    case "discover":
      return <DiscoverList {...payload.props} />;

    case "agreements":
      return <AgreementList {...payload.props} />;

    case "workroom":
      return <WorkroomCard {...payload.props} />;

    case "subscribe":
      return <SubscribeCard {...payload.props} />;

    case "rounds":
      return <RoundsList {...payload.props} />;

    case "squad":
      return <SquadCard {...payload.props} />;

    case "squads":
      return (
        <Box flexDirection="column">
          {payload.cards.map((card, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <SquadCard {...card} />
            </Box>
          ))}
        </Box>
      );

    case "not_found":
    case "error":
      return (
        <Box>
          <Text color="yellow">⚠ </Text>
          <Text>{payload.message}</Text>
        </Box>
      );
  }
}
