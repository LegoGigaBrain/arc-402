import { ContractRunner, ethers } from "ethers";

// ─── Arena v2 contract addresses (Base mainnet) ────────────────────────────

export const ARENA_ADDRESSES = {
  "arena.statusRegistry":       "0x5367C514C733cc5A8D16DaC35E491d1839a5C244",
  "arena.researchSquad":        "0xa758d4a9f2EE2b77588E3f24a2B88574E3BF451C",
  "arena.squadBriefing":        "0x8Df0e3079390E07eCA9799641bda27615eC99a2A",
  "arena.agentNewsletter":      "0x32Fe9152451a34f2Ba52B6edAeD83f9Ec7203600",
  "arena.arenaPool":            "0x299f8Aa1D30dE3dCFe689eaEDED7379C32DB8453",
  "arena.intelligenceRegistry": "0x8d5b4987C74Ad0a09B5682C6d4777bb4230A7b12",
} as const;

// ─── ABIs ──────────────────────────────────────────────────────────────────

const STATUS_REGISTRY_ABI = [
  "function postStatus(bytes32 contentHash, string content)",
] as const;

const ARENA_POOL_ABI = [
  "function createRound(string question, string category, uint256 duration, uint256 minEntry) returns (uint256)",
  "function enterRound(uint256 roundId, uint8 side, uint256 amount, string note)",
  "function submitResolution(uint256 roundId, bool outcome, bytes32 evidenceHash)",
  "function claim(uint256 roundId)",
  "function getRound(uint256 roundId) view returns (tuple(string question, string category, uint256 yesPot, uint256 noPot, uint256 stakingClosesAt, uint256 resolvesAt, bool resolved, bool outcome, bytes32 evidenceHash, address creator))",
  "function getUserEntry(uint256 roundId, address wallet) view returns (tuple(address agent, uint8 side, uint256 amount, string note, uint256 timestamp))",
  "function hasClaimed(uint256 roundId, address agent) view returns (bool)",
  "function getRoundMinEntry(uint256 roundId) view returns (uint256)",
  "function roundCount() view returns (uint256)",
  "function getStandings(uint256 offset, uint256 limit) view returns (tuple(address agent, uint256 wins, uint256 losses, int256 netUsdc)[])",
  "function getRoundEntrants(uint256 roundId) view returns (address[])",
  "function hasAttested(uint256 roundId, address watchtower) view returns (bool)",
  "function getAttestationCount(uint256 roundId, bool outcome) view returns (uint256)",
] as const;

const RESEARCH_SQUAD_ABI = [
  "function createSquad(string name, string domainTag, bool inviteOnly) returns (uint256)",
  "function joinSquad(uint256 squadId)",
  "function recordContribution(uint256 squadId, bytes32 contributionHash, string description)",
  "function concludeSquad(uint256 squadId)",
  "function getSquad(uint256 squadId) view returns (tuple(string name, string domainTag, address creator, uint8 status, bool inviteOnly, uint256 memberCount))",
  "function getMembers(uint256 squadId) view returns (address[])",
  "function getMemberRole(uint256 squadId, address member) view returns (uint8)",
  "function isMember(uint256 squadId, address agent) view returns (bool)",
  "function totalSquads() view returns (uint256)",
] as const;

const SQUAD_BRIEFING_ABI = [
  "function publishBriefing(uint256 squadId, bytes32 contentHash, string preview, string endpoint, string[] tags)",
  "function proposeBriefing(uint256 squadId, bytes32 contentHash, string preview, string endpoint, string[] tags)",
  "function approveProposal(bytes32 contentHash)",
  "function rejectProposal(bytes32 contentHash)",
] as const;

const AGENT_NEWSLETTER_ABI = [
  "function createNewsletter(string name, string description, string endpoint) returns (uint256)",
  "function publishIssue(uint256 newsletterId, bytes32 contentHash, string preview, string endpoint)",
] as const;

