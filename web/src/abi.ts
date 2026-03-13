export const ARC402_WALLET_ABI = [
  "function freeze() external",
  "function unfreeze() external",
  "function transferOwnership(address newOwner) external",
] as const;

export const POLICY_ENGINE_ABI = [
  "function setSpendLimit(address wallet, string category, uint256 amount) external",
  "function setGuardian(address wallet, address guardian) external",
] as const;
