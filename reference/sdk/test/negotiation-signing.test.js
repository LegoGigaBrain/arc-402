const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const {
  signNegotiationMessage,
  createSignedProposal,
  parseNegotiationMessage,
} = require('../dist');
const { NegotiationGuard } = require('../dist');

// Minimal mock ContractRunner + Registry that always returns isRegistered=true
function makeRunner(isRegistered = true) {
  // NegotiationGuard calls this.registry.isRegistered(addr)
  // We stub it by creating a fake contract
  return { isRegistered };
}

function makeMockGuard(isRegistered = true, opts = {}) {
  const guard = new NegotiationGuard({
    agentRegistryAddress: '0x0000000000000000000000000000000000000001',
    runner: {},
    ...opts,
  });
  // Replace registry with a mock
  guard['registry'] = {
    isRegistered: async () => isRegistered,
  };
  return guard;
}

const WALLET = ethers.Wallet.createRandom();

const BASE_INPUT = {
  from: WALLET.address,
  to: '0x0000000000000000000000000000000000000002',
  serviceType: 'legal.patent-analysis.us.v1',
  price: '50000000000000000',
  token: '0x0000000000000000000000000000000000000000',
  deadline: '2026-03-11T22:00:00Z',
  spec: 'Analyze patent US11234567',
  specHash: '0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1',
};

test('sign and verify a PROPOSE message passes NegotiationGuard', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  assert.equal(proposal.type, 'PROPOSE');
  assert.ok(proposal.sig.startsWith('0x'));
  assert.ok(proposal.timestamp > 0);
  assert.ok(proposal.expiresAt > proposal.timestamp);

  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify(proposal));
  assert.equal(result.valid, true, `expected valid but got error: ${result.error}`);
  assert.equal(result.recoveredSigner.toLowerCase(), WALLET.address.toLowerCase());
});

test('stale timestamp fails with TIMESTAMP_TOO_OLD', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  // Backdate timestamp by 120 seconds (beyond 60s tolerance)
  const stale = { ...proposal, timestamp: proposal.timestamp - 120 };
  // Re-sign with the altered timestamp so signature is valid but timestamp is old
  const { ethers: _ethers } = require('ethers');
  // We just inject a stale timestamp without re-signing — sig will be invalid
  // but timestamp check fires first
  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify(stale));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'TIMESTAMP_TOO_OLD');
});

test('future timestamp fails with TIMESTAMP_IN_FUTURE', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  const future = { ...proposal, timestamp: proposal.timestamp + 120 };
  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify(future));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'TIMESTAMP_IN_FUTURE');
});

test('wrong signer (from mismatch) fails with INVALID_SIGNATURE', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  // Swap from to a different address
  const tampered = {
    ...proposal,
    from: '0x0000000000000000000000000000000000000099',
  };
  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify(tampered));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'INVALID_SIGNATURE');
});

test('replayed nonce fails with NONCE_REPLAYED', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  const guard = makeMockGuard(true);
  const first = await guard.verify(JSON.stringify(proposal));
  assert.equal(first.valid, true);
  const second = await guard.verify(JSON.stringify(proposal));
  assert.equal(second.valid, false);
  assert.equal(second.error, 'NONCE_REPLAYED');
});

test('oversized message fails with MESSAGE_TOO_LARGE', async () => {
  const bigSpec = 'x'.repeat(64 * 1024 + 1);
  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify({ spec: bigSpec }));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'MESSAGE_TOO_LARGE');
});

test('parseNegotiationMessage throws on oversized message', () => {
  const big = JSON.stringify({ type: 'PROPOSE', data: 'x'.repeat(64 * 1024 + 1) });
  assert.throws(() => parseNegotiationMessage(big), /64KB/);
});

test('expired PROPOSE fails with MESSAGE_EXPIRED', async () => {
  const now = Math.floor(Date.now() / 1000);
  // Build a message with expiresAt in the past, but valid timestamp
  const unsigned = {
    type: 'PROPOSE',
    from: WALLET.address,
    to: BASE_INPUT.to,
    serviceType: BASE_INPUT.serviceType,
    price: BASE_INPUT.price,
    token: BASE_INPUT.token,
    deadline: BASE_INPUT.deadline,
    spec: BASE_INPUT.spec,
    specHash: BASE_INPUT.specHash,
    nonce: ethers.hexlify(ethers.randomBytes(16)),
    timestamp: now,
    expiresAt: now - 10, // already expired
  };
  const proposal = await signNegotiationMessage(unsigned, WALLET);
  const guard = makeMockGuard(true);
  const result = await guard.verify(JSON.stringify(proposal));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'MESSAGE_EXPIRED');
});

test('unregistered signer fails with SIGNER_NOT_REGISTERED', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  const guard = makeMockGuard(false); // registry returns false
  const result = await guard.verify(JSON.stringify(proposal));
  assert.equal(result.valid, false);
  assert.equal(result.error, 'SIGNER_NOT_REGISTERED');
});

test('registry downtime fails open (signature-only verification passes)', async () => {
  const proposal = await createSignedProposal(BASE_INPUT, WALLET);
  const guard = makeMockGuard(true);
  // Override registry to throw
  guard['registry'] = { isRegistered: async () => { throw new Error('network error'); } };
  const result = await guard.verify(JSON.stringify(proposal));
  // Should pass with signature-only verification
  assert.equal(result.valid, true);
  assert.equal(result.recoveredSigner.toLowerCase(), WALLET.address.toLowerCase());
});
