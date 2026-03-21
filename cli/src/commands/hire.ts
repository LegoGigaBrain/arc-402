import { Command } from "commander";
import { ServiceAgreementClient, SessionManager } from "@arc402/sdk";
import { ethers } from "ethers";
import { getUsdcAddress, loadConfig } from "../config";
import { requireSigner } from "../client";
import { hashFile, hashString } from "../utils/hash";
import { parseDuration } from "../utils/time";
import { printSenderInfo, executeContractWriteViaWallet } from "../wallet-router";
import { AGENT_REGISTRY_ABI, SERVICE_AGREEMENT_ABI } from "../abis";

const DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

const sessionManager = new SessionManager();

export function registerHireCommand(program: Command): void {
  program
    .command("hire")
    .description("Create the on-chain commitment after off-chain negotiation")
    .requiredOption("--agent <address>")
    .requiredOption("--task <description>")
    .requiredOption("--service-type <type>")
    .option("--max <amount>", "Max price in wei (e.g. 1000000000000000) or ETH (e.g. 0.001eth) or USDC (e.g. 1USDC). Required unless --session is provided.")
    .option("--deadline <duration>", "Deadline as duration (1h, 30m, 7d) or absolute ISO date (2026-04-01). Required unless --session is provided.")
    .option("--token <token>", "eth or usdc", "eth")
    .option("--deliverable-spec <filepath>")
    .option("--session <sessionId>", "Load agreed price and deadline from a completed negotiation session")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { signer, address } = await requireSigner(config);
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, signer);

      let maxAmount: string;
      let deadlineArg: string;
      let transcriptHash: string | undefined;

      if (opts.session) {
        const session = sessionManager.load(opts.session);
        if (session.state !== "ACCEPTED") throw new Error(`Session ${opts.session} is not in ACCEPTED state (state: ${session.state})`);
        if (!session.agreedPrice || !session.agreedDeadline) throw new Error(`Session ${opts.session} is missing agreedPrice or agreedDeadline`);
        maxAmount = session.agreedPrice;
        deadlineArg = session.agreedDeadline;
        transcriptHash = session.transcriptHash;
      } else {
        if (!opts.max) throw new Error("--max is required when --session is not provided. Examples: 0.001eth, 1000000000000000 (wei), 1USDC");
        if (!opts.deadline) throw new Error("--deadline is required when --session is not provided. Examples: 1h, 30m, 7d, 2026-04-01");
        maxAmount = opts.max;
        deadlineArg = opts.deadline;
      }

      // Normalise --max: strip trailing 'eth' or 'USDC' suffix and convert to correct unit
      const useUsdc = String(opts.token).toLowerCase() === "usdc";
      const ethSuffix = /^(\d+(?:\.\d+)?)eth$/i.exec(maxAmount);
      const usdcSuffix = /^(\d+(?:\.\d+)?)usdc$/i.exec(maxAmount);
      if (ethSuffix) maxAmount = String(BigInt(Math.round(parseFloat(ethSuffix[1]) * 1e18)));
      else if (usdcSuffix) maxAmount = usdcSuffix[1]; // keep decimal for USDC path
      const token = useUsdc ? getUsdcAddress(config) : ethers.ZeroAddress;
      let price: bigint;
      try {
        price = useUsdc ? BigInt(Math.round(Number(maxAmount) * 1_000_000)) : BigInt(maxAmount);
      } catch {
        throw new Error(`Invalid --max value "${opts.max}". Use wei (1000000000000000), ETH (0.001eth), or USDC (1USDC)`);
      }
      if (price <= 0n) throw new Error(`--max must be greater than zero`);

      // Pre-flight: check client !== provider (J2-03)
      if (address.toLowerCase() === opts.agent.toLowerCase()) {
        console.error("Cannot hire yourself: client and provider addresses are the same.");
        process.exit(1);
      }

      // Pre-flight: check provider is registered in AgentRegistry (J2-02)
      const agentRegistryAddress = config.agentRegistryV2Address ?? config.agentRegistryAddress;
      if (agentRegistryAddress) {
        const arProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        const arCheck = new ethers.Contract(
          agentRegistryAddress,
          ["function isRegistered(address wallet) external view returns (bool)"],
          arProvider,
        );
        let isRegistered = true;
        try {
          isRegistered = await arCheck.isRegistered(opts.agent);
        } catch { /* assume registered if read fails */ }
        if (!isRegistered) {
          console.error(`Provider ${opts.agent} is not registered in AgentRegistry.`);
          console.error(`Verify the agent address is correct, or check the registry at ${agentRegistryAddress}.`);
          process.exit(1);
        }
      }

      // Pre-flight: check token is allowed on this ServiceAgreement (J2-01)
      if (useUsdc) {
        const saProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        const saCheck = new ethers.Contract(
          config.serviceAgreementAddress,
          ["function allowedTokens(address) external view returns (bool)"],
          saProvider,
        );
        let isAllowed = false;
        try {
          isAllowed = await saCheck.allowedTokens(token);
        } catch { isAllowed = true; /* assume allowed if read fails */ }
        if (!isAllowed) {
          console.error(`Token ${token} is not allowed on this ServiceAgreement.`);
          console.error(`Only the SA owner can allowlist tokens via:`);
          console.error(`  cast send ${config.serviceAgreementAddress} "allowToken(address)" ${token}`);
          console.error(`For ETH payments, use --token eth`);
          process.exit(1);
        }
      }

      // Use spec hash as deliverables hash; if transcript exists, incorporate it
      const baseHash = opts.deliverableSpec ? hashFile(opts.deliverableSpec) : hashString(opts.task);
      const deliverablesHash = transcriptHash
        ? (ethers.keccak256(ethers.toUtf8Bytes(baseHash + transcriptHash)) as `0x${string}`)
        : baseHash;

      // Parse deadline: if it looks like an ISO date, convert to seconds from now
      let deadlineSeconds: number;
      const isoMatch = deadlineArg.match(/^\d{4}-\d{2}-\d{2}/);
      if (isoMatch) {
        const target = Math.floor(new Date(deadlineArg).getTime() / 1000);
        deadlineSeconds = target - Math.floor(Date.now() / 1000);
        if (deadlineSeconds <= 0) throw new Error(`Deadline ${deadlineArg} is in the past`);
      } else {
        deadlineSeconds = parseDuration(deadlineArg);
      }

      printSenderInfo(config);

      let agreementId: bigint;

      if (config.walletContractAddress) {
        // Smart wallet path — wallet handles per-tx USDC approval via maxApprovalAmount
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress,
          signer,
          config.serviceAgreementAddress,
          SERVICE_AGREEMENT_ABI,
          "propose",
          [opts.agent, opts.serviceType, opts.task, price, token, deadlineSeconds, deliverablesHash],
          useUsdc ? 0n : price,   // ETH value forwarded to SA; 0 for USDC agreements
          useUsdc ? token : ethers.ZeroAddress,  // approvalToken for USDC
          useUsdc ? price : 0n,   // maxApprovalAmount for USDC
        );
        const receipt = await tx.wait();
        const saInterface = new ethers.Interface(SERVICE_AGREEMENT_ABI);
        let found = false;
        for (const log of receipt!.logs) {
          if (log.address.toLowerCase() === config.serviceAgreementAddress.toLowerCase()) {
            try {
              const parsed = saInterface.parseLog(log);
              if (parsed?.name === "AgreementProposed") {
                agreementId = parsed.args[0] as bigint;
                found = true;
                break;
              }
            } catch { /* skip unparseable logs */ }
          }
        }
        if (!found) throw new Error("AgreementProposed event not found in transaction receipt");
      } else {
        // EOA path — existing behaviour
        if (useUsdc) {
          const usdc = new ethers.Contract(
            token,
            ["function approve(address spender,uint256 amount) external returns (bool)", "function allowance(address owner,address spender) external view returns (uint256)"],
            signer
          );
          const allowance = await usdc.allowance(address, config.serviceAgreementAddress);
          if (allowance < price) await (await usdc.approve(config.serviceAgreementAddress, price)).wait();
        }

        const result = await client.propose({
          provider: opts.agent,
          serviceType: opts.serviceType,
          description: opts.task,
          price,
          token,
          deadline: deadlineSeconds,
          deliverablesHash,
        });
        agreementId = result.agreementId;
      }

      // Notify provider's HTTP endpoint (non-blocking)
      const hireRegistryAddress = config.agentRegistryV2Address ?? config.agentRegistryAddress ?? DEFAULT_REGISTRY_ADDRESS;
      try {
        const hireProvider = new ethers.JsonRpcProvider(config.rpcUrl);
        const hireRegistry = new ethers.Contract(hireRegistryAddress, AGENT_REGISTRY_ABI, hireProvider);
        const agentData = await hireRegistry.getAgent(opts.agent);
        const endpoint = agentData.endpoint as string;
        if (endpoint) {
          await fetch(`${endpoint}/hire`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agreementId: agreementId!.toString(),
              from: address,
              provider: opts.agent,
              serviceType: opts.serviceType,
              task: opts.task,
              price: price.toString(),
              token,
              deadline: deadlineSeconds,
              deliverablesHash,
            }),
          });
        }
      } catch (err) {
        console.warn(`Warning: could not notify provider endpoint: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (opts.session) {
        sessionManager.setOnChainId(opts.session, agreementId!.toString());
      }

      if (opts.json) {
        const output: Record<string, unknown> = { agreementId: agreementId!.toString(), deliverablesHash };
        if (transcriptHash) output.transcriptHash = transcriptHash;
        if (opts.session) output.sessionId = opts.session;
        return console.log(JSON.stringify(output, null, 2));
      }

      console.log(`agreementId=${agreementId!} deliverablesHash=${deliverablesHash}`);
      if (transcriptHash) console.log(`transcriptHash=${transcriptHash}`);
    });
}
