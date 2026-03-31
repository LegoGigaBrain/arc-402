"""
ARC-402 Hermes Plugin
=====================
Integrates ARC-402 at the Hermes gateway level.

Requires: Hermes >= v0.6.0 (ctx.inject_message() introduced in v0.6.0)
Install:  Copy to ~/.hermes/plugins/ or the path configured in hermes config.yaml

Config block in hermes config.yaml:
    plugins:
      arc402:
        enabled: true
        wallet_address: "0x..."
        machine_key_env: "ARC402_MACHINE_KEY"
        daemon_port: 4402
        auto_accept: true
        spend_limits:
          hire: 0.1
          compute: 0.05
          arena: 0.05
          general: 0.001
        workroom:
          enabled: true
          agent_id: "hermes-arc"
          inference_endpoint: "http://localhost:8080/v1"
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from typing import Any

logger = logging.getLogger("arc402_plugin")

# ── Hermes plugin metadata ────────────────────────────────────────────────────

PLUGIN_NAME = "arc402"
PLUGIN_VERSION = "1.0.0"
PLUGIN_DESCRIPTION = (
    "ARC-402 gateway integration — autonomous hire interception, spend policy "
    "enforcement, workroom job injection, and on-chain signing via machine key."
)
REQUIRES_HERMES = ">=0.6.0"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run_arc402(args: list[str], machine_key: str | None = None, timeout: int = 30) -> tuple[int, str, str]:
    """
    Run an arc402 CLI command. Returns (returncode, stdout, stderr).
    Machine key is passed via environment, never via CLI args.
    """
    env = os.environ.copy()
    if machine_key:
        env["ARC402_MACHINE_KEY"] = machine_key

    try:
        result = subprocess.run(
            ["arc402"] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", f"arc402 command timed out after {timeout}s: arc402 {' '.join(args)}"
    except FileNotFoundError:
        return -1, "", "arc402 CLI not found — install with: npm install -g arc402-cli"
    except Exception as exc:  # noqa: BLE001
        return -1, "", f"arc402 subprocess error: {exc}"


def _parse_hire_proposal(message: Any) -> dict[str, Any] | None:
    """
    Detect and extract an ARC-402 hire proposal from an incoming message.
    Returns a dict with proposal fields, or None if this is not a hire proposal.

    Hire proposals arrive from the ARC-402 daemon via the message stream.
    They carry a recognisable structure: type="arc402_hire_proposal" plus
    fields that mirror the HireProposal interface in hire-listener.ts.
    """
    if not isinstance(message, dict):
        return None

    msg_type = message.get("type") or message.get("event_type") or ""
    if msg_type not in ("arc402_hire_proposal", "hire_proposal", "arc402.hire"):
        return None

    # Extract canonical fields — daemon may use camelCase or snake_case
    proposal = {
        "message_id": message.get("messageId") or message.get("message_id", ""),
        "hirer_address": message.get("hirerAddress") or message.get("hirer_address", ""),
        "capability": message.get("capability", ""),
        "price_eth": str(message.get("priceEth") or message.get("price_eth") or "0"),
        "deadline_unix": int(message.get("deadlineUnix") or message.get("deadline_unix") or 0),
        "spec_hash": message.get("specHash") or message.get("spec_hash", ""),
        "agreement_id": message.get("agreementId") or message.get("agreement_id", ""),
        "task_description": message.get("taskDescription") or message.get("task_description", ""),
    }

    # Require at minimum a hirer address and capability
    if not proposal["hirer_address"] or not proposal["capability"]:
        return None

    return proposal


def _parse_job_completed(message: Any) -> dict[str, Any] | None:
    """
    Detect a job-completed event from the ARC-402 daemon.
    Returns fields dict or None.
    """
    if not isinstance(message, dict):
        return None

    msg_type = message.get("type") or message.get("event_type") or ""
    if msg_type not in ("arc402_job_completed", "job_completed", "arc402.job.completed"):
        return None

    return {
        "agreement_id": message.get("agreementId") or message.get("agreement_id", ""),
        "root_hash": message.get("rootHash") or message.get("root_hash", ""),
        "capability": message.get("capability", ""),
        "earnings_eth": str(message.get("earningsEth") or message.get("earnings_eth") or "0"),
    }


def _within_spend_limit(price_eth: str, limit_eth: float) -> bool:
    """Return True if price_eth (string) is within limit_eth."""
    try:
        return float(price_eth) <= limit_eth
    except (ValueError, TypeError):
        return False


def _get_active_job_task(daemon_port: int) -> str | None:
    """
    Query the daemon's IPC endpoint for the currently active workroom job.
    Returns task.md contents as a string, or None if no active job.
    """
    import http.client  # noqa: PLC0415

    try:
        conn = http.client.HTTPConnection("127.0.0.1", daemon_port, timeout=5)
        conn.request("GET", "/worker/active-job")
        resp = conn.getresponse()
        if resp.status != 200:
            return None
        body = json.loads(resp.read().decode("utf-8"))
        return body.get("task_description") or body.get("task_md")
    except Exception:  # noqa: BLE001
        return None


# ── Plugin class ──────────────────────────────────────────────────────────────

class ARC402Plugin:
    """
    Hermes v0.6.0 plugin for ARC-402 protocol integration.

    Hooks:
        on_startup(ctx)          — verify daemon, wallet, and machine key on gateway start
        on_message(ctx, message) — intercept hire proposals; auto-accept or hold for user
        on_session_start(ctx)    — inject active job context into agent system prompt
        ctx.inject_message()     — push notifications into conversation stream

    All subprocess calls go through arc402 CLI to avoid duplicating on-chain signing logic.
    The machine key is read from the environment variable named in config (machine_key_env)
    and is NEVER passed to worker processes, logged, or included in injected messages.
    """

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.wallet_address: str = config.get("wallet_address", "")
        self.machine_key_env: str = config.get("machine_key_env", "ARC402_MACHINE_KEY")
        self.daemon_port: int = int(config.get("daemon_port", 4402))
        self.auto_accept: bool = bool(config.get("auto_accept", True))
        self.spend_limits: dict[str, float] = {
            "hire": float(config.get("spend_limits", {}).get("hire", 0.1)),
            "compute": float(config.get("spend_limits", {}).get("compute", 0.05)),
            "arena": float(config.get("spend_limits", {}).get("arena", 0.05)),
            "general": float(config.get("spend_limits", {}).get("general", 0.001)),
        }
        workroom_cfg = config.get("workroom", {})
        self.workroom_enabled: bool = bool(workroom_cfg.get("enabled", True))
        self.workroom_agent_id: str = workroom_cfg.get("agent_id", "hermes-arc")
        self.workroom_inference_endpoint: str = workroom_cfg.get(
            "inference_endpoint", "http://localhost:8080/v1"
        )

        self._machine_key: str | None = None  # loaded lazily in on_startup

    # ── Hook: on_startup ──────────────────────────────────────────────────────

    async def on_startup(self, ctx: Any) -> None:
        """
        Called when the Hermes gateway starts.

        1. Loads the machine key from the environment.
        2. Checks if the ARC-402 daemon is running; starts it if not.
        3. Verifies the wallet is funded and the machine key is authorised.
        4. Logs startup status — does not raise on non-fatal issues (daemon unreachable
           is recoverable; missing machine key is not).
        """
        logger.info("ARC-402 plugin starting up (wallet=%s, daemon_port=%d)",
                    self.wallet_address or "(not set)", self.daemon_port)

        # 1. Load machine key
        machine_key = os.environ.get(self.machine_key_env, "").strip()
        if not machine_key:
            logger.error(
                "ARC-402 plugin: machine key not found in env var %s. "
                "Auto-accept will be disabled.",
                self.machine_key_env,
            )
            self.auto_accept = False
        else:
            self._machine_key = machine_key
            logger.info("ARC-402 plugin: machine key loaded from %s", self.machine_key_env)

        # 2. Check daemon
        rc, stdout, stderr = _run_arc402(["daemon", "status", "--json"], timeout=10)
        if rc != 0:
            logger.warning("ARC-402 daemon not responding (rc=%d, err=%s). Attempting start...", rc, stderr)
            start_rc, _, start_err = _run_arc402(["daemon", "start"], timeout=30)
            if start_rc != 0:
                logger.error("ARC-402 daemon failed to start: %s", start_err)
            else:
                # Wait briefly for daemon to initialise
                time.sleep(2)
                logger.info("ARC-402 daemon started.")
        else:
            try:
                status = json.loads(stdout)
                logger.info("ARC-402 daemon healthy: %s", status.get("status", "ok"))
            except (json.JSONDecodeError, TypeError):
                logger.info("ARC-402 daemon healthy (non-JSON status response).")

        # 3. Verify wallet
        if self.wallet_address:
            rc, stdout, _ = _run_arc402(["wallet", "status", "--json"], timeout=10)
            if rc == 0:
                try:
                    wallet_status = json.loads(stdout)
                    balance = wallet_status.get("balance_eth", "unknown")
                    trust = wallet_status.get("trust_score", "unknown")
                    logger.info("ARC-402 wallet: balance=%s ETH, trust=%s", balance, trust)
                except (json.JSONDecodeError, TypeError):
                    logger.info("ARC-402 wallet status: %s", stdout[:200])
            else:
                logger.warning("ARC-402 wallet status check failed — wallet may not be deployed.")
        else:
            logger.warning("ARC-402 plugin: wallet_address not configured. Some features disabled.")

        # 4. Workroom check
        if self.workroom_enabled:
            rc, _, _ = _run_arc402(["workroom", "status", "--json"], timeout=10)
            if rc != 0:
                logger.warning(
                    "ARC-402 workroom not running. Start with: arc402 workroom start"
                )
            else:
                logger.info("ARC-402 workroom: healthy")

        logger.info(
            "ARC-402 plugin ready. auto_accept=%s, spend_limits=%s",
            self.auto_accept,
            self.spend_limits,
        )

    # ── Hook: on_message ──────────────────────────────────────────────────────

    async def on_message(self, ctx: Any, message: Any) -> Any:
        """
        Called for every incoming message before it reaches the agent.

        If the message is a hire proposal:
          - Validates against spend policy
          - Within limits + auto_accept enabled → machine key signs accept → inject notification
          - Outside limits → inject hold notification for user review
          - Not a proposal → pass through unchanged

        If the message is a job-completed event:
          - Inject completion summary into conversation

        All other messages are returned unchanged.
        """
        # Check for hire proposal
        proposal = _parse_hire_proposal(message)
        if proposal is not None:
            return await self._handle_hire_proposal(ctx, proposal)

        # Check for job completed
        completion = _parse_job_completed(message)
        if completion is not None:
            await self._handle_job_completed(ctx, completion)
            # Return None so the raw daemon event doesn't flood the agent context
            return None

        # Pass everything else through
        return message

    async def _handle_hire_proposal(self, ctx: Any, proposal: dict[str, Any]) -> None:
        """
        Process an incoming hire proposal.
        Returns None — the proposal is consumed and replaced by inject_message notifications.
        """
        capability = proposal["capability"]
        price_eth = proposal["price_eth"]
        hirer = proposal["hirer_address"]
        agreement_id = proposal.get("agreement_id", "")
        task_preview = (proposal.get("task_description") or "")[:200]

        logger.info(
            "ARC-402 hire proposal: capability=%s, price=%s ETH, hirer=%s, agreement=%s",
            capability, price_eth, hirer, agreement_id,
        )

        # Determine relevant spend limit category
        limit = self._resolve_spend_limit(capability)

        if self.auto_accept and self._machine_key and _within_spend_limit(price_eth, limit):
            # Auto-accept path
            logger.info(
                "Auto-accepting: %.6f ETH within limit %.6f ETH for category",
                float(price_eth), limit,
            )
            accepted = await self._accept_hire(proposal)
            if accepted:
                notification = (
                    f"**ARC-402: Job accepted**\n\n"
                    f"- Capability: `{capability}`\n"
                    f"- Price: {price_eth} ETH\n"
                    f"- Hirer: `{hirer}`\n"
                    + (f"- Agreement: `{agreement_id}`\n" if agreement_id else "")
                    + (f"- Task: {task_preview}\n" if task_preview else "")
                    + f"\nJob queued in workroom. Worker will pick it up on next execution cycle."
                )
                await ctx.inject_message(notification, role="system")
            else:
                notification = (
                    f"**ARC-402: Auto-accept failed**\n\n"
                    f"Hire proposal from `{hirer}` (capability: `{capability}`, "
                    f"price: {price_eth} ETH) could not be auto-accepted. "
                    f"Check daemon logs: `arc402 daemon logs`"
                )
                await ctx.inject_message(notification, role="system")
        else:
            # Hold for user review
            if not self.auto_accept:
                reason = "auto_accept is disabled"
            elif not self._machine_key:
                reason = "machine key not configured"
            else:
                reason = f"price {price_eth} ETH exceeds limit {limit:.4f} ETH for this capability"

            logger.info("Holding hire proposal for user review: %s", reason)

            notification = (
                f"**ARC-402: Hire proposal requires approval**\n\n"
                f"- Capability: `{capability}`\n"
                f"- Price: {price_eth} ETH\n"
                f"- Hirer: `{hirer}`\n"
                + (f"- Agreement: `{agreement_id}`\n" if agreement_id else "")
                + (f"- Task: {task_preview}\n" if task_preview else "")
                + f"\n**Reason held:** {reason}\n\n"
                f"To accept manually: `arc402 hire accept {agreement_id or proposal['message_id']}`\n"
                f"To reject: `arc402 hire reject {agreement_id or proposal['message_id']}`"
            )
            await ctx.inject_message(notification, role="system")

        return None

    async def _accept_hire(self, proposal: dict[str, Any]) -> bool:
        """
        Sign and submit hire acceptance via machine key. Returns True on success.
        """
        agreement_id = proposal.get("agreement_id", "")
        message_id = proposal.get("message_id", "")
        target_id = agreement_id or message_id

        if not target_id:
            logger.error("ARC-402: Cannot accept hire — no agreement_id or message_id in proposal")
            return False

        cmd = ["hire", "accept", target_id, "--machine-key-env", self.machine_key_env]
        rc, stdout, stderr = _run_arc402(cmd, machine_key=self._machine_key, timeout=60)

        if rc == 0:
            logger.info("ARC-402: Hire accepted successfully: %s", target_id)
            return True
        else:
            logger.error(
                "ARC-402: Hire accept failed (rc=%d): %s — %s",
                rc, stdout[:200], stderr[:200],
            )
            return False

    async def _handle_job_completed(self, ctx: Any, completion: dict[str, Any]) -> None:
        """Inject a job-completion summary into the conversation."""
        agreement_id = completion.get("agreement_id", "")
        root_hash = completion.get("root_hash", "")
        capability = completion.get("capability", "")
        earnings = completion.get("earnings_eth", "0")

        logger.info(
            "ARC-402 job completed: agreement=%s, root_hash=%s, earnings=%s ETH",
            agreement_id, root_hash, earnings,
        )

        notification = (
            f"**ARC-402: Job completed**\n\n"
            f"- Agreement: `{agreement_id}`\n"
            f"- Capability: `{capability}`\n"
            f"- Root hash: `{root_hash}`\n"
            f"- Earnings: {earnings} ETH\n\n"
            f"Deliverable committed on-chain. Escrow release pending client acceptance."
        )
        await ctx.inject_message(notification, role="system")

    def _resolve_spend_limit(self, capability: str) -> float:
        """
        Map a capability string to the appropriate spend limit.
        Hire limit applies to any capability not otherwise matched.
        """
        cap_lower = capability.lower()
        if "compute" in cap_lower:
            return self.spend_limits["compute"]
        if "arena" in cap_lower or "challenge" in cap_lower:
            return self.spend_limits["arena"]
        # Default to hire limit for all service-type capabilities
        return self.spend_limits["hire"]

    # ── Hook: on_session_start ────────────────────────────────────────────────

    async def on_session_start(self, ctx: Any) -> None:
        """
        Called when a new conversation session starts in the Hermes gateway.

        If there is an active workroom job, injects the task context (task.md contents)
        into the agent's system prompt so the agent is immediately aware of its current
        hired work without needing to poll the daemon.
        """
        if not self.workroom_enabled:
            return

        task_content = _get_active_job_task(self.daemon_port)
        if not task_content:
            return

        logger.info("ARC-402: Active workroom job found — injecting task context into session")

        context_message = (
            "**ARC-402: Active workroom job**\n\n"
            "You have a hired task currently running in the workroom. "
            "If you are the worker agent processing this task, refer to the task details below.\n\n"
            "---\n\n"
            f"{task_content}\n\n"
            "---\n\n"
            "Emit your deliverable using the `<arc402_delivery>` block format when complete."
        )

        await ctx.inject_message(context_message, role="system")


# ── Hermes plugin registration ────────────────────────────────────────────────

def create_plugin(config: dict[str, Any]) -> ARC402Plugin:
    """
    Hermes plugin entry point. Called by the Hermes plugin loader.
    `config` is the dict from the `plugins.arc402` section of hermes config.yaml.
    """
    return ARC402Plugin(config)


# Hermes plugin metadata — read by the plugin loader
plugin_info = {
    "name": PLUGIN_NAME,
    "version": PLUGIN_VERSION,
    "description": PLUGIN_DESCRIPTION,
    "requires_hermes": REQUIRES_HERMES,
    "hooks": ["on_startup", "on_message", "on_session_start"],
    "entry_point": "create_plugin",
}
