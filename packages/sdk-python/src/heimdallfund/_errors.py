from __future__ import annotations

from typing import Any, Mapping


class HeimdallError(Exception):
    """The Shield API answered with an error, or could not be reached. Treat the transaction as unsafe."""

    def __init__(self, message: str, status: int | None = None, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class PaymentRequired(HeimdallError):
    """Over the free tier. Pay per call with x402 (USDG on Robinhood Chain) or pass an API key.

    `requirements` is the base64 JSON from the PAYMENT-REQUIRED header (x402 v2).
    """

    def __init__(self, body: Any, requirements: str | None) -> None:
        super().__init__("Over the free tier: pay per call with x402 or use an API key", 402, body)
        self.requirements = requirements


class HeimdallDenied(Exception):
    """Raised by `require_allow` when Shield does not answer ALLOW."""

    def __init__(self, result: Mapping[str, Any]) -> None:
        notable = [f for f in result.get("findings", []) if f.get("severity") != "info"]
        reason = notable[0]["message"] if notable else "blocked"
        super().__init__(f"Heimdall Shield {result.get('verdict')}: {reason}")
        self.result = result
