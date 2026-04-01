const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Database = require("better-sqlite3");
const { Wallet } = require("ethers");

const {
  buildChallengeMessage,
  consumeAuthChallenge,
  issueAuthChallenge,
} = require("../dist/auth-server.js");
const { SessionManager } = require("../dist/session-manager.js");
const { createSessionMiddleware, routeToCapability } = require("../dist/api.js");
const { checkPermissions, resetPermissionCache } = require("../dist/permission-gate.js");

function createDb() {
  return new Database(":memory:");
}

const authConfig = {
  daemonId: "0x00000000000000000000000000000000000000d1",
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 8453,
  walletAddress: "0x0000000000000000000000000000000000000a11",
};

test("reused challenge is rejected after first successful session issuance", async () => {
  const db = createDb();
  const sessions = new SessionManager(db);
  const owner = Wallet.createRandom();
  const walletAddress = "0x0000000000000000000000000000000000000b01";
  const deps = {
    getWalletOwner: async () => owner.address,
    getWalletsForOwner: async () => [walletAddress],
  };
  const provider = {};

  try {
    const challenge = issueAuthChallenge(sessions, authConfig, walletAddress, "operator");
    assert.equal(
      challenge.challenge,
      buildChallengeMessage(
        challenge.challengeId,
        authConfig.daemonId,
        walletAddress,
        authConfig.chainId,
        "operator",
        challenge.expiresAt
      )
    );

    const signature = await owner.signMessage(challenge.challenge);

    const session = await consumeAuthChallenge(
      sessions,
      authConfig,
      deps,
      provider,
      challenge.challengeId,
      signature
    );
    assert.equal(session.ok, true);
    assert.equal(typeof session.token, "string");

    const reused = await consumeAuthChallenge(
      sessions,
      authConfig,
      deps,
      provider,
      challenge.challengeId,
      signature
    );
    assert.deepEqual(reused, {
      ok: false,
      status: 401,
      error: "challenge_already_used",
    });
  } finally {
    db.close();
  }
});

test("expired challenge is rejected before session issuance", async () => {
  const db = createDb();
  const sessions = new SessionManager(db);
  const owner = Wallet.createRandom();
  const walletAddress = "0x0000000000000000000000000000000000000b02";
  const deps = {
    getWalletOwner: async () => owner.address,
    getWalletsForOwner: async () => [walletAddress],
  };

  try {
    const challenge = issueAuthChallenge(sessions, authConfig, walletAddress, "operator");

    db.prepare("UPDATE auth_challenges SET expires_at = ? WHERE challenge_id = ?")
      .run(Date.now() - 1, challenge.challengeId);

    const signature = await owner.signMessage(challenge.challenge);
    const session = await consumeAuthChallenge(
      sessions,
      authConfig,
      deps,
      {},
      challenge.challengeId,
      signature
    );
    assert.deepEqual(session, {
      ok: false,
      status: 401,
      error: "challenge_expired",
    });
  } finally {
    db.close();
  }
});

test("expired and revoked sessions are rejected by validation", () => {
  const db = createDb();
  const sessions = new SessionManager(db);

  const expiredToken = sessions.createSession("0x0000000000000000000000000000000000000c01", "operator");
  db.prepare("UPDATE sessions SET expires_at = 0 WHERE token_hash = ?")
    .run(require("node:crypto").createHash("sha256").update(expiredToken).digest("hex"));
  assert.equal(sessions.validateSession(expiredToken), null);

  const revokedToken = sessions.createSession("0x0000000000000000000000000000000000000c02", "operator");
  const revokedSession = sessions.validateSession(revokedToken);
  assert.ok(revokedSession);
  sessions.revokeSession(revokedSession.sessionId);
  assert.equal(sessions.validateSession(revokedToken), null);

  db.close();
});

test("session tokens are denied on governance endpoints", async () => {
  const db = createDb();
  const sessions = new SessionManager(db);
  const token = sessions.createSession("0x0000000000000000000000000000000000000d01", "operator");
  const middleware = createSessionMiddleware(db);
  assert.equal(routeToCapability("POST", "/wallet/setGuardian"), "wallet.setGuardian");
  assert.equal(routeToCapability("POST", "/policy/setSpendLimit"), "policy.setSpendLimit");

  const makeReq = (path) => ({
    method: "POST",
    path,
    headers: { authorization: `Bearer ${token}` },
  });
  const makeRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  const guardianRes = makeRes();
  let guardianNext = false;
  middleware(makeReq("/wallet/setGuardian"), guardianRes, () => {
    guardianNext = true;
  });
  assert.equal(guardianNext, false);
  assert.equal(guardianRes.statusCode, 403);
  assert.deepEqual(guardianRes.body, {
    error: "AUTHZ_DENIED",
    capability: "wallet.setGuardian",
  });

  const policyRes = makeRes();
  let policyNext = false;
  middleware(makeReq("/policy/setSpendLimit"), policyRes, () => {
    policyNext = true;
  });
  assert.equal(policyNext, false);
  assert.equal(policyRes.statusCode, 403);
  assert.deepEqual(policyRes.body, {
    error: "AUTHZ_DENIED",
    capability: "policy.setSpendLimit",
  });

  db.close();
});

test("policy violation blocks execution", async () => {
  resetPermissionCache();
  const result = await checkPermissions(
    {
      tool: "arc402_hire",
      input: { price: "0.25" },
      context: {
        agreementId: "agreement-1",
        walletAddress: "0x0000000000000000000000000000000000000e01",
        policyEngineAddress: "0x0000000000000000000000000000000000000e02",
        provider: {},
      },
    },
    {
      createPolicyEngine: () => ({
        validateSpend: {
          staticCall: async () => [false, "daily hire limit exceeded"],
        },
      }),
    }
  );

  assert.deepEqual(result, {
    granted: false,
    reason: "daily hire limit exceeded",
    estimatedSpend: 250000000000000000n,
  });
});

test("policy path fails closed on RPC error", async () => {
  resetPermissionCache();
  const result = await checkPermissions(
    {
      tool: "arc402_hire",
      input: { price: "1.0" },
      context: {
        agreementId: "agreement-2",
        walletAddress: "0x0000000000000000000000000000000000000f01",
        policyEngineAddress: "0x0000000000000000000000000000000000000f02",
        provider: {},
      },
    },
    {
      createPolicyEngine: () => ({
        validateSpend: {
          staticCall: async () => {
            throw new Error("upstream rpc unavailable");
          },
        },
      }),
    }
  );

  assert.equal(result.granted, false);
  assert.equal(result.estimatedSpend, 1000000000000000000n);
  assert.match(result.reason, /^policy_validation_rpc_error: upstream rpc unavailable$/);
});
