#!/usr/bin/env python3
"""ADR-009 §5.4 & §7.1 / ADR-001 Hardened Static AST & Boundary Oracle-Independence Auditor.

Closes Checkpoint I (`I-02`) and Checkpoint K (`K-04`) bypasses:
1. Strict exact-module internal allowlist (NO bare `"patroner_geometry"` prefix leak):
   - Every `import` and `from ... import ...` (including relative imports) is resolved to its exact
     module path and validated against `TIER2_ALLOWED_EXACT_MODULES` (exact equality, never broad prefix).
   - Unapproved internal modules such as `from .offset_kernel import fast_offset`,
     `from . import offset_kernel`, `import patroner_geometry.offset_kernel`, or bare
     `import patroner_geometry` are rejected fail-closed.
2. Hardened dynamic/obfuscated import & builtins-reflection detection:
   - Static string constant folding across string concatenation (`+`), f-strings, `"".join(...)`,
     and simple local string-variable aliases.
   - Blocks `importlib` (except explicit read-only `importlib.metadata`), `runpy`, `imp`, `builtins`,
     `pkgutil`, `zipimport`, `ctypes`, `marshal`, `pickle`, `code`, `subprocess`, `operator.attrgetter`/
     `operator.itemgetter` dynamic dispatch.
   - Blocks `__import__`, `exec`, `eval`, bare/builtin `compile` (preserving `re.compile`),
     `getattr` on `builtins`/`__builtins__`/`sys`/`importlib`/`vars(...)`/`globals()`/`locals()` or
     with non-literal / dangerous resolved attribute names, `vars(...)`/`dir(...)` on builtins/sys/importlib,
     `globals()`/`locals()`/`vars()` subscripting or `.get(...)`, `sys.modules[...]`/`sys.modules.get(...)`,
     and reflective attributes (`__builtins__`, `__globals__`, `__subclasses__`, `__loader__`, `__import__`).
3. Audits `__init__.py` and `contracts.py` explicitly (never skips them).
4. Independent TypeScript `src/engine/` (`C0-Legacy` per `ADR-001`) boundary audit.

Static Analysis Scope & Limitations:
- This auditor performs deterministic Python AST static analysis and TypeScript boundary scanning.
- Static AST analysis cannot prove runtime absence of arbitrary metaprogramming loaded from external
  C-extensions, monkey-patched third-party libraries, or `sys.meta_path` hooks installed outside
  `services/`; accordingly, this check enforces a conservative fail-closed ban on dynamic loader APIs
  and reflection primitives inside all audited engine modules and should be paired with dependency lock
  and code-review controls.
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

# Exact allowlist of internal patroner_geometry modules that Tier-2 oracles and __init__.py may import.
# CRITICAL (K-04): Bare `"patroner_geometry"` is intentionally EXCLUDED so prefix matching can NEVER
# permit unapproved sibling modules such as `patroner_geometry.offset_kernel`.
TIER2_ALLOWED_EXACT_MODULES: Set[str] = {
    "patroner_geometry.contracts",
    "patroner_geometry.c1_cert_oracle",
    "patroner_geometry.qualification",
    "patroner_geometry.sub_oracles",
    "patroner_geometry.provenance",
}

# Backwards-compatible alias referencing the exact allowlist (never includes bare "patroner_geometry")
TIER2_ALLOWED_INTERNAL_MODULES: Set[str] = set(TIER2_ALLOWED_EXACT_MODULES)

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

# Dynamic code/module loading and reflective-bypass modules forbidden across audited engine boundaries
FORBIDDEN_DYNAMIC_MODULES: Set[str] = {
    "importlib",
    "runpy",
    "imp",
    "builtins",
    "pkgutil",
    "zipimport",
    "ctypes",
    "marshal",
    "pickle",
    "code",
    "subprocess",
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
    "exec_module",
    "create_module",
    "__import__",
}

FORBIDDEN_REFLECTIVE_ATTRS: Set[str] = {
    "__builtins__",
    "__globals__",
    "__subclasses__",
    "__loader__",
    "__import__",
    "__code__",
    "__closure__",
}

DANGEROUS_ATTR_NAMES: Set[str] = {
    "__import__",
    "import_module",
    "exec",
    "eval",
    "compile",
    "__builtins__",
    "__globals__",
    "__subclasses__",
    "__loader__",
    "__spec__",
    "__dict__",
    "run_module",
    "run_path",
    "spec_from_file_location",
    "spec_from_loader",
    "module_from_spec",
    "find_spec",
    "load_module",
    "exec_module",
    "modules",
}

REFLECTIVE_NAMESPACE_ROOTS: Set[str] = {
    "builtins",
    "__builtins__",
    "importlib",
    "sys",
    "sys.modules",
    "runpy",
    "imp",
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


def _is_exact_allowed_internal_module(module_path: str) -> bool:
    """Returns True ONLY if `module_path` exactly matches an explicitly allowlisted internal module."""
    return module_path in TIER2_ALLOWED_EXACT_MODULES


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


def _extract_string_literal(node: ast.AST, string_env: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Statically folds string literals, concatenations, f-strings, simple joins, and string variable aliases."""
    env = string_env or {}
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in env:
        return env[node.id]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _extract_string_literal(node.left, env)
        right = _extract_string_literal(node.right, env)
        if left is not None and right is not None:
            return left + right
    if isinstance(node, ast.JoinedStr):
        parts: List[str] = []
        for val in node.values:
            if isinstance(val, ast.FormattedValue):
                s = _extract_string_literal(val.value, env)
            else:
                s = _extract_string_literal(val, env)
            if s is None:
                return None
            parts.append(s)
        return "".join(parts)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "join"
        and len(node.args) == 1
    ):
        sep = _extract_string_literal(node.func.value, env)
        arg = node.args[0]
        if sep is not None and isinstance(arg, (ast.List, ast.Tuple)):
            items: List[str] = []
            for elt in arg.elts:
                s = _extract_string_literal(elt, env)
                if s is None:
                    return None
                items.append(s)
            return sep.join(items)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "decode"
        and isinstance(node.func.value, ast.Constant)
        and isinstance(node.func.value.value, (bytes, bytearray))
    ):
        try:
            return bytes(node.func.value.value).decode("utf-8")
        except Exception:
            return None
    return None


