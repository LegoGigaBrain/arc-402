import { BigInt } from "@graphprotocol/graph-ts"
import { WalletCreated } from "../generated/WalletFactory/WalletFactory"
import { Wallet } from "../generated/schema"
import { getOrCreateStats } from "./helpers"

export function handleWalletCreated(event: WalletCreated): void {
  const id = event.params.walletAddress.toHex()
  let wallet = new Wallet(id)
  wallet.owner = event.params.owner
  wallet.createdAt = event.block.timestamp
  wallet.save()

  const stats = getOrCreateStats()
  stats.totalWallets = stats.totalWallets.plus(BigInt.fromI32(1))
  stats.save()
}
