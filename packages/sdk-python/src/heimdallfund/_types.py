from __future__ import annotations

from typing import Any, Literal, TypedDict

try:  # Python 3.11+
    from typing import NotRequired
except ImportError:  # pragma: no cover
    from typing_extensions import NotRequired

Verdict = Literal["ALLOW", "WARN", "DENY"]


class Finding(TypedDict):
    code: str
    severity: Literal["info", "warn", "deny"]
    message: str


class Policy(TypedDict, total=False):
    """Per-agent rules Shield applies on top of its own. Amounts are raw integer strings (wei, token units)."""

    strict: bool
    allowTargets: list[str]
    denyTargets: list[str]
    maxNativeOut: str
    maxTokenOut: dict[str, str]
    trustedSpenders: list[str]
    denyUnlimitedApprovals: bool
    allowContractDeploy: bool
    trustedRecipients: list[str]
    trustedDelegates: list[str]


class AssetChange(TypedDict):
    asset: str
    symbol: str
    decimals: int
    kind: Literal["native", "erc20", "erc721"]
    delta: str
    counterparties: list[str]


class Simulation(TypedDict):
    ok: bool
    available: bool
    gasUsed: NotRequired[str]
    revertReason: NotRequired[str]


class CheckResult(TypedDict):
    checkId: str
    verdict: Verdict
    riskScore: int
    summary: list[str]
    findings: list[Finding]
    approvals: list[dict[str, Any]]
    assetChanges: list[AssetChange]
    simulation: Simulation
    decoded: NotRequired[dict[str, Any]]
    receipt: NotRequired[dict[str, Any]]
    shareId: NotRequired[str]


class SignatureCheckResult(TypedDict):
    verdict: Verdict
    riskScore: int
    kind: str
    summary: list[str]
    findings: list[Finding]
    approvals: list[dict[str, Any]]
    shareId: NotRequired[str]


class RiskReport(TypedDict, total=False):
    address: str
    level: int
    levelName: str
    flags: int
    flagNames: list[str]
