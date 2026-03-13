import { SignalPublished } from "../generated/ReputationOracle/ReputationOracle"
import { ReputationSignal } from "../generated/schema"

export function handleSignalPublished(event: SignalPublished): void {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  let signal = new ReputationSignal(id)
  signal.publisher = event.params.publisher
  signal.subject = event.params.subject
  signal.signalType = event.params.signalType
  signal.capabilityHash = event.params.capabilityHash
  signal.publisherTrustAtTime = event.params.publisherTrustAtTime
  signal.autoPublished = event.params.autoPublished
  signal.timestamp = event.block.timestamp
  signal.save()
}
