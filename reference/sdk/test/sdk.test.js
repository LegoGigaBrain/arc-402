const test = require('node:test');
const assert = require('node:assert/strict');
const { createNegotiationProposal, createNegotiationAccept, AgreementStatus, ProviderResponseType, DisputeOutcome, EvidenceType, ArbitrationVote } = require('../dist');

test('negotiation helpers generate shaped messages', () => {
  const proposal = createNegotiationProposal({ from: '0x1', to: '0x2', serviceType: 'legal.patent-analysis.us.v1', price: '1', token: '0x0000000000000000000000000000000000000000', deadline: '2026-03-11T22:00:00Z', spec: 'Analyze filing', specHash: '0xabc' });
  assert.equal(proposal.type, 'PROPOSE');
  assert.ok(proposal.nonce.startsWith('0x'));
  const accept = createNegotiationAccept({ from: '0x2', to: '0x1', agreedPrice: '1', agreedDeadline: '2026-03-11T22:00:00Z', refNonce: proposal.nonce });
  assert.equal(accept.refNonce, proposal.nonce);
});

test('enum surfaces include remediation and dispute workflow states', () => {
  assert.equal(AgreementStatus.REVISION_REQUESTED, 6);
  assert.equal(ProviderResponseType.REQUEST_HUMAN_REVIEW, 5);
  assert.equal(DisputeOutcome.PARTIAL_PROVIDER, 4);
  assert.equal(EvidenceType.DELIVERABLE, 2);
  assert.equal(ArbitrationVote.SPLIT, 3);
});
