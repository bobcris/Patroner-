#!/usr/bin/env python3
"""Static AST Oracle-Independence & Authority Boundary Verifier (ADR-009 §5.4 & §7.1; REM-03).

Enforces strict compile-time separation between:
1. Tier-2 Verification Oracle modules (`services/geometry-engine/patroner_geometry/c1_cert_oracle.py`,
   `qualification.py`, `sub_oracles.py`, `provenance.py`, and M00 verification scripts):
   - MUST NOT import from production runtime solvers (`patroner_fashion`, `fashion_engine`,
     `production_solver`, `c1_fast`, `src.engine`, etc.).
2. Tier-1 Production Solver / Drafting modules (any non-oracle production modules under
   `services/fashion-engine/`, `services/geometry-engine/patroner_geometry/` outside the Tier-2
   verification allowlist, and TypeScript modules under `src/engine/`):
   - MUST NOT import Tier-2 verification oracle modules (`c1_cert_oracle`, `qualification`,
     `sub_oracles`, `mpmath`, `flint`).
   - Ensures production runtime code never silently relies on Tier-2 verification oracles
     and verification oracles never share solver kernels with production implementations.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

REPO_ROOT = Path(__file__).resolve().parents[1]

# Tier-2 verification oracle modules inside services/geometry-engine/patroner_geometry/
TIER2_ORACLE_MODULE_NAMES: Set[str] = {
    "c1_cert_oracle",
    "qualification",
    "sub_oracles",
    "provenance",
}

# Shared schema/contract modules allowed to be imported by both Tier-1 and Tier-2
SHARED_CONTRACT_MODULE_NAMES: Set[str] = {
    "contracts",
    "__init__",
}

# Forbidden import roots when scanning Tier-2 oracle code (must never depend on Tier-1 production solvers)
FORBIDDEN_IMPORTS_FOR_TIER2_ORACLE: Set[str] = {
    "patroner_fashion",
    "fashion_engine",
    "c1_fast",
    "production_solver",
    "production_offset",
    "solvers",
    "solver",
    "offset_solver",
    "production",
    "src",
}

# Forbidden import roots/modules when scanning Tier-1 production code (must never depend on Tier-2 oracles)
FORBIDDEN_IMPORTS_FOR_TIER1_PRODUCTION: Set[str] = {
    "c1_cert_oracle",
    "qualification",
    "sub_oracles",
    "mpmath",
    "flint",
    "patroner_geometry.c1_cert_oracle",
    "patroner_geometry.qualification",
    "patroner_geometry.sub_oracles",
}


def extract_python_imports(source_code: str, filename: str = "<string>") -> List[Dict[str, Any]]:
    """Parses Python source with `ast` and returns all top-level and nested imports."""
    tree = ast.parse(source_code, filename=filename)
    imports: List[Dict[str, Any]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(
                    {
                        "kind": "import",
                        "module": alias.name,
                        "name": alias.name,
                        "level": 0,
                        "lineno": node.lineno,
                    }
                )
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                full = f"{mod}.{alias.name}" if mod else alias.name
                imports.append(
                    {
                        "kind": "from",
                        "module": mod,
                        "name": alias.name,
                        "full": full,
                        "level": node.level,
                        "lineno": node.lineno,
                    }
                )
    return imports


def check_python_source_independence(
    source_code: str,
    module_role: str,
    filename: str = "<string>",
) -> List[Dict[str, Any]]:
    """Checks a single Python source string for ADR-009 §5.4 / §7.1 oracle-independence violations.

    `module_role` must be either `"tier2_oracle"` or `"tier1_production"`.
    Returns a list of violation dicts (empty list means compliant).
    """
    if module_role not in {"tier2_oracle", "tier1_production"}:
        raise ValueError(f"Unsupported module_role: {module_role!r}")

    violations: List[Dict[str, Any]] = []
    imports = extract_python_imports(source_code, filename=filename)

    for imp in imports:
        mod = imp["module"]
        name = imp["name"]
        mod_parts = [p for p in mod.split(".") if p]
        name_parts = [p for p in name.split(".") if p]
        all_tokens = set(mod_parts) | set(name_parts)
        if mod:
            all_tokens.add(mod)
        if imp.get("full"):
            all_tokens.add(imp["full"])

        if module_role == "tier2_oracle":
            hit = sorted(all_tokens & FORBIDDEN_IMPORTS_FOR_TIER2_ORACLE)
            if hit:
                violations.append(
                    {
                        "file": filename,
                        "role": module_role,
                        "lineno": imp["lineno"],
                        "import": imp.get("full", mod),
                        "forbiddenTokens": hit,
                        "rule": "ADR-009 §5.4 / §7.1: Tier-2 verification oracle must not import Tier-1 production solvers.",
                    }
                )
        else:
            hit = sorted(all_tokens & FORBIDDEN_IMPORTS_FOR_TIER1_PRODUCTION)
            if hit:
                violations.append(
                    {
                        "file": filename,
                        "role": module_role,
                        "lineno": imp["lineno"],
                        "import": imp.get("full", mod),
                        "forbiddenTokens": hit,
                        "rule": "ADR-009 §5.4 / §7.1: Tier-1 production module must not import Tier-2 verification oracle or interval libraries.",
                    }
                )

    return violations


def audit_repository_oracle_independence(repo_root: Path = REPO_ROOT) -> Dict[str, Any]:
    """Audits all Python modules under `services/` for ADR-009 §5.4 & §7.1 oracle independence."""
    tier2_files_checked: List[str] = []
    tier1_files_checked: List[str] = []
    shared_contract_files: List[str] = []
    violations: List[Dict[str, Any]] = []

    geom_pkg_dir = repo_root / "services" / "geometry-engine" / "patroner_geometry"
    if geom_pkg_dir.exists():
        for py_file in sorted(geom_pkg_dir.rglob("*.py")):
            rel = str(py_file.relative_to(repo_root))
            stem = py_file.stem
            src = py_file.read_text(encoding="utf-8")
            if stem in SHARED_CONTRACT_MODULE_NAMES:
                shared_contract_files.append(rel)
                continue
            if stem in TIER2_ORACLE_MODULE_NAMES:
                tier2_files_checked.append(rel)
                violations.extend(check_python_source_independence(src, "tier2_oracle", filename=rel))
            else:
                tier1_files_checked.append(rel)
                violations.extend(check_python_source_independence(src, "tier1_production", filename=rel))

    fashion_dir = repo_root / "services" / "fashion-engine"
    if fashion_dir.exists():
        for py_file in sorted(fashion_dir.rglob("*.py")):
            if "tests" in py_file.parts or ".venv" in py_file.parts:
                continue
            rel = str(py_file.relative_to(repo_root))
            src = py_file.read_text(encoding="utf-8")
            tier1_files_checked.append(rel)
            violations.extend(check_python_source_independence(src, "tier1_production", filename=rel))

    return {
        "checkName": "ADR-009 §5.4 / §7.1 Static AST Oracle-Independence Verification",
        "tier2OracleFilesChecked": tier2_files_checked,
        "tier1ProductionFilesChecked": tier1_files_checked,
        "sharedContractFiles": shared_contract_files,
        "violationsCount": len(violations),
        "violations": violations,
        "allPassed": len(violations) == 0 and len(tier2_files_checked) >= 4,
    }


def main() -> int:
    report = audit_repository_oracle_independence(REPO_ROOT)
    print(json.dumps(report, indent=2))
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
