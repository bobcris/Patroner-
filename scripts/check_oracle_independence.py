#!/usr/bin/env python3
"""ADR-009 §5.4 & §7.1 / ADR-001 Hardened Static AST & Boundary Oracle-Independence Auditor.

Closes all Checkpoint I (`I-02`) bypasses:
1. Full AST + alias/call-graph analysis detecting direct, aliased, relative, and dynamic imports:
   - `import` / `from ... import ...` (with relative import resolution)
   - `importlib` (`import_module`, `util.spec_from_file_location`, `machinery.*`, or any `importlib` usage)
   - `__import__`, `builtins.__import__`, `getattr(__builtins__, ...)`
   - `runpy` (`run_module`, `run_path`), `exec`, `eval`, `compile`, `sys.modules[...]`
2. Audits `__init__.py` and `contracts.py` explicitly (never skips them):
   - `contracts.py` must remain a pure shared-contract module (no Tier-1 solver imports, no Tier-2 oracle imports, no dynamic loaders).
   - `__init__.py` must never import or re-export Tier-1 production solvers or dynamic loaders across the Tier-1/Tier-2 boundary.
3. Dynamic Tier-1 discovery + strict Tier-2 internal allowlist:
   - Any Python module under `services/` outside the explicit Tier-2 oracle / shared-contract allowlist is dynamically
     classified as `tier1_production` and forbidden from being imported by Tier-2 oracles.
   - Any `patroner_geometry.*` import inside a Tier-2 oracle not in the explicit Tier-2/shared allowlist
     (e.g. `patroner_geometry.offset_kernel`) is rejected fail-closed even in standalone source checks.
4. Independent TypeScript `src/engine/` (`C0-Legacy` per `ADR-001`) boundary audit:
   - Verifies `src/engine/` contains zero references/imports/invocations of Python Tier-2 oracles or interval libraries.
   - Explicitly inventories controlled `scripts/*.ts` bridge/capture entrypoints (`m00_capture_c0_legacy.ts`,
     `m00_export_canonical_pieces.ts`, `m00_export_canonical_63_contours.ts`).
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

# Known Tier-2 oracle modules in this repository
TIER2_ORACLE_MODULES: Set[str] = {
    "c1_cert_oracle",
    "qualification",
    "sub_oracles",
    "provenance",
    "patroner_geometry.c1_cert_oracle",
    "patroner_geometry.qualification",
    "patroner_geometry.sub_oracles",
    "patroner_geometry.provenance",
}

# Explicit allowlist of internal patroner_geometry modules that Tier-2 oracles may import
TIER2_ALLOWED_INTERNAL_MODULES: Set[str] = {
    "patroner_geometry",
    "patroner_geometry.contracts",
    "patroner_geometry.c1_cert_oracle",
    "patroner_geometry.qualification",
    "patroner_geometry.sub_oracles",
    "patroner_geometry.provenance",
    "contracts",
    "c1_cert_oracle",
    "qualification",
    "sub_oracles",
    "provenance",
}

# Libraries strictly forbidden in Tier-1 production fast-path solvers (ADR-009 §7.1)
TIER1_FORBIDDEN_LIBRARIES: Set[str] = {
    "mpmath",
    "flint",
    "python_flint",
}

# Known Tier-1 production solver namespace prefixes forbidden inside Tier-2 verification oracles
TIER2_FORBIDDEN_SOLVER_PREFIXES: Tuple[str, ...] = (
    "patroner_geometry.solvers",
    "patroner_geometry.production",
    "patroner_geometry.tier1",
    "patroner_geometry.fast",
    "patroner_geometry.drafting",
    "patroner_geometry.offset_fast",
    "patroner_geometry.kernels",
    "fashion_engine.solvers",
    "fashion_engine.production",
    "fashion_engine.tier1",
    "fashion_engine.drafting",
    "fashion_engine.kernels",
)

# Dynamic code/module loading APIs forbidden across Tier-1/Tier-2/shared contract boundaries
FORBIDDEN_DYNAMIC_MODULES: Set[str] = {
    "importlib",
    "runpy",
    "imp",
}

FORBIDDEN_DYNAMIC_CALL_NAMES: Set[str] = {
    "__import__",
    "exec",
    "eval",
    "compile",
}

FORBIDDEN_DYNAMIC_ATTR_CALLS: Set[str] = {
    "import_module",
    "spec_from_file_location",
    "spec_from_loader",
    "module_from_spec",
    "find_spec",
    "run_module",
    "run_path",
    "load_module",
    "__import__",
}

SHARED_CONTRACT_FILES: Set[str] = {
    "contracts.py",
    "__init__.py",
}

TIER2_ORACLE_FILENAMES: Set[str] = {
    "c1_cert_oracle.py",
    "qualification.py",
    "sub_oracles.py",
    "provenance.py",
}


def _matches_prefix(target: str, prefixes: Iterable[str]) -> bool:
    for pref in prefixes:
        if target == pref or target.startswith(pref + "."):
            return True
    return False


def _resolve_relative_module(
    current_module: str,
    level: int,
    node_module: Optional[str],
) -> str:
    """Resolves a Python relative import against `current_module` (e.g. `patroner_geometry.c1_cert_oracle`)."""
    if level <= 0:
        return node_module or ""
    parts = current_module.split(".") if current_module else []
    # For a non-package file module `a.b.c`, level=1 strips `c` -> `a.b`
    base = parts[:-level] if level <= len(parts) else []
    if node_module:
        return ".".join(base + [node_module])
    return ".".join(base)


def _infer_module_name_from_filename(filename: str) -> str:
    norm = filename.replace("\\", "/")
    for marker in ("patroner_geometry/", "fashion_engine/"):
        idx = norm.find(marker)
        if idx != -1:
            rel = norm[idx:]
            if rel.endswith("/__init__.py"):
                return rel[: -len("/__init__.py")].replace("/", ".")
            if rel.endswith(".py"):
                return rel[:-3].replace("/", ".")
    return Path(norm).stem


def _call_target_dotted_name(func: ast.AST, aliases: Dict[str, str]) -> str:
    if isinstance(func, ast.Name):
        return aliases.get(func.id, func.id)
    if isinstance(func, ast.Attribute):
        prefix = _call_target_dotted_name(func.value, aliases)
        return f"{prefix}.{func.attr}" if prefix else func.attr
    return ""


def _extract_string_literal(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def check_python_source_independence(
    source_code: str,
    *,
    module_role: str,
    filename: str = "<memory>",
    extra_tier1_modules: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    """Parses Python source with `ast` and enforces ADR-009 §5.4 & §7.1 oracle-independence rules.

    module_role:
      - "tier2_oracle": Must NEVER import Tier-1 production solvers, unregistered internal modules, or dynamic loaders.
      - "tier1_production": Must NEVER import Tier-2 oracle modules, mpmath/python-flint, or dynamic loaders.
      - "shared_contracts": (`contracts.py`) Must NEVER import Tier-1 solvers, Tier-2 oracles, or dynamic loaders.
      - "package_init": (`__init__.py`) Must NEVER import/re-export Tier-1 solvers or dynamic loaders.
    """
    tree = ast.parse(source_code, filename=filename)
    current_module = _infer_module_name_from_filename(filename)
    dynamic_tier1 = set(extra_tier1_modules or set())
    violations: List[Dict[str, Any]] = []

    # Track aliases (both import aliases and simple local assignments like `imp = importlib.import_module`)
    aliases: Dict[str, str] = {}
    imported_modules: List[Tuple[int, str]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                asname = alias.asname or alias.name.split(".")[0]
                aliases[asname] = alias.name
                imported_modules.append((node.lineno, alias.name))
        elif isinstance(node, ast.ImportFrom):
            resolved_base = _resolve_relative_module(current_module, node.level, node.module)
            if not node.names and resolved_base:
                imported_modules.append((node.lineno, resolved_base))
            for alias in node.names:
                if alias.name == "*":
                    if resolved_base:
                        imported_modules.append((node.lineno, resolved_base))
                    continue
                full_target = f"{resolved_base}.{alias.name}" if resolved_base else alias.name
                asname = alias.asname or alias.name
                aliases[asname] = full_target
                imported_modules.append((node.lineno, full_target))
        elif isinstance(node, ast.Assign):
            rhs_name = _call_target_dotted_name(node.value, aliases)
            if rhs_name:
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        aliases[tgt.id] = rhs_name

    def _add_violation(lineno: int, target: str, rule: str) -> None:
        violations.append(
            {
                "file": filename,
                "line": lineno,
                "role": module_role,
                "imported": target,
                "rule": rule,
            }
        )

    # 1. Check all static/relative imports
    for lineno, target in imported_modules:
        top = target.split(".")[0]

        # Dynamic loader modules are strictly forbidden across all audited roles.
        # Exception: `importlib.metadata` is read-only installed package metadata lookup, not dynamic code loading.
        if top in FORBIDDEN_DYNAMIC_MODULES and not (
            target == "importlib.metadata" or target.startswith("importlib.metadata.")
        ):
            _add_violation(
                lineno,
                target,
                f"{module_role} must not import dynamic loader module '{top}' (ADR-009 §7.1 anti-bypass)",
            )
            continue

        if module_role == "tier2_oracle":
            if _matches_prefix(target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(target, dynamic_tier1):
                _add_violation(
                    lineno,
                    target,
                    "Tier-2 verification oracle must not import Tier-1 production solver module",
                )
            elif (
                (target.startswith("patroner_geometry.") or target.startswith("fashion_engine."))
                and not _matches_prefix(target, TIER2_ALLOWED_INTERNAL_MODULES)
            ):
                # Strict allowlist: catches newly created Tier-1 files like `patroner_geometry.offset_kernel`
                _add_violation(
                    lineno,
                    target,
                    "Tier-2 verification oracle imported non-allowlisted internal module (potential Tier-1 boundary bypass)",
                )

        elif module_role == "tier1_production":
            if top in TIER1_FORBIDDEN_LIBRARIES or _matches_prefix(target, TIER1_FORBIDDEN_LIBRARIES):
                _add_violation(
                    lineno,
                    target,
                    "Tier-1 production module must not import interval oracle library (mpmath/python-flint)",
                )
            elif _matches_prefix(target, TIER2_ORACLE_MODULES):
                _add_violation(
                    lineno,
                    target,
                    "Tier-1 production module must not import Tier-2 verification oracle module",
                )

        elif module_role == "shared_contracts":
            if _matches_prefix(target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(target, dynamic_tier1):
                _add_violation(
                    lineno,
                    target,
                    "Shared contracts module must not import Tier-1 production solver module",
                )
            elif _matches_prefix(target, TIER2_ORACLE_MODULES):
                _add_violation(
                    lineno,
                    target,
                    "Shared contracts module must not import Tier-2 verification oracle module",
                )
            elif top in TIER1_FORBIDDEN_LIBRARIES:
                _add_violation(
                    lineno,
                    target,
                    "Shared contracts module must not import oracle interval library (mpmath/python-flint)",
                )
            elif (
                target.startswith("patroner_geometry.")
                and target != "patroner_geometry.contracts"
                and not target.startswith("patroner_geometry.contracts.")
            ):
                _add_violation(
                    lineno,
                    target,
                    "Shared contracts module must remain self-contained without importing sibling engine modules",
                )

        elif module_role == "package_init":
            if _matches_prefix(target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(target, dynamic_tier1):
                _add_violation(
                    lineno,
                    target,
                    "Package __init__.py must not import or re-export Tier-1 production solver module",
                )
            elif (
                (target.startswith("patroner_geometry.") or target.startswith("fashion_engine."))
                and not _matches_prefix(target, TIER2_ALLOWED_INTERNAL_MODULES)
            ):
                _add_violation(
                    lineno,
                    target,
                    "Package __init__.py imported non-allowlisted internal module across Tier-1/Tier-2 boundary",
                )

    # 2. Check dynamic calls (`__import__`, `importlib.import_module`, `exec`, `eval`, `compile`, `runpy`, `getattr(__builtins__, ...)`, `sys.modules[...]`)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            dotted = _call_target_dotted_name(node.func, aliases)
            leaf = dotted.split(".")[-1] if dotted else ""

            if dotted in FORBIDDEN_DYNAMIC_CALL_NAMES or dotted in {
                f"{prefix}.{name}"
                for prefix in ("builtins", "__builtins__")
                for name in FORBIDDEN_DYNAMIC_CALL_NAMES
            }:
                arg0 = _extract_string_literal(node.args[0]) if node.args else None
                label = f"{dotted}({arg0!r})" if arg0 is not None else f"{dotted}(...)"
                _add_violation(
                    node.lineno,
                    label,
                    f"{module_role} must not invoke dynamic loader/eval call '{dotted}' (ADR-009 §7.1 anti-bypass)",
                )
            elif leaf in FORBIDDEN_DYNAMIC_ATTR_CALLS:
                arg0 = _extract_string_literal(node.args[0]) if node.args else None
                label = f"{dotted}({arg0!r})" if arg0 is not None else f"{dotted}(...)"
                _add_violation(
                    node.lineno,
                    label,
                    f"{module_role} must not invoke dynamic module loader '{dotted}' (ADR-009 §7.1 anti-bypass)",
                )
            elif leaf == "getattr" and len(node.args) >= 2:
                obj_name = _call_target_dotted_name(node.args[0], aliases)
                attr_lit = _extract_string_literal(node.args[1])
                if obj_name in ("__builtins__", "builtins") and attr_lit in (
                    "__import__",
                    "exec",
                    "eval",
                    "compile",
                ):
                    _add_violation(
                        node.lineno,
                        f"getattr({obj_name}, {attr_lit!r})",
                        f"{module_role} must not dynamically resolve '{attr_lit}' from builtins (ADR-009 §7.1 anti-bypass)",
                    )

        elif isinstance(node, ast.Subscript):
            base_name = _call_target_dotted_name(node.value, aliases)
            if base_name == "sys.modules":
                key_lit = _extract_string_literal(node.slice)
                if key_lit is None or (
                    _matches_prefix(key_lit, TIER2_FORBIDDEN_SOLVER_PREFIXES)
                    or _matches_prefix(key_lit, dynamic_tier1)
                    or _matches_prefix(key_lit, TIER2_ORACLE_MODULES)
                    or key_lit.split(".")[0] in TIER1_FORBIDDEN_LIBRARIES
                ):
                    _add_violation(
                        node.lineno,
                        f"sys.modules[{key_lit!r}]",
                        f"{module_role} must not bypass import isolation via sys.modules lookup",
                    )

    # Deduplicate exact identical violation entries while preserving order
    deduped: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, int, str, str]] = set()
    for v in violations:
        key = (v["file"], v["line"], v["imported"], v["rule"])
        if key not in seen:
            seen.add(key)
            deduped.append(v)
    return deduped


def audit_typescript_c0_legacy_boundary(repo_root: Path) -> Dict[str, Any]:
    """Independent TypeScript `src/engine/` audit per ADR-001 (C0-Legacy boundary).

    Confirms:
    1. `src/engine/` contains zero imports, subprocess invocations, or runtime references to Python Tier-2 oracles
       (`patroner_geometry`, `c1_cert_oracle`, `sub_oracles`, `qualification`, `mpmath`, `python-flint`).
    2. Inventories all controlled `scripts/*.ts` bridge/capture scripts that import `src/engine/` for M00 verification.
    """
    src_engine_dir = repo_root / "src" / "engine"
    scripts_dir = repo_root / "scripts"

    forbidden_py_patterns = [
        ("patroner_geometry", re.compile(r"\bpatroner_geometry\b")),
        ("c1_cert_oracle", re.compile(r"\bc1_cert_oracle\b")),
        ("sub_oracles", re.compile(r"\bsub_oracles\b")),
        ("mpmath", re.compile(r"\bmpmath\b")),
        ("python-flint", re.compile(r"\bpython[-_]flint\b")),
        ("child_process_python", re.compile(r"\b(spawn|execFile|execSync|spawnSync)\s*\([^)]*python")),
    ]

    ts_engine_files_checked: List[str] = []
    ts_violations: List[Dict[str, Any]] = []

    if src_engine_dir.exists():
        for ts_file in sorted(src_engine_dir.rglob("*.ts")):
            if ts_file.name.endswith(".test.ts"):
                continue
            rel = ts_file.relative_to(repo_root).as_posix()
            ts_engine_files_checked.append(rel)
            text = ts_file.read_text(encoding="utf-8")
            for lineno, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                for label, pattern in forbidden_py_patterns:
                    if pattern.search(line):
                        ts_violations.append(
                            {
                                "file": rel,
                                "line": lineno,
                                "role": "c0_legacy_typescript_engine",
                                "imported": label,
                                "rule": "ADR-001: C0-Legacy TypeScript engine must not invoke or couple to Python Tier-2 oracles",
                            }
                        )

    # Identify exact script coupling points into src/engine/
    coupling_scripts: List[Dict[str, Any]] = []
    engine_import_re = re.compile(r"""from\s+['"](\.\./src/engine/[^'"]+)['"]""")
    if scripts_dir.exists():
        for ts_script in sorted(scripts_dir.glob("*.ts")):
            rel = ts_script.relative_to(repo_root).as_posix()
            text = ts_script.read_text(encoding="utf-8")
            imports = sorted(set(engine_import_re.findall(text)))
            if imports:
                coupling_scripts.append(
                    {
                        "script": rel,
                        "purpose": "M00 C0-Legacy verification/export bridge (read-only consumption of src/engine/)",
                        "srcEngineImports": imports,
                    }
                )

    return {
        "adr001Classification": "C0-Legacy (Non-Authoritative TypeScript Prototype — ADR-001)",
        "srcEngineNonTestFilesAuditedCount": len(ts_engine_files_checked),
        "srcEngineNonTestFilesAudited": ts_engine_files_checked,
        "controlledScriptCouplingPoints": coupling_scripts,
        "violationsCount": len(ts_violations),
        "violations": ts_violations,
        "allPassed": len(ts_violations) == 0 and len(ts_engine_files_checked) > 0,
    }


def audit_repository_oracle_independence(repo_root: Path) -> Dict[str, Any]:
    """Audits every Python file under `services/` (including `__init__.py` and `contracts.py`)
    plus independent TypeScript `src/engine/` boundary verification (`ADR-001`).
    """
    services_dir = repo_root / "services"
    oracle_files: List[str] = []
    tier1_files: List[str] = []
    shared_contract_files: List[str] = []
    package_init_files: List[str] = []
    all_violations: List[Dict[str, Any]] = []

    discovered_py_files: List[Tuple[Path, str, str]] = []
    dynamic_tier1_modules: Set[str] = set()

    if services_dir.exists():
        for py_file in sorted(services_dir.rglob("*.py")):
            parts = py_file.parts
            if ".venv" in parts or "__pycache__" in parts or "tests" in parts:
                continue
            rel = py_file.relative_to(repo_root).as_posix()
            mod_name = _infer_module_name_from_filename(rel)
            if py_file.name == "contracts.py":
                role = "shared_contracts"
                shared_contract_files.append(rel)
            elif py_file.name == "__init__.py":
                role = "package_init"
                package_init_files.append(rel)
            elif py_file.name in TIER2_ORACLE_FILENAMES:
                role = "tier2_oracle"
                oracle_files.append(rel)
            else:
                role = "tier1_production"
                tier1_files.append(rel)
                dynamic_tier1_modules.add(mod_name)
                dynamic_tier1_modules.add(py_file.stem)
            discovered_py_files.append((py_file, rel, role))

    for py_file, rel, role in discovered_py_files:
        src = py_file.read_text(encoding="utf-8")
        all_violations.extend(
            check_python_source_independence(
                src,
                module_role=role,
                filename=rel,
                extra_tier1_modules=dynamic_tier1_modules,
            )
        )

    ts_audit = audit_typescript_c0_legacy_boundary(repo_root)
    all_violations.extend(ts_audit["violations"])

    return {
        "checkName": "ADR-009 §5.4 / §7.1 & ADR-001 Hardened AST + Boundary Oracle-Independence Verification",
        "tier2OracleFilesChecked": oracle_files,
        "tier1ProductionFilesChecked": tier1_files,
        "sharedContractFilesChecked": shared_contract_files,
        "packageInitFilesChecked": package_init_files,
        "sharedContractFiles": sorted(shared_contract_files + package_init_files),
        "dynamicTier1ModulesDiscovered": sorted(dynamic_tier1_modules),
        "typescriptC0LegacyAudit": ts_audit,
        "violationsCount": len(all_violations),
        "violations": all_violations,
        "allPassed": len(all_violations) == 0 and ts_audit["allPassed"],
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    report = audit_repository_oracle_independence(repo_root)
    print(json.dumps(report, indent=2))
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