def _is_reflective_namespace_expr(node: ast.AST, aliases: Dict[str, str]) -> Optional[str]:
    """Returns a descriptive label if `node` evaluates to a reflective namespace
    (`builtins`, `__builtins__`, `sys.modules`, `globals()`, `locals()`, `vars(...)`, `*.__dict__`, `*.__globals__`),
    else None.
    """
    dotted = _call_target_dotted_name(node, aliases)
    if dotted in REFLECTIVE_NAMESPACE_ROOTS or dotted.endswith(".__dict__") or dotted.endswith(".__globals__") or dotted.endswith(".__builtins__"):
        return dotted
    if isinstance(node, ast.Call):
        fn_dotted = _call_target_dotted_name(node.func, aliases)
        fn_leaf = fn_dotted.split(".")[-1] if fn_dotted else ""
        if fn_leaf in ("globals", "locals", "vars", "dir"):
            return f"{fn_dotted}(...)"
    if isinstance(node, ast.Subscript):
        inner = _is_reflective_namespace_expr(node.value, aliases)
        if inner is not None:
            return f"{inner}[...]"
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

    # Track aliases (import aliases + simple local assignments) and statically foldable local string constants.
    aliases: Dict[str, str] = {}
    string_env: Dict[str, str] = {}
    # Each entry: (lineno, resolved_module_path, full_target_path, import_kind)
    #   import_kind == "import": `import A.B` -> resolved_module_path = "A.B"
    #   import_kind == "from":   `from A import sym` -> resolved_module_path = A (or A.sym if A == "patroner_geometry")
    imported_entries: List[Tuple[int, str, str, str]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                asname = alias.asname or alias.name.split(".")[0]
                aliases[asname] = alias.name
                imported_entries.append((node.lineno, alias.name, alias.name, "import"))
        elif isinstance(node, ast.ImportFrom):
            resolved_base = _resolve_relative_module(current_module, node.level, node.module)
            if not node.names and resolved_base:
                imported_entries.append((node.lineno, resolved_base, resolved_base, "from"))
            for alias in node.names:
                if alias.name == "*":
                    if resolved_base:
                        imported_entries.append((node.lineno, resolved_base, f"{resolved_base}.*", "from"))
                    continue
                full_target = f"{resolved_base}.{alias.name}" if resolved_base else alias.name
                asname = alias.asname or alias.name
                aliases[asname] = full_target
                # If `from . import offset_kernel` (resolved_base == "patroner_geometry"), the imported module is full_target.
                # If `from .offset_kernel import fast_offset` (resolved_base == "patroner_geometry.offset_kernel"),
                # the imported module is resolved_base.
                if resolved_base in ("patroner_geometry", "fashion_engine", ""):
                    mod_path = full_target
                else:
                    mod_path = resolved_base
                imported_entries.append((node.lineno, mod_path, full_target, "from"))
        elif isinstance(node, ast.Assign):
            rhs_str = _extract_string_literal(node.value, string_env)
            if rhs_str is not None:
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        string_env[tgt.id] = rhs_str
            rhs_name = _call_target_dotted_name(node.value, aliases)
            if not rhs_name:
                refl_lbl = _is_reflective_namespace_expr(node.value, aliases)
                if refl_lbl is not None:
                    rhs_name = refl_lbl
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

    # 1. Check all static and relative imports with strict exact-module allowlisting
    for lineno, mod_path, full_target, import_kind in imported_entries:
        top = full_target.split(".")[0]

        # Dynamic loader / reflection modules are strictly forbidden across all audited roles.
        # Exception: `importlib.metadata` is read-only installed package metadata lookup, not dynamic code loading.
        if top in FORBIDDEN_DYNAMIC_MODULES and not (
            full_target == "importlib.metadata" or full_target.startswith("importlib.metadata.")
        ):
            _add_violation(
                lineno,
                full_target,
                f"{module_role} must not import dynamic loader/reflective module '{top}' (ADR-009 §7.1 anti-bypass)",
            )
            continue

        if module_role == "tier2_oracle":
            if _matches_prefix(full_target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(full_target, dynamic_tier1):
                _add_violation(
                    lineno,
                    full_target,
                    "Tier-2 verification oracle must not import Tier-1 production solver module",
                )
            elif (
                mod_path == "patroner_geometry"
                or mod_path.startswith("patroner_geometry.")
                or mod_path == "fashion_engine"
                or mod_path.startswith("fashion_engine.")
            ) and not _is_exact_allowed_internal_module(mod_path):
                # Strict exact-module allowlist (K-04): rejects bare `patroner_geometry` and any non-allowlisted
                # internal submodule such as `patroner_geometry.offset_kernel` (even via relative import).
                _add_violation(
                    lineno,
                    full_target,
                    f"Tier-2 verification oracle imported non-allowlisted internal module '{mod_path}' (K-04 exact allowlist)",
                )

        elif module_role == "tier1_production":
            if top in TIER1_FORBIDDEN_LIBRARIES or _matches_prefix(full_target, TIER1_FORBIDDEN_LIBRARIES):
                _add_violation(
                    lineno,
                    full_target,
                    "Tier-1 production module must not import interval oracle library (mpmath/python-flint)",
                )
            elif _matches_prefix(full_target, TIER2_ORACLE_MODULES):
                _add_violation(
                    lineno,
                    full_target,
                    "Tier-1 production module must not import Tier-2 verification oracle module",
                )

        elif module_role == "shared_contracts":
            if _matches_prefix(full_target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(full_target, dynamic_tier1):
                _add_violation(
                    lineno,
                    full_target,
                    "Shared contracts module must not import Tier-1 production solver module",
                )
            elif _matches_prefix(full_target, TIER2_ORACLE_MODULES):
                _add_violation(
                    lineno,
                    full_target,
                    "Shared contracts module must not import Tier-2 verification oracle module",
                )
            elif top in TIER1_FORBIDDEN_LIBRARIES:
                _add_violation(
                    lineno,
                    full_target,
                    "Shared contracts module must not import oracle interval library (mpmath/python-flint)",
                )
            elif (
                mod_path == "patroner_geometry"
                or (mod_path.startswith("patroner_geometry.") and mod_path != "patroner_geometry.contracts")
                or mod_path == "fashion_engine"
                or mod_path.startswith("fashion_engine.")
            ):
                _add_violation(
                    lineno,
                    full_target,
                    "Shared contracts module must remain self-contained without importing sibling engine modules",
                )

        elif module_role == "package_init":
            if _matches_prefix(full_target, TIER2_FORBIDDEN_SOLVER_PREFIXES) or _matches_prefix(full_target, dynamic_tier1):
                _add_violation(
                    lineno,
                    full_target,
                    "Package __init__.py must not import or re-export Tier-1 production solver module",
                )
            elif (
                mod_path == "patroner_geometry"
                or mod_path.startswith("patroner_geometry.")
                or mod_path == "fashion_engine"
                or mod_path.startswith("fashion_engine.")
            ) and not _is_exact_allowed_internal_module(mod_path):
                _add_violation(
                    lineno,
                    full_target,
                    f"Package __init__.py imported non-allowlisted internal module '{mod_path}' across Tier-1/Tier-2 boundary",
                )

    # 2. Check dynamic calls, obfuscated builtins reflection, and forbidden attribute/subscript accesses
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            if node.attr in FORBIDDEN_REFLECTIVE_ATTRS:
                dotted_attr = _call_target_dotted_name(node, aliases) or f"<expr>.{node.attr}"
                _add_violation(
                    node.lineno,
                    dotted_attr,
                    f"{module_role} must not access reflective attribute '{node.attr}' (K-04 anti-bypass)",
                )
            elif _call_target_dotted_name(node.value, aliases) == "importlib" and node.attr != "metadata":
                _add_violation(
                    node.lineno,
                    f"importlib.{node.attr}",
                    f"{module_role} may only access read-only importlib.metadata, not 'importlib.{node.attr}' (K-04 anti-bypass)",
                )

        elif isinstance(node, ast.Name):
            if node.id == "__builtins__":
                _add_violation(
                    node.lineno,
                    "__builtins__",
                    f"{module_role} must not reference '__builtins__' directly (K-04 anti-bypass)",
                )

        elif isinstance(node, ast.Call):
            dotted = _call_target_dotted_name(node.func, aliases)
            leaf = dotted.split(".")[-1] if dotted else ""

            if dotted in FORBIDDEN_DYNAMIC_CALL_NAMES or dotted in {
                f"{prefix}.{name}"
                for prefix in ("builtins", "__builtins__")
                for name in FORBIDDEN_DYNAMIC_CALL_NAMES
            }:
                arg0 = _extract_string_literal(node.args[0], string_env) if node.args else None
                label = f"{dotted}({arg0!r})" if arg0 is not None else f"{dotted}(...)"
                _add_violation(
                    node.lineno,
                    label,
                    f"{module_role} must not invoke dynamic loader/eval call '{dotted}' (ADR-009 §7.1 anti-bypass)",
                )
            elif leaf in FORBIDDEN_DYNAMIC_ATTR_CALLS:
                arg0 = _extract_string_literal(node.args[0], string_env) if node.args else None
                label = f"{dotted}({arg0!r})" if arg0 is not None else f"{dotted}(...)"
                _add_violation(
                    node.lineno,
                    label,
                    f"{module_role} must not invoke dynamic module loader '{dotted}' (ADR-009 §7.1 anti-bypass)",
                )
            elif leaf in ("globals", "locals"):
                _add_violation(
                    node.lineno,
                    f"{dotted}()",
                    f"{module_role} must not invoke '{leaf}()' namespace reflection (K-04 anti-bypass)",
                )
            elif leaf in ("vars", "dir"):
                if not node.args:
                    _add_violation(
                        node.lineno,
                        f"{dotted}()",
                        f"{module_role} must not invoke '{leaf}()' namespace reflection (K-04 anti-bypass)",
                    )
                else:
                    target_refl = _is_reflective_namespace_expr(node.args[0], aliases)
                    if target_refl is not None:
                        _add_violation(
                            node.lineno,
                            f"{dotted}({target_refl})",
                            f"{module_role} must not reflect namespace via '{leaf}({target_refl})' (K-04 anti-bypass)",
                        )
            elif leaf == "getattr" and len(node.args) >= 2:
                obj_refl = _is_reflective_namespace_expr(node.args[0], aliases)
                attr_val = _extract_string_literal(node.args[1], string_env)
                if obj_refl is not None:
                    _add_violation(
                        node.lineno,
                        f"getattr({obj_refl}, {attr_val!r})" if attr_val is not None else f"getattr({obj_refl}, <dynamic>)",
                        f"{module_role} must not dynamically resolve attributes from '{obj_refl}' via getattr (K-04 anti-bypass)",
                    )
                elif attr_val is None:
                    _add_violation(
                        node.lineno,
                        f"getattr({_call_target_dotted_name(node.args[0], aliases) or '<expr>'}, <dynamic>)",
                        f"{module_role} must not invoke getattr with non-statically-resolvable attribute name (K-04 fail-closed)",
                    )
                elif attr_val in DANGEROUS_ATTR_NAMES:
                    _add_violation(
                        node.lineno,
                        f"getattr(..., {attr_val!r})",
                        f"{module_role} must not dynamically resolve forbidden attribute '{attr_val}' via getattr (K-04 anti-bypass)",
                    )
            elif leaf in ("attrgetter", "itemgetter"):
                _add_violation(
                    node.lineno,
                    f"{dotted}(...)",
                    f"{module_role} must not use reflective operator '{leaf}' (K-04 anti-bypass)",
                )
            elif isinstance(node.func, ast.Attribute) and node.func.attr in ("get", "pop", "__getitem__", "setdefault"):
                recv_refl = _is_reflective_namespace_expr(node.func.value, aliases)
                if recv_refl is not None:
                    key_val = _extract_string_literal(node.args[0], string_env) if node.args else None
                    _add_violation(
                        node.lineno,
                        f"{recv_refl}.{node.func.attr}({key_val!r})" if key_val is not None else f"{recv_refl}.{node.func.attr}(...)",
                        f"{module_role} must not bypass import isolation via '{recv_refl}.{node.func.attr}' (K-04 anti-bypass)",
                    )

        elif isinstance(node, ast.Subscript):
            recv_refl = _is_reflective_namespace_expr(node.value, aliases)
            if recv_refl is not None:
                key_val = _extract_string_literal(node.slice, string_env)
                _add_violation(
                    node.lineno,
                    f"{recv_refl}[{key_val!r}]" if key_val is not None else f"{recv_refl}[<dynamic>]",
                    f"{module_role} must not bypass import isolation via reflective subscript '{recv_refl}[...]' (K-04 anti-bypass)",
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
        "exactInternalModuleAllowlist": sorted(TIER2_ALLOWED_EXACT_MODULES),
        "tier2OracleFilesChecked": oracle_files,
        "tier1ProductionFilesChecked": tier1_files,
        "sharedContractFilesChecked": shared_contract_files,
        "packageInitFilesChecked": package_init_files,
        "sharedContractFiles": sorted(shared_contract_files + package_init_files),
        "dynamicTier1ModulesDiscovered": sorted(dynamic_tier1_modules),
        "typescriptC0LegacyAudit": ts_audit,
        "staticAnalysisScopeAndLimitations": (
            "Static Python AST and TypeScript boundary verification with exact-module internal allowlisting "
            "(no bare 'patroner_geometry' prefix) and fail-closed rejection of dynamic loader/reflection APIs "
            "(importlib except read-only importlib.metadata, builtins, vars/globals/locals/getattr reflection, "
            "sys.modules, exec/eval/compile). Static AST cannot inspect arbitrary third-party C-extensions or "
            "external runtime sys.meta_path hooks; pair with locked dependency manifests and code review."
        ),
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
