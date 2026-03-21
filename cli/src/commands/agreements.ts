import { Command } from "commander";
import { ethers } from "ethers";
import * as readline from "readline";
import { AgreementStatus, ServiceAgreementClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { agreementStatusLabel, formatDate, printTable, truncateAddress } from "../utils/format";
import { formatDeadline } from "../utils/time";
import { hashString } from "../utils/hash";
import { c } from "../ui/colors";
import { renderTree } from "../ui/tree";
import { formatAddress } from "../ui/format";

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
      console.log('\n ' + c.mark + c.white(` Agreement #${agreement.id}`));
      renderTree([
        { label: 'Client', value: formatAddress(agreement.client) },
        { label: 'Provider', value: formatAddress(agreement.provider) },
        { label: 'Status', value: agreementStatusLabel(agreement.status) },
        { label: 'Created', value: formatDate(Number(agreement.createdAt)) },
        { label: 'Deadline', value: formatDate(Number(agreement.deadline)) },
        { label: 'Verify end', value: Number(agreement.verifyWindowEnd) ? formatDate(Number(agreement.verifyWindowEnd)) : 'n/a' },
        { label: 'Hash', value: String(agreement.committedHash), last: true },
      ]);
      if ([AgreementStatus.REVISION_REQUESTED, AgreementStatus.REVISED, AgreementStatus.PARTIAL_SETTLEMENT, AgreementStatus.ESCALATED_TO_HUMAN, AgreementStatus.DISPUTED, AgreementStatus.ESCALATED_TO_ARBITRATION].includes(agreement.status)) {
        const remediation = await client.getRemediationCase(agreement.id);
        const dispute = await client.getDisputeCase(agreement.id);
        renderTree([
          { label: 'Remediation', value: `active=${remediation.active} cycles=${remediation.cycleCount}` },
          { label: 'Dispute', value: `outcome=${dispute.outcome}`, last: true },
        ]);
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
        console.log('\n ' + c.mark + c.white(' Sub-agreement registered'));
        renderTree([
          { label: 'Parent', value: `#${opts.parent}` },
          { label: 'Child', value: `#${opts.child}` },
          { label: 'Tx', value: receipt.hash, last: true },
        ]);
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

      console.log('\n ' + c.mark + c.white(` Agreement Tree — node #${agreementId}`));
      renderTree([
        { label: 'Root', value: `#${result.root}` },
        { label: 'Depth', value: String(result.depth) },
        { label: 'Path', value: result.path.map((p) => "#" + p).join(" → ") },
        { label: 'Children', value: result.children.length > 0 ? result.children.map((ch) => "#" + ch).join(", ") : "(none)", last: true },
      ]);
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

      console.log('\n ' + c.mark + c.white(` Agreement #${agreementId} — tree status`));
      renderTree([
        { label: 'Sub-agrmts', value: String(result.childCount) },
        { label: 'All settled', value: result.allChildrenSettled ? 'YES' : 'NO' },
        { label: 'Ready', value: result.readyToDeliver ? 'YES — ready to deliver to parent' : 'NO', last: true },
      ]);
    });

  // ── arc402 agreements-create-tree ────────────────────────────────────────────
  // Spec 19: interactive multi-party agreement setup
  // Usage: arc402 agreements-create-tree \
  //   --provider <addr> --task <desc> --service-type <type> --price <wei> --deadline <s> \
  //   --sub <addr>,<task>,<type>,<wei>,<deadline> [--sub ...]
  program
    .command("agreements-create-tree")
    .description("Create a multi-party agreement tree: one root agreement plus sub-agreements (Spec 19)")
    .requiredOption("--provider <address>", "Root provider (Agent B)")
    .requiredOption("--task <description>", "Root task description")
    .requiredOption("--service-type <type>", "Root service type")
    .requiredOption("--price <wei>", "Root price in wei")
    .requiredOption("--deadline <seconds>", "Root deadline offset in seconds from now")
    .option(
      "--sub <spec>",
      "Sub-agreement in format <provider>,<task>,<serviceType>,<priceWei>,<deadlineSeconds>. Repeatable.",
      (val: string, acc: string[]) => { acc.push(val); return acc; },
      [] as string[],
    )
    .option("--interactive", "Prompt interactively for sub-agreements")
    .option("--json", "Machine-parseable output")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
      if (!config.agreementTreeAddress) throw new Error("agreementTreeAddress missing in config");
      const { signer } = await getClient(config);
      if (!signer) { console.error("No private key configured."); process.exit(1); }

      type SubSpec = { provider: string; task: string; serviceType: string; price: bigint; deadline: number };
      const subSpecs: SubSpec[] = [];

      // Parse --sub flags
      for (const raw of opts.sub as string[]) {
        const parts = raw.split(",");
        if (parts.length < 5) {
          console.error(`--sub format: <provider>,<task>,<serviceType>,<priceWei>,<deadlineSeconds>  got: ${raw}`);
          process.exit(1);
        }
        subSpecs.push({
          provider: parts[0],
          task: parts.slice(1, parts.length - 3).join(",") || parts[1],
          serviceType: parts[parts.length - 3],
          price: BigInt(parts[parts.length - 2]),
          deadline: Number(parts[parts.length - 1]),
        });
      }

      // Interactive mode: prompt for sub-agreements if no --sub flags provided
      if (opts.interactive || subSpecs.length === 0) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

        console.log("\nMulti-party agreement setup — add sub-agreements (leave provider blank to finish)");
        while (true) {
          const provider = await ask("  Sub-provider address (blank to finish): ");
          if (!provider.trim()) break;
          const task = await ask("  Task description: ");
          const serviceType = await ask("  Service type: ");
          const priceRaw = await ask("  Price (wei): ");
          const deadlineRaw = await ask("  Deadline offset (seconds): ");
          subSpecs.push({
            provider: provider.trim(),
            task: task.trim(),
            serviceType: serviceType.trim(),
            price: BigInt(priceRaw.trim()),
            deadline: Number(deadlineRaw.trim()),
          });
        }
        rl.close();
      }

      const saContract = new ethers.Contract(config.serviceAgreementAddress, [
        "function propose(address provider, string serviceType, string description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable returns (uint256)",
        "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
      ], signer);
      const treeContract = new ethers.Contract(config.agreementTreeAddress, AGREEMENT_TREE_ABI, signer);

      const rootPrice = BigInt(opts.price);
      const rootDeadline = Number(opts.deadline);
      const rootHash = hashString(opts.task);

      if (!opts.json) console.log('\n ' + c.mark + c.white(` Proposing root agreement to ${opts.provider}...`));
      const rootTx = await saContract.propose(
        opts.provider, opts.serviceType, opts.task,
        rootPrice, ethers.ZeroAddress, rootDeadline, rootHash,
        { value: rootPrice },
      );
      const rootReceipt = await rootTx.wait();
      const iface = new ethers.Interface([
        "event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline)",
      ]);
      let rootAgreementId: bigint | undefined;
      for (const log of rootReceipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "AgreementProposed") { rootAgreementId = BigInt(parsed.args.id); break; }
        } catch { /* skip */ }
      }
      if (rootAgreementId === undefined) throw new Error("Could not parse root AgreementProposed event");

      if (!opts.json) console.log(' ' + c.success + c.white(` Root agreement ID: #${rootAgreementId}`));

      const childAgreementIds: bigint[] = [];
      for (const sub of subSpecs) {
        if (!opts.json) console.log(' ' + c.dim(`  Proposing sub-agreement to ${sub.provider}...`));
        const subHash = hashString(sub.task);
        const subTx = await saContract.propose(
          sub.provider, sub.serviceType, sub.task,
          sub.price, ethers.ZeroAddress, sub.deadline, subHash,
          { value: sub.price },
        );
        const subReceipt = await subTx.wait();
        let childId: bigint | undefined;
        for (const log of subReceipt.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "AgreementProposed") { childId = BigInt(parsed.args.id); break; }
          } catch { /* skip */ }
        }
        if (childId === undefined) throw new Error(`Could not parse AgreementProposed for sub-agreement to ${sub.provider}`);
        if (!opts.json) console.log(' ' + c.success + c.white(` Sub-agreement #${childId} — registering in tree...`));
        await (await treeContract.registerSubAgreement(rootAgreementId, childId)).wait();
        childAgreementIds.push(childId);
      }

      const result = {
        rootAgreementId: rootAgreementId.toString(),
        childAgreementIds: childAgreementIds.map(String),
        txHash: rootReceipt.hash,
      };

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('\n ' + c.mark + c.white(' Agreement tree created'));
        renderTree([
          { label: 'Root', value: `#${result.rootAgreementId}` },
          {
            label: 'Children',
            value: result.childAgreementIds.length > 0
              ? result.childAgreementIds.map((id) => "#" + id).join(", ")
              : "(none — sub-agreements can be added with agreements-sub-register)",
            last: true,
          },
        ]);
      }
    });

  // ── arc402 agreements-tree <id> (alias) already exists above ─────────────────
  // The spec also refers to this as "arc402 agreements tree <id>" — the flat
  // command agreements-tree <agreementId> above fulfils that requirement.
}
