from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from threading import Lock
from urllib import error, request


def _json_request(url: str, payload: dict[str, object] | None = None, method: str = "POST") -> dict[str, object]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gateway request failed ({exc.code}): {body}") from exc


def _parse_price_to_atomic(price: str) -> str:
    numeric = price.replace("$", "").strip()
    amount = float(numeric)
    if amount <= 0:
        raise ValueError(f"Invalid NANOPAYMENT_PRICE: {price}")
    return str(round(amount * 1_000_000))


def _parse_atomic_to_usdc(atomic: str) -> float:
    return int(atomic) / 1_000_000


def _get_usdc_address(kind: dict[str, object]) -> str | None:
    extra = kind.get("extra")
    if not isinstance(extra, dict):
        return None
    assets = extra.get("assets")
    if not isinstance(assets, list):
        return None
    for item in assets:
        if not isinstance(item, dict):
            continue
        if item.get("symbol") == "USDC" and isinstance(item.get("address"), str):
            return item["address"]
    return None


@dataclass
class X402Settlement:
    transaction: str
    payer: str
    network: str
    amount_atomic: str
    amount_usdc: float


class X402Gateway:
    def __init__(self, seller_address: str, facilitator_url: str | None = None) -> None:
        self.seller_address = seller_address
        self.facilitator_url = (facilitator_url or "https://gateway-api-testnet.circle.com").rstrip("/")
        self._kinds_cache: list[dict[str, object]] | None = None
        self._lock = Lock()

    def _supported_kinds(self) -> list[dict[str, object]]:
        if self._kinds_cache is not None:
            return self._kinds_cache
        with self._lock:
            if self._kinds_cache is not None:
                return self._kinds_cache
            data = _json_request(f"{self.facilitator_url}/v1/x402/supported", payload=None, method="GET")
            kinds = data.get("kinds")
            if not isinstance(kinds, list):
                raise RuntimeError(f"Unexpected supported response: {data}")
            filtered: list[dict[str, object]] = []
            for kind in kinds:
                if not isinstance(kind, dict):
                    continue
                extra = kind.get("extra")
                if not isinstance(extra, dict):
                    continue
                if not isinstance(extra.get("verifyingContract"), str):
                    continue
                if _get_usdc_address(kind) is None:
                    continue
                filtered.append(kind)
            self._kinds_cache = filtered
            return filtered

    def _requirements(self, price: str, network: str | None = None) -> list[dict[str, object]]:
        amount = _parse_price_to_atomic(price)
        requirements: list[dict[str, object]] = []
        for kind in self._supported_kinds():
            network_name = kind.get("network")
            if not isinstance(network_name, str):
                continue
            if network and network_name != network:
                continue
            usdc_address = _get_usdc_address(kind)
            extra = kind.get("extra")
            if not usdc_address or not isinstance(extra, dict):
                continue
            verifying_contract = extra.get("verifyingContract")
            if not isinstance(verifying_contract, str):
                continue
            requirements.append(
                {
                    "scheme": "exact",
                    "network": network_name,
                    "asset": usdc_address,
                    "amount": amount,
                    "payTo": self.seller_address,
                    "maxTimeoutSeconds": 345600,
                    "extra": {
                        "name": "GatewayWalletBatched",
                        "version": "1",
                        "verifyingContract": verifying_contract,
                    },
                }
            )
        return requirements

    def payment_required_header(self, *, price: str, resource_url: str, description: str) -> str:
        requirements = self._requirements(price)
        if not requirements:
            raise RuntimeError("No payment networks available from Circle Gateway")
        payload = {
            "x402Version": 2,
            "resource": {
                "url": resource_url,
                "description": description,
                "mimeType": "application/json",
            },
            "accepts": requirements,
        }
        return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")

    def verify_and_settle(self, *, price: str, payment_signature_header: str) -> X402Settlement:
        try:
            payment_payload = json.loads(base64.b64decode(payment_signature_header).decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("Invalid Payment-Signature header") from exc

        accepted = payment_payload.get("accepted")
        if not isinstance(accepted, dict) or not isinstance(accepted.get("network"), str):
            raise RuntimeError("Payment payload missing accepted.network")
        network = accepted["network"]

        requirements = self._requirements(price, network=network)
        if not requirements:
            raise RuntimeError(f"Network not accepted: {network}")
        requirement = requirements[0]

        verify_data = _json_request(
            f"{self.facilitator_url}/v1/x402/verify",
            payload={"paymentPayload": payment_payload, "paymentRequirements": requirement},
            method="POST",
        )
        if not verify_data.get("isValid"):
            reason = verify_data.get("invalidReason") or "unknown"
            raise RuntimeError(f"Payment verification failed: {reason}")

        settle_data = _json_request(
            f"{self.facilitator_url}/v1/x402/settle",
            payload={"paymentPayload": payment_payload, "paymentRequirements": requirement},
            method="POST",
        )
        if not settle_data.get("success"):
            reason = settle_data.get("errorReason") or "unknown"
            raise RuntimeError(f"Payment settlement failed: {reason}")

        transaction = str(settle_data.get("transaction") or "")
        payer = str(settle_data.get("payer") or verify_data.get("payer") or "")
        amount_atomic = str(requirement["amount"])

        return X402Settlement(
            transaction=transaction,
            payer=payer,
            network=network,
            amount_atomic=amount_atomic,
            amount_usdc=_parse_atomic_to_usdc(amount_atomic),
        )


def build_gateway_from_env() -> X402Gateway:
    seller_address = os.getenv("NANOPAYMENT_SELLER_ADDRESS")
    if not seller_address:
        raise RuntimeError("NANOPAYMENT_SELLER_ADDRESS is required for paid orchestrate endpoint")
    facilitator_url = os.getenv("NANOPAYMENT_FACILITATOR_URL")
    return X402Gateway(seller_address=seller_address, facilitator_url=facilitator_url)
