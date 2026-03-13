import { WalletInitialized, ScoreUpdated } from "../generated/TrustRegistryV2/TrustRegistryV2"
import { TrustScore, TrustScoreUpdate } from "../generated/schema"

export function handleWalletInitialized(event: WalletInitialized): void {
  const id = event.params.wallet.toHex()
  let score = new TrustScore(id)
  score.wallet = event.params.wallet
  score.globalScore = event.params.initialScore
  score.initializedAt = event.block.timestamp
  score.updatedAt = event.block.timestamp
  score.save()
}

export function handleScoreUpdated(event: ScoreUpdated): void {
  const id = event.params.wallet.toHex()
  let score = TrustScore.load(id)
  if (!score) {
    score = new TrustScore(id)
    score.wallet = event.params.wallet
    score.initializedAt = event.block.timestamp
  }
  score.globalScore = event.params.newGlobalScore
  score.updatedAt = event.block.timestamp
  score.save()

  const updateId = event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  let update = new TrustScoreUpdate(updateId)
  update.trustScore = id
  update.capability = event.params.capability
  update.delta = event.params.delta
  update.newGlobalScore = event.params.newGlobalScore
  update.timestamp = event.block.timestamp
  update.save()
}
