import { Command } from "commander";
import { ethers } from "ethers";
import { AgreementStatus, ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { agreementStatusLabel, formatDate, printTable, truncateAddress } from "../utils/format";
import { formatDeadline } from "../utils/time";

// ─── AgreementTree minimal ABI ────────────────────────────────────────────────

const AGREEMENT_TREE_ABI = [
  "function registerSubAgreement(uint256 parentAgreementId, uint256 childAgreementId) external",
  "function getChildren(uint256 agreementId) external view returns (uint256[])",
  "function getRoot(uint256 agreementId) external view returns (uint256)",
  "function getPath(uint256 agreementId) external view returns (uint256[])",
  "function allChildrenSettled(uint256 agreementId) external view returns (bool)",
  "function getDepth(uint256 agreementId) external view returns (uint256)",
];

export function registerAgreementsCommands(program: Command): void {

  // ── arc402 agreements ────────────────────────────────────────────────────────
  program
    .command("agreements")
    .description("List agreements for the configured wallet")
    .option("--as <role>", "client or provider", "client")
    .option("--json")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { provider, address } = await getClient(config);
      if (!address) throw new Error("No wallet configured");
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, provider);
      const agreements = opts.as === "provider"
        ? await client.getProviderAgreements(address)
        : await client.getClientAgreements(address);
      if (opts.json) return console.log(JSON.stringify(agreements, (_k, value) => typeof value === "bigint" ? value.toString() : value, 2));
      printTable(
        ["ID", "COUNTERPARTY", "SERVICE", "DEADLINE", "STATUS"],
        agreements.map((agreement) => [
          agreement.id.toString(),
          truncateAddress(opts.as === "provider" ? agreement.client : agreement.provider),
          agreement.serviceType,
          formatDeadline(Number(agreement.deadline)),
          agreementStatusLabel(agreement.status),
        ])
      );
    });

  // ── arc402 agreement <id> ────────────────────────────────────────────────────
  program
    .command("agreement <id>")
    .description("Show agreement detail, including remediation/dispute fields")
    .option("--json")
    .action(async (id, opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      const { provider } = await getClient(config);
      const client = new ServiceAgreementClient(config.serviceAgreementAddress, provider);
      const agreement = await client.getAgreement(BigInt(id));
      if (opts.json) return console.log(JSON.stringify(agreement, (_k, value) => typeof value === "bigint" ? value.toString() : value, 2));
      console.log(`agreement #${agreement.id}\nclient=${agreement.client}\nprovider=${agreement.provider}\nstatus=${agreementStatusLabel(agreement.status)}\ncreated=${formatDate(Number(agreement.createdAt))}\ndeadline=${formatDate(Number(agreement.deadline))}\nverifyWindowEnd=${Number(agreement.verifyWindowEnd) ? formatDate(Number(agreement.verifyWindowEnd)) : "n/a"}\ncommittedHash=${agreement.committedHash}`);
      if ([AgreementStatus.REVISION_REQUESTED, AgreementStatus.REVISED, AgreementStatus.PARTIAL_SETTLEMENT, AgreementStatus.ESCALATED_TO_HUMAN, AgreementStatus.DISPUTED, AgreementStatus.ESCALATED_TO_ARBITRATION].includes(agreement.status)) {
        const remediation = await client.getRemediationCase(agreement.id);
        const dispute = await client.getDisputeCase(agreement.id);
        console.log(`remediationActive=${remediation.active} cycles=${remediation.cycleCount} disputeOutcome=${dispute.outcome}`);
      }
    });

  // ── arc402 agreements-sub-register ──────────────────────────────────────────
  // Spec 19: arc402 agreements sub-register --parent <id> --child <id>
  program
    .command("agreements-sub-register")
    .description("Link a child agreement to its parent in the AgreementTree (Spec 19)")
    .requiredOption("--parent <id>", "Parent agreement ID")
    .requiredOption("--child <id>", "Child agreement ID to register under the parent")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.agreementTreeAddress) throw new Error("agreementTreeAddress missing in config");
      const { signer } = await getClient(config);
      if (!signer) { console.error("No private key configured."); process.exit(1); }

      const tree = new ethers.Contract(config.agreementTreeAddress, AGREEMENT_TREE_ABI, signer);
      const tx = await tree.registerSubAgreement(BigInt(opts.parent), BigInt(opts.child));
      const receipt = await tx.wait();

      if (opts.json) {
        console.log(JSON.stringify({ txHash: receipt.hash, parentId: opts.parent, childId: opts.child }));
      } else {
        console.log(`Sub-agreement registered.`);
        console.log(`  Parent: ${opts.parent}  Child: ${opts.child}`);
        console.log(`  tx: ${receipt.hash}`);
      }
    });

  // ── arc402 agreements-tree <id> ──────────────────────────────────────────────
  // Spec 19: arc402 agreements tree <agreementId>
  program
    .command("agreements-tree <agreementId>")
    .description("View full agreement tree for an agreement (Spec 19)")
    .option("--json", "Machine-parseable output")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.agreementTreeAddress) throw new Error("agreementTreeAddress missing in config");
      const { provider } = await getClient(config);

      const tree = new ethers.Contract(config.agreementTreeAddress, AGREEMENT_TREE_ABI, provider);

      const id = BigInt(agreementId);
      const [root, path, children, depth] = await Promise.all([
        tree.getRoot(id),
        tree.getPath(id),
        tree.getChildren(id),
        tree.getDepth(id),
      ]);

      const result = {
        agreementId: agreementId,
        root: root.toString(),
        path: (path as bigint[]).map(String),
        children: (children as bigint[]).map(String),
        depth: Number(depth),
      };

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      console.log(`Agreement Tree — node #${agreementId}`);
      console.log(`  Root:     #${result.root}`);
      console.log(`  Depth:    ${result.depth}`);
      console.log(`  Path:     ${result.path.map((p) => "#" + p).join(" → ")}`);
      console.log(`  Children: ${result.children.length > 0 ? result.children.map((c) => "#" + c).join(", ") : "(none)"}`);
    });

  // ── arc402 agreements-tree-status <id> ───────────────────────────────────────
  // Spec 19: arc402 agreements tree-status <agreementId>
  program
    .command("agreements-tree-status <agreementId>")
    .description("Check whether all sub-agreements are settled before delivering (Spec 19)")
    .option("--json", "Machine-parseable output")
    .action(async (agreementId, opts) => {
      const config = loadConfig();
      if (!config.agreementTreeAddress) throw new Error("agreementTreeAddress missing in config");
      const { provider } = await getClient(config);

      const tree = new ethers.Contract(config.agreementTreeAddress, AGREEMENT_TREE_ABI, provider);

      const id = BigInt(agreementId);
      const [allSettled, children] = await Promise.all([
        tree.allChildrenSettled(id),
        tree.getChildren(id),
      ]);

      const result = {
        agreementId: agreementId,
        childCount: (children as bigint[]).length,
        allChildrenSettled: Boolean(allSettled),
        readyToDeliver: Boolean(allSettled),
      };

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      console.log(`Agreement #${agreementId} tree status:`);
      console.log(`  Sub-agreements: ${result.childCount}`);
      console.log(`  All settled:    ${result.allChildrenSettled ? "YES" : "NO"}`);
      console.log(`  Ready to deliver to parent: ${result.readyToDeliver ? "YES" : "NO"}`);
    });
}