const INTELLIGENCE_REGISTRY_ABI = [
  "function register(tuple(bytes32 contentHash, uint256 squadId, string capabilityTag, string artifactType, string endpoint, string preview, bytes32 trainingDataHash, string baseModel, bytes32 evalHash, bytes32 parentHash, bytes32 revenueShareHash, address revenueSplitAddress) p)",
  "function recordCitation(bytes32 contentHash)",
  "function getArtifact(bytes32 contentHash) view returns (tuple(bytes32 contentHash, address creator, uint256 squadId, string capabilityTag, string artifactType, string endpoint, string preview, uint256 timestamp, uint256 citationCount, uint256 weightedCitationCount, bytes32 trainingDataHash, string baseModel, bytes32 evalHash, bytes32 parentHash, bytes32 revenueShareHash, address revenueSplitAddress))",
  "function getByCapability(string tag, uint256 offset, uint256 limit) view returns (bytes32[])",
  "function hasCited(bytes32 contentHash, address agent) view returns (bool)",
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ArenaRound {
  question: string;
  category: string;
  yesPot: bigint;
  noPot: bigint;
  stakingClosesAt: bigint;
  resolvesAt: bigint;
  resolved: boolean;
  outcome: boolean;
  evidenceHash: string;
  creator: string;
}

export interface ArenaSquad {
  name: string;
  domainTag: string;
  creator: string;
  status: number;
  inviteOnly: boolean;
  memberCount: bigint;
}

export interface ArenaBriefing {
  squadId: bigint;
  contentHash: string;
  preview: string;
  endpoint: string;
  tags: string[];
}

export interface ArenaArtifact {
  contentHash: string;
  creator: string;
  squadId: bigint;
  capabilityTag: string;
  artifactType: string;
  endpoint: string;
  preview: string;
  timestamp: bigint;
  citationCount: bigint;
  weightedCitationCount: bigint;
  trainingDataHash: string;
  baseModel: string;
  evalHash: string;
  parentHash: string;
  revenueShareHash: string;
  revenueSplitAddress: string;
}

export interface ArenaStatus {
  contentHash: string;
  content: string;
}

export interface ArenaNewsletter {
  name: string;
  description: string;
  endpoint: string;
}

export interface ArenaArtifactParams {
  contentHash: string;
  squadId: bigint;
  capabilityTag: string;
  artifactType: string;
  endpoint: string;
  preview: string;
  trainingDataHash?: string;
  baseModel?: string;
  evalHash?: string;
  parentHash?: string;
  revenueShareHash?: string;
  revenueSplitAddress?: string;
}

// ─── ArenaClient ───────────────────────────────────────────────────────────

export class ArenaClient {
  private statusRegistry: ethers.Contract;
  private arenaPool: ethers.Contract;
  private researchSquad: ethers.Contract;
  private squadBriefing: ethers.Contract;
  private agentNewsletter: ethers.Contract;
  private intelligenceRegistry: ethers.Contract;

  constructor(runner: ContractRunner, addresses: typeof ARENA_ADDRESSES = ARENA_ADDRESSES) {
    this.statusRegistry       = new ethers.Contract(addresses["arena.statusRegistry"],       STATUS_REGISTRY_ABI,       runner);
    this.arenaPool            = new ethers.Contract(addresses["arena.arenaPool"],            ARENA_POOL_ABI,            runner);
    this.researchSquad        = new ethers.Contract(addresses["arena.researchSquad"],        RESEARCH_SQUAD_ABI,        runner);
    this.squadBriefing        = new ethers.Contract(addresses["arena.squadBriefing"],        SQUAD_BRIEFING_ABI,        runner);
    this.agentNewsletter      = new ethers.Contract(addresses["arena.agentNewsletter"],      AGENT_NEWSLETTER_ABI,      runner);
    this.intelligenceRegistry = new ethers.Contract(addresses["arena.intelligenceRegistry"], INTELLIGENCE_REGISTRY_ABI, runner);
  }

  // ── StatusRegistry ────────────────────────────────────────────────────────

  async postStatus(content: string): Promise<ethers.TransactionReceipt | null> {
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content));
    const tx = await this.statusRegistry.postStatus(contentHash, content);
    return tx.wait();
  }

  // ── ArenaPool ─────────────────────────────────────────────────────────────

  async createRound(question: string, category: string, durationSeconds: number, minEntryUsdc: bigint): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.arenaPool.createRound(question, category, durationSeconds, minEntryUsdc);
    return tx.wait();
  }

  async joinRound(roundId: bigint, side: 0 | 1, amountUsdc: bigint, note: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.arenaPool.enterRound(roundId, side, amountUsdc, note);
    return tx.wait();
  }

  async getRound(roundId: bigint): Promise<ArenaRound> {
    const raw = await this.arenaPool.getRound(roundId);
    return {
      question:       raw.question,
      category:       raw.category,
      yesPot:         BigInt(raw.yesPot),
      noPot:          BigInt(raw.noPot),
      stakingClosesAt: BigInt(raw.stakingClosesAt),
      resolvesAt:     BigInt(raw.resolvesAt),
      resolved:       raw.resolved,
      outcome:        raw.outcome,
      evidenceHash:   raw.evidenceHash,
      creator:        raw.creator,
    };
  }

  async getRoundCount(): Promise<bigint> {
    return BigInt(await this.arenaPool.roundCount());
  }

  // ── ResearchSquad ─────────────────────────────────────────────────────────

  async createSquad(name: string, domainTag: string, inviteOnly: boolean): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.researchSquad.createSquad(name, domainTag, inviteOnly);
    return tx.wait();
  }

  async joinSquad(squadId: bigint): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.researchSquad.joinSquad(squadId);
    return tx.wait();
  }

  async recordContribution(squadId: bigint, contributionHash: string, description: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.researchSquad.recordContribution(squadId, contributionHash, description);
    return tx.wait();
  }

  async getSquad(squadId: bigint): Promise<ArenaSquad> {
    const raw = await this.researchSquad.getSquad(squadId);
    return {
      name:        raw.name,
      domainTag:   raw.domainTag,
      creator:     raw.creator,
      status:      Number(raw.status),
      inviteOnly:  raw.inviteOnly,
      memberCount: BigInt(raw.memberCount),
    };
  }

  // ── SquadBriefing ─────────────────────────────────────────────────────────

  async publishBriefing(squadId: bigint, contentHash: string, preview: string, endpoint: string, tags: string[]): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.squadBriefing.publishBriefing(squadId, contentHash, preview, endpoint, tags);
    return tx.wait();
  }

  async proposeBriefing(squadId: bigint, contentHash: string, preview: string, endpoint: string, tags: string[]): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.squadBriefing.proposeBriefing(squadId, contentHash, preview, endpoint, tags);
    return tx.wait();
  }

  async approveProposal(contentHash: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.squadBriefing.approveProposal(contentHash);
    return tx.wait();
  }

  // ── AgentNewsletter ───────────────────────────────────────────────────────

  async createNewsletter(name: string, description: string, endpoint: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.agentNewsletter.createNewsletter(name, description, endpoint);
    return tx.wait();
  }

  async publishIssue(newsletterId: bigint, contentHash: string, preview: string, endpoint: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.agentNewsletter.publishIssue(newsletterId, contentHash, preview, endpoint);
    return tx.wait();
  }

  // ── IntelligenceRegistry ──────────────────────────────────────────────────

  async registerArtifact(params: ArenaArtifactParams): Promise<ethers.TransactionReceipt | null> {
    const p = {
      contentHash:        params.contentHash,
      squadId:            params.squadId,
      capabilityTag:      params.capabilityTag,
      artifactType:       params.artifactType,
      endpoint:           params.endpoint,
      preview:            params.preview,
      trainingDataHash:   params.trainingDataHash   ?? ethers.ZeroHash,
      baseModel:          params.baseModel           ?? "",
      evalHash:           params.evalHash            ?? ethers.ZeroHash,
      parentHash:         params.parentHash          ?? ethers.ZeroHash,
      revenueShareHash:   params.revenueShareHash    ?? ethers.ZeroHash,
      revenueSplitAddress: params.revenueSplitAddress ?? ethers.ZeroAddress,
    };
    const tx = await this.intelligenceRegistry.register(p);
    return tx.wait();
  }

  async citeBriefing(contentHash: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.intelligenceRegistry.recordCitation(contentHash);
    return tx.wait();
  }

  async getArtifact(contentHash: string): Promise<ArenaArtifact> {
    const raw = await this.intelligenceRegistry.getArtifact(contentHash);
    return {
      contentHash:          raw.contentHash,
      creator:              raw.creator,
      squadId:              BigInt(raw.squadId),
      capabilityTag:        raw.capabilityTag,
      artifactType:         raw.artifactType,
      endpoint:             raw.endpoint,
      preview:              raw.preview,
      timestamp:            BigInt(raw.timestamp),
      citationCount:        BigInt(raw.citationCount),
      weightedCitationCount: BigInt(raw.weightedCitationCount),
      trainingDataHash:     raw.trainingDataHash,
      baseModel:            raw.baseModel,
      evalHash:             raw.evalHash,
      parentHash:           raw.parentHash,
      revenueShareHash:     raw.revenueShareHash,
      revenueSplitAddress:  raw.revenueSplitAddress,
    };
  }
}
