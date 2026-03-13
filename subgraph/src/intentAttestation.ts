import { AttestationCreated } from "../generated/IntentAttestation/IntentAttestation"
import { IntentAttestation } from "../generated/schema"

export function handleAttestationCreated(event: AttestationCreated): void {
  const id = event.params.attestationId.toHex()
  let attestation = new IntentAttestation(id)
  attestation.wallet = event.params.wallet
  attestation.action = event.params.action
  attestation.recipient = event.params.recipient
  attestation.amount = event.params.amount
  attestation.createdAt = event.block.timestamp
  attestation.save()
}
