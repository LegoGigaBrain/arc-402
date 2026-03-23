import { BigInt } from "@graphprotocol/graph-ts"
import {
  OfferingCreated,
  OfferingDeactivated,
  Subscribed,
  Renewed,
  Expired,
  SubscriptionCancelled,
  ToppedUp,
  SubscriptionDisputed,
  DetailedDisputeResolved,
} from "../generated/SubscriptionAgreement/SubscriptionAgreement"
import { SubscriptionOffering, AgentSubscription } from "../generated/schema"

export function handleOfferingCreated(event: OfferingCreated): void {
  const id = event.params.offeringId.toString()
  let offering = new SubscriptionOffering(id)
  offering.provider = event.params.provider
  offering.pricePerPeriod = event.params.pricePerPeriod
  offering.periodSeconds = event.params.periodSeconds
  offering.token = event.params.token
  offering.contentHash = event.params.contentHash
  offering.active = true
  offering.maxSubscribers = event.params.maxSubscribers
  offering.subscriberCount = BigInt.fromI32(0)
  offering.createdAt = event.block.timestamp
  offering.save()
}

export function handleOfferingDeactivated(event: OfferingDeactivated): void {
  const id = event.params.offeringId.toString()
  let offering = SubscriptionOffering.load(id)
  if (!offering) return
  offering.active = false
  offering.save()
}

export function handleSubscribed(event: Subscribed): void {
  const offeringId = event.params.offeringId.toString()
  let offering = SubscriptionOffering.load(offeringId)
  if (!offering) return

  offering.subscriberCount = offering.subscriberCount.plus(BigInt.fromI32(1))
  offering.save()

  const id = event.params.subscriptionId.toHex()
  let sub = new AgentSubscription(id)
  sub.subscriber = event.params.subscriber
  sub.offering = offeringId
  sub.startedAt = event.block.timestamp
  sub.currentPeriodEnd = event.params.currentPeriodEnd
  sub.deposited = event.params.deposited
  sub.consumed = offering.pricePerPeriod  // first period consumed immediately
  sub.active = true
  sub.cancelled = false
  sub.save()
}

export function handleRenewed(event: Renewed): void {
  const id = event.params.subscriptionId.toHex()
  let sub = AgentSubscription.load(id)
  if (!sub) return
  sub.currentPeriodEnd = event.params.newPeriodEnd

  let offering = SubscriptionOffering.load(sub.offering)
  if (offering) {
    sub.consumed = sub.consumed.plus(offering.pricePerPeriod)
  }
  sub.save()
}

export function handleExpired(event: Expired): void {
  const id = event.params.subscriptionId.toHex()
  let sub = AgentSubscription.load(id)
  if (!sub) return
  sub.active = false
  sub.save()

  let offering = SubscriptionOffering.load(sub.offering)
  if (offering) {
    offering.subscriberCount = offering.subscriberCount.minus(BigInt.fromI32(1))
    offering.save()
  }
}

export function handleSubscriptionCancelled(event: SubscriptionCancelled): void {
  const id = event.params.subscriptionId.toHex()
  let sub = AgentSubscription.load(id)
  if (!sub) return
  sub.active = false
  sub.cancelled = true
  sub.save()

  let offering = SubscriptionOffering.load(sub.offering)
  if (offering) {
    offering.subscriberCount = offering.subscriberCount.minus(BigInt.fromI32(1))
    offering.save()
  }
}

export function handleToppedUp(event: ToppedUp): void {
  const id = event.params.subscriptionId.toHex()
  let sub = AgentSubscription.load(id)
  if (!sub) return
  sub.deposited = event.params.newDeposited
  sub.save()
}

export function handleSubscriptionDisputed(event: SubscriptionDisputed): void {
  // No schema field for disputed state — subscription remains active until resolved
  // The event is indexed but no entity field update needed beyond what resolve handles
}

export function handleSubscriptionDisputeResolved(event: DetailedDisputeResolved): void {
  const id = event.params.subscriptionId.toHex()
  let sub = AgentSubscription.load(id)
  if (!sub) return
  // outcome 3 = HUMAN_REVIEW_REQUIRED — stay as-is
  if (event.params.outcome != 3) {
    sub.active = false
    sub.save()

    let offering = SubscriptionOffering.load(sub.offering)
    if (offering) {
      offering.subscriberCount = offering.subscriberCount.minus(BigInt.fromI32(1))
      offering.save()
    }
  }
}
