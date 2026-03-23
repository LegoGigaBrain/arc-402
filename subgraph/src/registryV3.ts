import {
  ContractsUpdated,
  ExtensionSet,
} from "../generated/ARC402RegistryV3/ARC402RegistryV3"
import { RegistryV3State } from "../generated/schema"

export function handleContractsUpdated(event: ContractsUpdated): void {
  let state = RegistryV3State.load("global")
  if (!state) {
    state = new RegistryV3State("global")
  }
  state.version = event.params.version
  state.policyEngine = event.params.policyEngine
  state.trustRegistry = event.params.trustRegistry
  state.intentAttestation = event.params.intentAttestation
  state.settlementCoordinator = event.params.settlementCoordinator
  state.updatedAt = event.block.timestamp
  state.save()
}

export function handleExtensionSet(_event: ExtensionSet): void {
  // Extension key/address pairs are low-cardinality admin ops.
  // Indexed in the ABI for filtering; no separate entity needed.
}
