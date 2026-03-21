"""HTTP endpoint helpers — resolve an agent's endpoint from AgentRegistry
and notify it after onchain events (hire, handshake).
"""
from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any

from web3 import Web3

from .abis import AgentRegistry_ABI

DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865"


def resolve_endpoint(
    agent_address: str,
    rpc_url: str,
    registry_address: str = DEFAULT_REGISTRY_ADDRESS,
) -> str:
    """Read an agent's public HTTP endpoint from AgentRegistry.

    Returns an empty string if the agent is not registered or has no endpoint.
    """
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    registry = w3.eth.contract(
        address=Web3.to_checksum_address(registry_address),
        abi=AgentRegistry_ABI,
    )
    agent_data = registry.functions.getAgent(
        Web3.to_checksum_address(agent_address)
    ).call()
    # agent_data is a tuple; endpoint is index 4
    if isinstance(agent_data, (list, tuple)):
        return str(agent_data[4]) if len(agent_data) > 4 else ""
    return str(getattr(agent_data, "endpoint", ""))


def notify_endpoint(
    endpoint: str,
    path: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """POST a JSON payload to ``{endpoint}{path}``.

    Returns ``{"ok": True, "status": <int>}`` on success,
    ``{"ok": False, "error": <str>}`` on any failure. Never raises.
    """
    if not endpoint:
        return {"ok": False, "error": "no endpoint"}
    url = f"{endpoint}{path}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"ok": True, "status": resp.status}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "error": f"HTTP {exc.code}", "status": exc.code}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def notify_hire(
    agent_address: str,
    proposal: dict[str, Any],
    rpc_url: str,
    registry_address: str = DEFAULT_REGISTRY_ADDRESS,
) -> dict[str, Any]:
    """Resolve agent endpoint and POST to /hire."""
    endpoint = resolve_endpoint(agent_address, rpc_url, registry_address)
    return notify_endpoint(endpoint, "/hire", proposal)


def notify_handshake(
    agent_address: str,
    payload: dict[str, Any],
    rpc_url: str,
    registry_address: str = DEFAULT_REGISTRY_ADDRESS,
) -> dict[str, Any]:
    """Resolve agent endpoint and POST to /handshake."""
    endpoint = resolve_endpoint(agent_address, rpc_url, registry_address)
    return notify_endpoint(endpoint, "/handshake", payload)
