import { BigInt } from "@graphprotocol/graph-ts"
import {
  AgentRegistered,
  AgentUpdated,
  AgentDeactivated,
  AgentReactivated,
  EndpointChanged,
  HeartbeatSubmitted,
} from "../generated/AgentRegistry/AgentRegistry"
import { Agent, ProtocolStats } from "../generated/schema"
import { getOrCreateStats } from "./helpers"

export function handleAgentRegistered(event: AgentRegistered): void {
  const id = event.params.wallet.toHex()
  let agent = new Agent(id)
  agent.name = event.params.name
  agent.serviceType = event.params.serviceType
  agent.active = true
  agent.registeredAt = event.params.timestamp
  agent.heartbeatCount = BigInt.fromI32(0)
  agent.uptimeScore = BigInt.fromI32(0)
  agent.responseScore = BigInt.fromI32(0)
  agent.save()

  const stats = getOrCreateStats()
  stats.totalAgents = stats.totalAgents.plus(BigInt.fromI32(1))
  stats.save()
}

export function handleAgentUpdated(event: AgentUpdated): void {
  const id = event.params.wallet.toHex()
  let agent = Agent.load(id)
  if (!agent) return
  agent.name = event.params.name
  agent.serviceType = event.params.serviceType
  agent.save()
}

export function handleAgentDeactivated(event: AgentDeactivated): void {
  const id = event.params.wallet.toHex()
  let agent = Agent.load(id)
  if (!agent) return
  agent.active = false
  agent.save()
}

export function handleAgentReactivated(event: AgentReactivated): void {
  const id = event.params.wallet.toHex()
  let agent = Agent.load(id)
  if (!agent) return
  agent.active = true
  agent.save()
}

export function handleEndpointChanged(event: EndpointChanged): void {
  const id = event.params.wallet.toHex()
  let agent = Agent.load(id)
  if (!agent) return
  agent.endpoint = event.params.oldEndpoint  // new endpoint is in event.params.newEndpoint
  agent.endpoint = event.params.newEndpoint
  agent.save()
}

export function handleHeartbeatSubmitted(event: HeartbeatSubmitted): void {
  const id = event.params.wallet.toHex()
  let agent = Agent.load(id)
  if (!agent) return
  agent.lastHeartbeat = event.params.timestamp
  agent.heartbeatCount = event.params.heartbeatCount
  agent.uptimeScore = event.params.uptimeScore
  agent.responseScore = event.params.responseScore
  agent.save()
}
