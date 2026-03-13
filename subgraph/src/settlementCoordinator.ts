import {
  ProposalCreated,
  ProposalAccepted,
  ProposalExecuted,
  ProposalRejected,
  ProposalExpired,
} from "../generated/SettlementCoordinator/SettlementCoordinator"
import { SettlementProposal } from "../generated/schema"

export function handleProposalCreated(event: ProposalCreated): void {
  const id = event.params.proposalId.toHex()
  let proposal = new SettlementProposal(id)
  proposal.from = event.params.from
  proposal.to = event.params.to
  proposal.amount = event.params.amount
  proposal.state = "CREATED"
  proposal.createdAt = event.block.timestamp
  proposal.updatedAt = event.block.timestamp
  proposal.save()
}

export function handleProposalAccepted(event: ProposalAccepted): void {
  const id = event.params.proposalId.toHex()
  let proposal = SettlementProposal.load(id)
  if (!proposal) return
  proposal.state = "ACCEPTED"
  proposal.updatedAt = event.block.timestamp
  proposal.save()
}

export function handleProposalExecuted(event: ProposalExecuted): void {
  const id = event.params.proposalId.toHex()
  let proposal = SettlementProposal.load(id)
  if (!proposal) return
  proposal.state = "EXECUTED"
  proposal.amount = event.params.amount
  proposal.updatedAt = event.block.timestamp
  proposal.save()
}

export function handleProposalRejected(event: ProposalRejected): void {
  const id = event.params.proposalId.toHex()
  let proposal = SettlementProposal.load(id)
  if (!proposal) return
  proposal.state = "REJECTED"
  proposal.updatedAt = event.block.timestamp
  proposal.save()
}

export function handleProposalExpired(event: ProposalExpired): void {
  const id = event.params.proposalId.toHex()
  let proposal = SettlementProposal.load(id)
  if (!proposal) return
  proposal.state = "EXPIRED"
  proposal.updatedAt = event.block.timestamp
  proposal.save()
}
