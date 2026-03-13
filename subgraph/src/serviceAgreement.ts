import { BigInt } from "@graphprotocol/graph-ts"
import {
  AgreementProposed,
  AgreementAccepted,
  AgreementFulfilled,
  AgreementDisputed,
  AgreementCancelled,
  DetailedDisputeResolved,
} from "../generated/ServiceAgreement/ServiceAgreement"
import { Agreement, Dispute } from "../generated/schema"
import { getOrCreateStats } from "./helpers"

export function handleAgreementProposed(event: AgreementProposed): void {
  const id = event.params.id.toString()
  let agreement = new Agreement(id)
  agreement.client = event.params.client
  agreement.provider = event.params.provider
  agreement.serviceType = event.params.serviceType
  agreement.price = event.params.price
  agreement.token = event.params.token
  agreement.deadline = event.params.deadline
  agreement.state = "PROPOSED"
  agreement.proposedAt = event.block.timestamp
  agreement.updatedAt = event.block.timestamp
  agreement.save()

  const stats = getOrCreateStats()
  stats.totalAgreements = stats.totalAgreements.plus(BigInt.fromI32(1))
  stats.save()
}

export function handleAgreementAccepted(event: AgreementAccepted): void {
  const id = event.params.id.toString()
  let agreement = Agreement.load(id)
  if (!agreement) return
  agreement.state = "ACCEPTED"
  agreement.updatedAt = event.block.timestamp
  agreement.save()
}

export function handleAgreementFulfilled(event: AgreementFulfilled): void {
  const id = event.params.id.toString()
  let agreement = Agreement.load(id)
  if (!agreement) return
  agreement.state = "FULFILLED"
  agreement.deliverablesHash = event.params.deliverablesHash
  agreement.updatedAt = event.block.timestamp
  agreement.save()
}

export function handleAgreementDisputed(event: AgreementDisputed): void {
  const agreementId = event.params.id.toString()
  let agreement = Agreement.load(agreementId)
  if (!agreement) return
  agreement.state = "DISPUTED"
  agreement.updatedAt = event.block.timestamp
  agreement.save()

  const disputeId = agreementId + "-" + event.block.timestamp.toString()
  let dispute = new Dispute(disputeId)
  dispute.agreement = agreementId
  dispute.initiator = event.params.initiator
  dispute.reason = event.params.reason
  dispute.openedAt = event.block.timestamp
  dispute.save()

  const stats = getOrCreateStats()
  stats.totalDisputes = stats.totalDisputes.plus(BigInt.fromI32(1))
  stats.save()
}

export function handleAgreementCancelled(event: AgreementCancelled): void {
  const id = event.params.id.toString()
  let agreement = Agreement.load(id)
  if (!agreement) return
  agreement.state = "CANCELLED"
  agreement.updatedAt = event.block.timestamp
  agreement.save()
}

export function handleDisputeResolved(event: DetailedDisputeResolved): void {
  const agreementId = event.params.id.toString()
  let agreement = Agreement.load(agreementId)
  if (!agreement) return
  agreement.state = "RESOLVED"
  agreement.updatedAt = event.block.timestamp
  agreement.save()
}
