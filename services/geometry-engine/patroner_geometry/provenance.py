"""REM-01 / PKG-M00-04 Runtime Provenance, Package-Pin Verification, Structural CI Audit & Source-Input Discovery.

Eliminates hardcoded package versions, silent PYTHONHASHSEED defaults, and superficial substring CI checks:
- Parses `requires-python` and exact `==` version pins dynamically from `services/geometry-engine/pyproject.toml`.
- Introspects live installed distributions via `importlib.metadata.version(...)`.
- Reports actual `os.environ.get("PYTHONHASHSEED")` (`"UNSET"` when unset) and fails closed if `PYTHONHASHSEED != "0"`.
- Structurally parses `.github/workflows/m00-verification.yml` jobs/steps (ignoring comments, rejecting `continue-on-error: true`,
  `if: false`, and `|| true`) to verify real enforcement of lock, oracle independence, pytest, 2-subprocess replay, and manifest checks.
- Deterministically discovers all M00 source inputs via documented inclusion/exclusion policy.
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


def parse_pyproject_requires_python(pyproject_path: Path) -> str:
    """Reads `project.requires-python` dynamically from `pyproject.toml`."""
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
    req = data.get("project", {}).get("requires-python")
    if not isinstance(req, str) or not req.strip():
        raise ValueError(f"Missing project.requires-python in {pyproject_path}")
    return req.strip()


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


def discover_m00_source_inputs(repo_root: Path) -> Dict[str, Any]:
    """Deterministically discovers all authoritative M00 source inputs with explicit inclusion/exclusion rules.

    Inclusion policy:
    - All Python source & test modules under `services/geometry-engine/patroner_geometry/` and `services/geometry-engine/tests/`
    - Build/lock manifests: `services/geometry-engine/pyproject.toml`, `services/geometry-engine/uv.lock`, `package.json`, `tsconfig.json`
    - Canonical contract schema: `packages/contracts/schemas/canonical_contracts.schema.json`
    - All M00 verification & export scripts: `scripts/*.py`, `scripts/m00_*.ts`
    - CI workflow: `.github/workflows/m00-verification.yml`
    - TypeScript drafting/export/geometry modules exercised by M00 verification harnesses (`src/engine/drafting/bodice-block.ts`,
      `src/engine/drafting/sleeve-block.ts`, `src/engine/drafting/skirt-block.ts`, `src/engine/export/dxf-aama-exporter.ts`,
      `src/engine/geometry/math.ts`, `src/engine/geometry/offset.ts`, `src/engine/geometry/primitives.ts`)
    - Governing ADRs & M00 workload spec (`ADR-001`, `ADR-003`, `ADR-009`, `M00_MIGRATION_PREPARATION.md`)

    Exclusion policy:
    - `.venv/`, `node_modules/`, `__pycache__/`, `.pytest_cache/`, `dist/`, generated `artifacts/` and root `M00_*.json` outputs
    """
    discovered: set[str] = set()
    excluded_parts = {".venv", "node_modules", "__pycache__", ".pytest_cache", "dist", ".git"}

    def _add_if_valid(p: Path) -> None:
        if not p.is_file():
            return
        rel = p.relative_to(repo_root)
        if any(part in excluded_parts for part in rel.parts):
            return
        discovered.add(rel.as_posix())

    for py_dir in (
        repo_root / "services" / "geometry-engine" / "patroner_geometry",
        repo_root / "services" / "geometry-engine" / "tests",
    ):
        if py_dir.is_dir():
            for p in sorted(py_dir.rglob("*.py")):
                _add_if_valid(p)

    scripts_dir = repo_root / "scripts"
    if scripts_dir.is_dir():
        for p in sorted(scripts_dir.glob("*.py")):
            _add_if_valid(p)
        for p in sorted(scripts_dir.glob("m00_*.ts")):
            _add_if_valid(p)

    explicit_required = [
        ".github/workflows/m00-verification.yml",
        "package.json",
        "tsconfig.json",
        "packages/contracts/schemas/canonical_contracts.schema.json",
        "services/geometry-engine/pyproject.toml",
        "services/geometry-engine/uv.lock",
        "src/engine/drafting/bodice-block.ts",
        "src/engine/drafting/sleeve-block.ts",
        "src/engine/drafting/skirt-block.ts",
        "src/engine/production/dxf-aama-exporter.ts",
        "src/engine/geometry/math.ts",
        "src/engine/geometry/offset.ts",
        "src/engine/geometry/primitives.ts",
        "plan/decisions/ADR-001_AUTHORITATIVE_SYSTEM_BOUNDARY.md",
        "plan/decisions/ADR-003_DETERMINISTIC_GEOMETRY_AND_MANUFACTURING_SAFETY.md",
        "plan/decisions/ADR-009_NUMERICAL_CERTIFICATION_AND_OFFSET_VERIFICATION.md",
        "plan/workloads/M00_MIGRATION_PREPARATION.md",
    ]
    for rel_str in explicit_required:
        discovered.add(rel_str)

    # Also include package-lock.json if present
    if (repo_root / "package-lock.json").is_file():
        discovered.add("package-lock.json")

    return {
        "discoveryPolicy": {
            "includedGlobs": [
                "services/geometry-engine/patroner_geometry/**/*.py",
                "services/geometry-engine/tests/**/*.py",
                "scripts/*.py",
                "scripts/m00_*.ts",
            ],
            "includedExplicitFiles": explicit_required,
            "excludedDirectories": sorted(excluded_parts),
        },
        "paths": sorted(discovered),
    }


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


def parse_github_workflow_steps(workflow_text: str) -> List[Dict[str, Any]]:
    """Structurally parses GitHub Actions workflow jobs and steps without external YAML dependencies.

    Ignores comment lines (`#`), extracts each step's `job`, `name`, `uses`, `run` (single-line or block scalar `|` / `>`),
    `if`, and `continue-on-error` flags, and preserves non-comment executable lines inside `runCommands`.
    """
    lines = workflow_text.splitlines()
    steps: List[Dict[str, Any]] = []

    in_jobs = False
    jobs_indent = -1
    current_job: Optional[str] = None
    job_indent = -1
    in_steps = False
    steps_indent = -1
    current_step: Optional[Dict[str, Any]] = None
    step_item_indent = -1

    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))

        if indent == 0:
            if stripped == "jobs:":
                in_jobs = True
                jobs_indent = 0
                current_job = None
                in_steps = False
                current_step = None
            else:
                in_jobs = False
                current_job = None
                in_steps = False
                current_step = None
            i += 1
            continue

        if not in_jobs:
            i += 1
            continue

        # Detect job header directly under `jobs:`
        if indent > jobs_indent and (job_indent == -1 or indent == job_indent) and stripped.endswith(":") and not stripped.startswith("-"):
            current_job = stripped[:-1].strip()
            job_indent = indent
            in_steps = False
            steps_indent = -1
            current_step = None
            step_item_indent = -1
            i += 1
            continue

        if current_job is None:
            i += 1
            continue

        # Detect `steps:` under current job
        if indent > job_indent and stripped == "steps:":
            in_steps = True
            steps_indent = indent
            current_step = None
            step_item_indent = -1
            i += 1
            continue

        if not in_steps:
            i += 1
            continue

        # Leaving steps block
        if indent <= steps_indent and not stripped.startswith("-"):
            in_steps = False
            current_step = None
            step_item_indent = -1
            continue

        # New step item
        if stripped.startswith("- ") and (step_item_indent == -1 or indent == step_item_indent):
            step_item_indent = indent
            current_step = {
                "job": current_job,
                "name": "",
                "uses": "",
                "run": "",
                "runCommands": [],
                "if": "",
                "continueOnError": False,
            }
            steps.append(current_step)
            rest = stripped[2:].strip()
            if ":" in rest:
                k, v = rest.split(":", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "name":
                    current_step["name"] = v
                elif k == "uses":
                    current_step["uses"] = v
                elif k == "if":
                    current_step["if"] = v
                elif k == "continue-on-error":
                    current_step["continueOnError"] = v.lower() == "true"
                elif k == "run" and v not in ("|", ">", "|-", ">-"):
                    current_step["run"] = v
            i += 1
            continue

        if current_step is not None and indent > step_item_indent:
            if ":" in stripped:
                k, v_raw = stripped.split(":", 1)
                k = k.strip()
                v = v_raw.strip()
                if k == "name":
                    current_step["name"] = v.strip('"').strip("'")
                elif k == "uses":
                    current_step["uses"] = v.strip('"').strip("'")
                elif k == "if":
                    current_step["if"] = v.strip('"').strip("'")
                elif k == "continue-on-error":
                    current_step["continueOnError"] = v.lower() == "true"
                elif k == "run":
                    if v in ("|", ">", "|-", ">-"):
                        block_indent = indent
                        block_lines: List[str] = []
                        i += 1
                        while i < len(lines):
                            braw = lines[i]
                            bstripped = braw.strip()
                            if not bstripped:
                                i += 1
                                continue
                            bindent = len(braw) - len(braw.lstrip(" "))
                            if bindent <= block_indent:
                                break
                            block_lines.append(bstripped)
                            i += 1
                        current_step["run"] = "\n".join(block_lines)
                        continue
                    else:
                        current_step["run"] = v.strip('"').strip("'")
        i += 1

    # Extract non-comment executable commands per step
    for st in steps:
        cmds: List[str] = []
        for ln in st["run"].splitlines():
            s = ln.strip()
            if s and not s.startswith("#"):
                # Strip inline shell comment outside quotes conservatively
                if " #" in s:
                    s = s.split(" #", 1)[0].strip()
                if s:
                    cmds.append(s)
        st["runCommands"] = cmds

    return steps


def audit_ci_workflow_strict(workflow_path: Path) -> Dict[str, Any]:
    """Structurally audits `.github/workflows/m00-verification.yml` step commands (rejecting comments / `|| true` / `if: false`)."""
    workflow_present = workflow_path.is_file()
    checks = {
        "workflowExists": workflow_present,
        "hasUvLockCheck": False,
        "hasUvSyncLocked": False,
        "hasOracleIndependenceCheck": False,
        "hasPytestRun": False,
        "hasTwoSubprocessReplayCheck": False,
        "hasManifestHashVerification": False,
        "hasTypeScriptTypecheckAndTests": False,
        "noSwallowedFailureOrContinueOnError": True,
    }
    if not workflow_present:
        return {"checks": checks, "stepsAuditedCount": 0, "verified": False}

    steps = parse_github_workflow_steps(workflow_path.read_text(encoding="utf-8"))
    ts_has_tsc = False
    ts_has_npm_test = False

    def _is_active_strict_step(st: Dict[str, Any]) -> bool:
        if_expr = st.get("if", "").strip().lower()
        if if_expr in ("false", "${{ false }}"):
            return False
        return True

    for st in steps:
        if not _is_active_strict_step(st):
            continue
        full_run = "\n".join(st["runCommands"])
        if not full_run:
            continue

        matched_required = False
        for cmd in st["runCommands"]:
            if re.search(r"\buv\s+lock\b.*--check\b", cmd):
                checks["hasUvLockCheck"] = True
                matched_required = True
            if re.search(r"\buv\s+sync\b.*--locked\b", cmd):
                checks["hasUvSyncLocked"] = True
                matched_required = True
            if "check_oracle_independence.py" in cmd:
                checks["hasOracleIndependenceCheck"] = True
                matched_required = True
            if re.search(r"\bpytest\b", cmd):
                checks["hasPytestRun"] = True
                matched_required = True
            if "verify_m00_reproducibility.py" in cmd:
                checks["hasTwoSubprocessReplayCheck"] = True
                matched_required = True
            if "verify_m00_manifest.py" in cmd:
                checks["hasManifestHashVerification"] = True
                matched_required = True
            if re.search(r"\btsc\b.*--noEmit\b", cmd):
                ts_has_tsc = True
                matched_required = True
            if re.search(r"\bnpm\s+test\b", cmd):
                ts_has_npm_test = True
                matched_required = True

        if matched_required:
            if st.get("continueOnError", False) or "|| true" in full_run or "||true" in full_run:
                checks["noSwallowedFailureOrContinueOnError"] = False

    checks["hasTypeScriptTypecheckAndTests"] = ts_has_tsc and ts_has_npm_test
    return {
        "checks": checks,
        "stepsAuditedCount": len(steps),
        "verified": all(checks.values()),
    }


def verify_python312_and_lock_environment(
    engine_dir: Path,
    workflow_path: Path,
    strict: bool = True,
) -> Dict[str, Any]:
    """Verifies live Python 3.12 runtime, `PYTHONHASHSEED == '0'`, `uv.lock`, `pyproject.toml` pin parity,
    and structural CI workflow enforcement.
    """
    pyproject_path = engine_dir / "pyproject.toml"
    uv_lock_path = engine_dir / "uv.lock"

    python_is_312 = sys.version_info[:2] == (3, 12)
    pyproject_present = pyproject_path.is_file()
    uv_lock_present = uv_lock_path.is_file() and uv_lock_path.stat().st_size > 0

    raw_hash_seed = os.environ.get("PYTHONHASHSEED")
    actual_hash_seed = raw_hash_seed if raw_hash_seed is not None else "UNSET"
    python_hash_seed_is_zero = raw_hash_seed == "0"

    python_requires_spec = parse_pyproject_requires_python(pyproject_path) if pyproject_present else "MISSING"
    expected_pins = parse_pyproject_pinned_packages(pyproject_path) if pyproject_present else {}
    pkg_check = introspect_runtime_packages(expected_pins, strict=False)

    workflow_audit = audit_ci_workflow_strict(workflow_path)
    workflow_checks = workflow_audit["checks"]
    workflow_verified = workflow_audit["verified"]

    all_verified = bool(
        python_is_312
        and python_hash_seed_is_zero
        and pyproject_present
        and uv_lock_present
        and pkg_check["allPinnedPackagesMatch"]
        and workflow_verified
    )

    if strict and not all_verified:
        raise RuntimeError(
            "M00.9 reproducible Python 3.12 + PYTHONHASHSEED=0 + lockfile provenance check failed: "
            f"python_is_312={python_is_312}, python_hash_seed={actual_hash_seed!r}, "
            f"uv_lock_present={uv_lock_present}, mismatches={pkg_check['mismatches']}, "
            f"workflow_checks={workflow_checks}"
        )

    return {
        "pythonVersion": platform.python_version(),
        "pythonVersionInfo": list(sys.version_info[:3]),
        "pythonIs312": python_is_312,
        "pythonRequiresSpec": python_requires_spec,
        "targetRuntime": f"{platform.system().lower()}-{platform.machine()}",
        "machine": platform.machine(),
        "pythonHashSeed": actual_hash_seed,
        "pythonHashSeedIsZero": python_hash_seed_is_zero,
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
        "ciWorkflowStepsAudited": workflow_audit["stepsAuditedCount"],
        "ciWorkflowVerified": workflow_verified,
        "verified": all_verified,
    }
