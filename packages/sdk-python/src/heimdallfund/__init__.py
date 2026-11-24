"""Heimdall Shield for Python: check a transaction or a signature on Robinhood Chain before your agent signs it.

    from heimdallfund import Shield

    shield = Shield()  # free tier, no key needed
    result = shield.check(sender="0x…", to="0x…", data="0x…", value=0)
    if result["verdict"] != "ALLOW":
        raise SystemExit(result["findings"])

Never sign on DENY. On WARN, ask the user. If the check fails, treat the transaction as unsafe.
"""

from __future__ import annotations

from ._client import AsyncShield, Shield, require_allow
from ._errors import HeimdallDenied, HeimdallError, PaymentRequired
from ._types import CheckResult, Finding, Policy, RiskReport, SignatureCheckResult

__all__ = [
    "Shield",
    "require_allow",
    "AsyncShield",
    "HeimdallError",
    "HeimdallDenied",
    "PaymentRequired",
    "CheckResult",
    "SignatureCheckResult",
    "Finding",
    "Policy",
    "RiskReport",
]
__version__ = "0.3.0"
