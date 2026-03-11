import { ethers } from "ethers";

// ─── ABI ────────────────────────────────────────────────────────────────────
// Extracted directly from ServiceAgreement.sol + IServiceAgreement.sol

const SERVICE_AGREEMENT_ABI = [
  // Write
  "function propose(address provider, string calldata serviceType, string calldata description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256 agreementId)",
  "function accept(uint256 agreementId) external",
  "function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external",
  "function dispute(uint256 agreementId, string calldata reason) external",
  "function cancel(uint256 agreementId) external",
  "function expiredCancel(uint256 agreementId) external",

  // Read
  "function getAgreement(uint256 id) external view returns (tuple(uint256 id, address client, address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash, uint8 status, uint256 createdAt, uint256 resolvedAt) agreement)",
  "function getAgreementsByClient(address client) external view returns (uint256[])",
  "function getAgreementsByProvider(address provider) external view returns (uint256[])",
  "function agreementCount() external view returns (uint256)",

  // Events
  "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
  "event AgreementAccepted(uint256 indexed id, address indexed provider)",
  "event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash)",
  "event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason)",
  "event AgreementCancelled(uint256 indexed id, address indexed client)",
  "event DisputeResolved(uint256 indexed id, bool favorProvider)",
];

// ─── Types ───────────────────────────────────────────────────────────────────

/** Mirrors the on-chain Status enum in IServiceAgreement.sol */
export enum AgreementStatus {
  PROPOSED  = 0,
  ACCEPTED  = 1,
  FULFILLED = 2,
  DISPUTED  = 3,
  CANCELLED = 4,
}

export interface Agreement {
  id: bigint;
  client: string;
  provider: string;
  serviceType: string;
  description: string;
  price: bigint;
  /** ERC-20 token address, or address(0) for ETH */
  token: string;
  deadline: bigint;
  /** bytes32 hash of deliverables spec (hex string) */
  deliverablesHash: string;
  status: AgreementStatus;
  createdAt: bigint;
  resolvedAt: bigint;
}

export interface ProposeParams {
  provider: string;
  serviceType: string;
  description: string;
  price: bigint;
  /** address(0) for ETH */
  token: string;
  /** Unix timestamp */
  deadline: number;
  /** bytes32 as hex string, e.g. ethers.keccak256(...) */
  deliverablesHash: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class ServiceAgreementClient {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
    this.contract = new ethers.Contract(address, SERVICE_AGREEMENT_ABI, signerOrProvider);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Propose a new service agreement.
   * For ETH agreements (token == address(0)) the `price` is sent as msg.value automatically.
   * For ERC-20 agreements the contract must be approved before calling.
   */
  async propose(params: ProposeParams): Promise<{ agreementId: bigint; receipt: ethers.TransactionReceipt }> {
    const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
    const isEth = params.token === ETH_ADDRESS || params.token === ethers.ZeroAddress;

    const tx = await this.contract.propose(
      params.provider,
      params.serviceType,
      params.description,
      params.price,
      params.token,
      params.deadline,
      params.deliverablesHash,
      { value: isEth ? params.price : 0n }
    );
    const receipt: ethers.TransactionReceipt = await tx.wait();

    // Parse AgreementProposed event to retrieve the on-chain agreementId
    const iface = new ethers.Interface(SERVICE_AGREEMENT_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "AgreementProposed") {
          return { agreementId: BigInt(parsed.args.id), receipt };
        }
      } catch {
        // skip unparseable logs
      }
    }

    throw new Error("ServiceAgreementClient: could not parse AgreementProposed event");
  }

  async accept(agreementId: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.accept(agreementId);
    return tx.wait();
  }

  async fulfill(agreementId: bigint, actualDeliverablesHash: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.fulfill(agreementId, actualDeliverablesHash);
    return tx.wait();
  }

  async dispute(agreementId: bigint, reason: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.dispute(agreementId, reason);
    return tx.wait();
  }

  async cancel(agreementId: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.cancel(agreementId);
    return tx.wait();
  }

  async expiredCancel(agreementId: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contract.expiredCancel(agreementId);
    return tx.wait();
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getAgreement(id: bigint): Promise<Agreement> {
    const raw = await this.contract.getAgreement(id);
    return this._toAgreement(raw);
  }

  async getAgreementsByClient(client: string): Promise<bigint[]> {
    const ids: bigint[] = await this.contract.getAgreementsByClient(client);
    return ids.map(BigInt);
  }

  async getAgreementsByProvider(provider: string): Promise<bigint[]> {
    const ids: bigint[] = await this.contract.getAgreementsByProvider(provider);
    return ids.map(BigInt);
  }

  async agreementCount(): Promise<bigint> {
    return BigInt(await this.contract.agreementCount());
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /** Fetch full Agreement objects for all agreements where `client` is the paying party. */
  async getClientAgreements(client: string): Promise<Agreement[]> {
    const ids = await this.getAgreementsByClient(client);
    return Promise.all(ids.map((id) => this.getAgreement(id)));
  }

  /** Fetch full Agreement objects for all agreements where `provider` is the delivering party. */
  async getProviderAgreements(provider: string): Promise<Agreement[]> {
    const ids = await this.getAgreementsByProvider(provider);
    return Promise.all(ids.map((id) => this.getAgreement(id)));
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _toAgreement(raw: ethers.Result): Agreement {
    return {
      id:               BigInt(raw.id),
      client:           raw.client as string,
      provider:         raw.provider as string,
      serviceType:      raw.serviceType as string,
      description:      raw.description as string,
      price:            BigInt(raw.price),
      token:            raw.token as string,
      deadline:         BigInt(raw.deadline),
      deliverablesHash: raw.deliverablesHash as string,
      status:           Number(raw.status) as AgreementStatus,
      createdAt:        BigInt(raw.createdAt),
      resolvedAt:       BigInt(raw.resolvedAt),
    };
  }
}
