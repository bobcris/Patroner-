"""REM-01 Runtime Provenance, Package-Pin Verification & Deterministic Source-Input Digests.

Eliminates hardcoded package versions and unverified provenance flags in M00 manifests:
- Parses exact `==` version pins directly from `services/geometry-engine/pyproject.toml`.
- Introspects live installed distributions via `importlib.metadata.version(...)`.
- Fails closed whenever any pinned package is missing or mismatched against `pyproject.toml`.
- Computes deterministic SHA-256 digests over all authoritative M00 source inputs, schemas, and lockfiles.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import os
import platform
import re
import sys
import tomllib
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

_EXACT_PIN_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s;,#]+)")


def parse_pyproject_pinned_packages(pyproject_path: Path) -> Dict[str, str]:
    """Extracts all exact `pkg==version` pins declared in `pyproject.toml`."""
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    project = data.get("project", {})
    raw_specs: List[str] = []
    raw_specs.extend(project.get("dependencies", []))
    for extra_deps in project.get("optional-dependencies", {}).values():
        raw_specs.extend(extra_deps)
    for group_deps in data.get("dependency-groups", {}).values():
        for item in group_deps:
            if isinstance(item, str):
                raw_specs.append(item)

    pins: Dict[str, str] = {}
    for spec in raw_specs:
        m = _EXACT_PIN_RE.match(spec)
        if m:
            pkg_name, ver = m.group(1), m.group(2)
            if pkg_name in pins and pins[pkg_name] != ver:
                raise ValueError(f"Conflicting pins for {pkg_name} in {pyproject_path}: {pins[pkg_name]} vs {ver}")
            pins[pkg_name] = ver
    return dict(sorted(pins.items()))


def introspect_runtime_packages(
    expected_pins: Dict[str, str],
    version_lookup: Optional[Any] = None,
    strict: bool = True,
) -> Dict[str, Any]:
    """Introspects installed package versions via `importlib.metadata.version` and checks against `expected_pins`."""
    lookup_fn = version_lookup or importlib.metadata.version
    installed: Dict[str, Optional[str]] = {}
    mismatches: List[Dict[str, Any]] = []

    for pkg_name in sorted(expected_pins.keys()):
        expected_ver = expected_pins[pkg_name]
        try:
            actual_ver = str(lookup_fn(pkg_name))
        except importlib.metadata.PackageNotFoundError:
            actual_ver = None
        installed[pkg_name] = actual_ver
        if actual_ver != expected_ver:
            mismatches.append(
                {
                    "package": pkg_name,
                    "expectedVersion": expected_ver,
                    "installedVersion": actual_ver,
                    "reason": "PACKAGE_NOT_INSTALLED" if actual_ver is None else "VERSION_MISMATCH",
                }
            )

    all_match = len(mismatches) == 0 and len(expected_pins) > 0
    if strict and not all_match:
        raise RuntimeError(f"Runtime package provenance mismatch against pyproject.toml pins: {mismatches}")

    return {
        "expectedPinnedPackages": dict(sorted(expected_pins.items())),
        "installedPackages": installed,
        "mismatches": mismatches,
        "allPinnedPackagesMatch": all_match,
    }


def compute_file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compute_source_inputs_digest(repo_root: Path, relative_paths: Iterable[str]) -> Dict[str, Any]:
    """Computes deterministic per-file SHA-256 hashes and a composite source-inputs SHA-256 digest."""
    entries: List[Dict[str, Any]] = []
    missing: List[str] = []
    canonical_lines: List[str] = []

    for rel in sorted(set(relative_paths)):
        full = repo_root / rel
        if not full.is_file():
            missing.append(rel)
            continue
        raw = full.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        entries.append(
            {
                "path": rel,
                "sha256": digest,
                "bytes": len(raw),
            }
        )
        canonical_lines.append(f"{digest}  {rel}\n")

    composite_digest = hashlib.sha256("".join(canonical_lines).encode("utf-8")).hexdigest()
    return {
        "sourceInputsDigest": composite_digest,
        "filesCount": len(entries),
        "missingFiles": missing,
        "allSourceInputsPresent": len(missing) == 0 and len(entries) > 0,
        "files": entries,
    }


def verify_python312_and_lock_environment(
    engine_dir: Path,
    workflow_path: Path,
    strict: bool = True,
) -> Dict[str, Any]:
    """Verifies live Python 3.12 runtime, `uv.lock` presence, `pyproject.toml` pin parity, and CI workflow enforcement."""
    pyproject_path = engine_dir / "pyproject.toml"
    uv_lock_path = engine_dir / "uv.lock"

    python_is_312 = sys.version_info[:2] == (3, 12)
    pyproject_present = pyproject_path.is_file()
    uv_lock_present = uv_lock_path.is_file() and uv_lock_path.stat().st_size > 0

    expected_pins = parse_pyproject_pinned_packages(pyproject_path) if pyproject_present else {}
    pkg_check = introspect_runtime_packages(expected_pins, strict=False)

    workflow_present = workflow_path.is_file()
    workflow_checks = {
        "workflowExists": workflow_present,
        "hasUvLockCheck": False,
        "hasUvSyncLocked": False,
        "hasPytestRun": False,
        "hasOracleIndependenceCheck": False,
        "hasManifestHashVerification": False,
    }
    if workflow_present:
        wf_text = workflow_path.read_text(encoding="utf-8")
        workflow_checks["hasUvLockCheck"] = "uv lock" in wf_text and "--check" in wf_text
        workflow_checks["hasUvSyncLocked"] = "uv sync" in wf_text and "--locked" in wf_text
        workflow_checks["hasPytestRun"] = "pytest" in wf_text
        workflow_checks["hasOracleIndependenceCheck"] = "check_oracle_independence.py" in wf_text
        workflow_checks["hasManifestHashVerification"] = "M00_ARTIFACT_HASH_VERIFICATION.json" in wf_text

    workflow_verified = all(workflow_checks.values())
    all_verified = bool(
        python_is_312
        and pyproject_present
        and uv_lock_present
        and pkg_check["allPinnedPackagesMatch"]
        and workflow_verified
    )

    if strict and not all_verified:
        raise RuntimeError(
            "M00.9 reproducible Python 3.12 + lockfile provenance check failed: "
            f"python_is_312={python_is_312}, uv_lock_present={uv_lock_present}, "
            f"mismatches={pkg_check['mismatches']}, workflow_checks={workflow_checks}"
        )

    return {
        "pythonVersion": platform.python_version(),
        "pythonVersionInfo": list(sys.version_info[:3]),
        "pythonIs312": python_is_312,
        "pythonRequiresSpec": ">=3.12,<3.13",
        "targetRuntime": f"{platform.system().lower()}-{platform.machine()}",
        "machine": platform.machine(),
        "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "0"),
        "pyprojectPresent": pyproject_present,
        "pyprojectSha256": compute_file_sha256(pyproject_path) if pyproject_present else None,
        "uvLockPresent": uv_lock_present,
        "uvLockSha256": compute_file_sha256(uv_lock_path) if uv_lock_present else None,
        "pinnedPackages": pkg_check["installedPackages"],
        "expectedPinnedPackages": pkg_check["expectedPinnedPackages"],
        "packageMismatches": pkg_check["mismatches"],
        "allPinnedPackagesMatch": pkg_check["allPinnedPackagesMatch"],
        "ciWorkflowPath": ".github/workflows/m00-verification.yml",
        "ciWorkflowChecks": workflow_checks,
        "ciWorkflowVerified": workflow_verified,
        "verified": all_verified,
    }
