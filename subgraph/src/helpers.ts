import { BigInt } from "@graphprotocol/graph-ts"
import { ProtocolStats } from "../generated/schema"

export function getOrCreateStats(): ProtocolStats {
  let stats = ProtocolStats.load("global")
  if (!stats) {
    stats = new ProtocolStats("global")
    stats.totalAgents = BigInt.fromI32(0)
    stats.totalWallets = BigInt.fromI32(0)
    stats.totalAgreements = BigInt.fromI32(0)
    stats.totalChannels = BigInt.fromI32(0)
    stats.totalDisputes = BigInt.fromI32(0)
  }
  return stats
}
