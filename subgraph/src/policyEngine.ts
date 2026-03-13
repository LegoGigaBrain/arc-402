import { CategoryLimitSet } from "../generated/PolicyEngine/PolicyEngine"
import { Policy, Wallet } from "../generated/schema"

export function handleCategoryLimitSet(event: CategoryLimitSet): void {
  const walletId = event.params.wallet.toHex()

  // Ensure wallet entity exists
  let wallet = Wallet.load(walletId)
  if (!wallet) {
    wallet = new Wallet(walletId)
    wallet.owner = event.params.wallet
    wallet.createdAt = event.block.timestamp
    wallet.save()
  }

  const id = walletId + "-" + event.params.category
  let policy = Policy.load(id)
  if (!policy) {
    policy = new Policy(id)
    policy.wallet = walletId
    policy.category = event.params.category
  }
  policy.limitPerTx = event.params.limitPerTx
  policy.updatedAt = event.block.timestamp
  policy.save()
}
