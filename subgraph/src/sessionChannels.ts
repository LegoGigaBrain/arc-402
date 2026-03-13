import { BigInt } from "@graphprotocol/graph-ts"
import {
  ChannelOpened,
  ChannelClosing,
  ChannelSettled,
  ChannelChallenged,
  ChallengeFinalised,
  ChannelExpiredReclaimed,
} from "../generated/SessionChannels/SessionChannels"
import { Channel } from "../generated/schema"
import { getOrCreateStats } from "./helpers"

export function handleChannelOpened(event: ChannelOpened): void {
  const id = event.params.channelId.toHex()
  let channel = new Channel(id)
  channel.client = event.params.client
  channel.provider = event.params.provider
  channel.token = event.params.token
  channel.depositAmount = event.params.depositAmount
  channel.deadline = event.params.deadline
  channel.state = "OPEN"
  channel.openedAt = event.block.timestamp
  channel.updatedAt = event.block.timestamp
  channel.save()

  const stats = getOrCreateStats()
  stats.totalChannels = stats.totalChannels.plus(BigInt.fromI32(1))
  stats.save()
}

export function handleChannelClosing(event: ChannelClosing): void {
  const id = event.params.channelId.toHex()
  let channel = Channel.load(id)
  if (!channel) return
  channel.state = "CLOSING"
  channel.sequenceNumber = event.params.sequenceNumber
  channel.settledAmount = event.params.settledAmount
  channel.updatedAt = event.block.timestamp
  channel.save()
}

export function handleChannelSettled(event: ChannelSettled): void {
  const id = event.params.channelId.toHex()
  let channel = Channel.load(id)
  if (!channel) return
  channel.state = "SETTLED"
  channel.settledAmount = event.params.settledAmount
  channel.refundAmount = event.params.refundAmount
  channel.updatedAt = event.block.timestamp
  channel.save()
}

export function handleChannelChallenged(event: ChannelChallenged): void {
  const id = event.params.channelId.toHex()
  let channel = Channel.load(id)
  if (!channel) return
  channel.sequenceNumber = event.params.newSequenceNumber
  channel.settledAmount = event.params.newSettledAmount
  channel.updatedAt = event.block.timestamp
  channel.save()
}

export function handleChallengeFinalised(event: ChallengeFinalised): void {
  const id = event.params.channelId.toHex()
  let channel = Channel.load(id)
  if (!channel) return
  channel.state = "SETTLED"
  channel.settledAmount = event.params.settledAmount
  channel.updatedAt = event.block.timestamp
  channel.save()
}

export function handleChannelExpired(event: ChannelExpiredReclaimed): void {
  const id = event.params.channelId.toHex()
  let channel = Channel.load(id)
  if (!channel) return
  channel.state = "EXPIRED"
  channel.updatedAt = event.block.timestamp
  channel.save()
}
