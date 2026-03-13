import {
  AttestationPublished,
  AttestationRevoked,
} from "../generated/SponsorshipAttestation/SponsorshipAttestation"
import { SponsorshipAttestation } from "../generated/schema"

export function handleSponsorshipPublished(event: AttestationPublished): void {
  const id = event.params.attestationId.toHex()
  let attestation = new SponsorshipAttestation(id)
  attestation.sponsor = event.params.sponsor
  attestation.agent = event.params.agent
  attestation.expiresAt = event.params.expiresAt
  attestation.tier = event.params.tier
  attestation.evidenceURI = event.params.evidenceURI
  attestation.revoked = false
  attestation.publishedAt = event.block.timestamp
  attestation.save()
}

export function handleSponsorshipRevoked(event: AttestationRevoked): void {
  const id = event.params.attestationId.toHex()
  let attestation = SponsorshipAttestation.load(id)
  if (!attestation) return
  attestation.revoked = true
  attestation.revokedAt = event.block.timestamp
  attestation.save()
}
