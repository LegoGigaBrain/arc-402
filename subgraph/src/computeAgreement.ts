import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  SessionProposed,
  SessionAccepted,
  SessionStarted,
  UsageReported,
  SessionCompleted,
  SessionDisputed,
  SessionCancelled,
  DetailedDisputeResolved,
} from "../generated/ComputeAgreement/ComputeAgreement"
import { ComputeSession, ComputeUsageReport } from "../generated/schema"

export function handleSessionProposed(event: SessionProposed): void {
  const id = event.params.sessionId.toHex()
  let session = new ComputeSession(id)
  session.client = event.params.client
  session.provider = event.params.provider
  session.ratePerHour = event.params.ratePerHour
  session.maxHours = event.params.maxHours
  session.depositAmount = event.params.ratePerHour.times(event.params.maxHours)
  session.token = event.params.token
  session.consumedMinutes = BigInt.fromI32(0)
  session.gpuSpecHash = Bytes.fromI32(0)
  session.status = "Proposed"
  session.proposedAt = event.block.timestamp
  session.save()
}

export function handleSessionAccepted(event: SessionAccepted): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  session.status = "Active"
  session.save()
}

export function handleSessionStarted(event: SessionStarted): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  session.startedAt = event.params.startedAt
  session.save()
}

export function handleUsageReported(event: UsageReported): void {
  const sessionId = event.params.sessionId.toHex()
  let session = ComputeSession.load(sessionId)
  if (!session) return

  session.consumedMinutes = session.consumedMinutes.plus(event.params.computeMinutes)
  session.save()

  // Build a unique report ID from sessionId + tx hash + log index
  const reportId = sessionId + "-" + event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  let report = new ComputeUsageReport(reportId)
  report.session = sessionId
  report.computeMinutes = event.params.computeMinutes
  report.periodEnd = event.params.periodEnd
  report.timestamp = event.block.timestamp
  report.save()
}

export function handleSessionCompleted(event: SessionCompleted): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  session.status = "Completed"
  session.endedAt = event.block.timestamp
  session.consumedMinutes = event.params.totalMinutes
  session.save()
}

export function handleSessionDisputed(event: SessionDisputed): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  session.status = "Disputed"
  session.save()
}

export function handleSessionCancelled(event: SessionCancelled): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  session.status = "Cancelled"
  session.save()
}

export function handleDisputeResolved(event: DetailedDisputeResolved): void {
  const id = event.params.sessionId.toHex()
  let session = ComputeSession.load(id)
  if (!session) return
  // outcome 3 = HUMAN_REVIEW_REQUIRED — session stays Disputed
  if (event.params.outcome != 3) {
    session.status = "Completed"
    session.endedAt = event.block.timestamp
  }
  session.save()
}
