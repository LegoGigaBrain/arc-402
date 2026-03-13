import { WalletInitialized, ScoreUpdated } from "../generated/TrustRegistry/TrustRegistry"
import { TrustScoreV1 } from "../generated/schema"

export function handleTrustV1WalletInitialized(event: WalletInitialized): void {
  const id = event.params.wallet.toHex() + "-" + event.address.toHex()
  let score = new TrustScoreV1(id)
  score.wallet = event.params.wallet
  score.score = event.params.score
  score.initializedAt = event.block.timestamp
  score.updatedAt = event.block.timestamp
  score.save()
}

export function handleTrustV1ScoreUpdated(event: ScoreUpdated): void {
  const id = event.params.wallet.toHex() + "-" + event.address.toHex()
  let score = TrustScoreV1.load(id)
  if (!score) {
    score = new TrustScoreV1(id)
    score.wallet = event.params.wallet
    score.initializedAt = event.block.timestamp
  }
  score.score = event.params.newScore
  score.updatedAt = event.block.timestamp
  score.save()
}
