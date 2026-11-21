#!/usr/bin/env python3
"""True Two-Subprocess Isolated Reproducibility Verifier for Patroner M00 (PKG-M00-04 I-01).

Spawns TWO fresh, completely separate OS subprocesses (`PYTHONHASHSEED=0`), each running:
    python scripts/m00_execute_all.py --single-run --output-dir <isolated_dir>
and compares the exact SHA-256 digest and byte size of every generated deterministic JSON artifact
across Run 1 and Run 2. Fails closed (non-zero exit) on any mismatch, missing artifact, or extra artifact.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]


def compare_run_directories(run1_dir: Path, run2_dir: Path) -> Dict[str, Any]:
    """Compares every file produced in `run1_dir` vs `run2_dir` by exact relative path, byte size, and SHA-256."""
    files1 = {p.relative_to(run1_dir).as_posix(): p for p in sorted(run1_dir.rglob("*")) if p.is_file()}
    files2 = {p.relative_to(run2_dir).as_posix(): p for p in sorted(run2_dir.rglob("*")) if p.is_file()}

    all_rel_paths = sorted(set(files1.keys()) | set(files2.keys()))
    comparisons: List[Dict[str, Any]] = []
    missing_in_run1: List[str] = []
    missing_in_run2: List[str] = []
    mismatches: List[str] = []

    for rel in all_rel_paths:
        p1 = files1.get(rel)
        p2 = files2.get(rel)
        if p1 is None:
            missing_in_run1.append(rel)
            comparisons.append(
                {
                    "artifact": rel,
                    "run1Sha256": None,
                    "run2Sha256": hashlib.sha256(p2.read_bytes()).hexdigest() if p2 else None,
                    "identicalAcrossRuns": False,
                }
            )
            continue
        if p2 is None:
            missing_in_run2.append(rel)
            comparisons.append(
                {
                    "artifact": rel,
                    "run1Sha256": hashlib.sha256(p1.read_bytes()).hexdigest(),
                    "run2Sha256": None,
                    "identicalAcrossRuns": False,
                }
            )
            continue

        b1 = p1.read_bytes()
        b2 = p2.read_bytes()
        h1 = hashlib.sha256(b1).hexdigest()
        h2 = hashlib.sha256(b2).hexdigest()
        same = (h1 == h2) and (len(b1) == len(b2))
        if not same:
            mismatches.append(rel)
        comparisons.append(
            {
                "artifact": rel,
                "run1Sha256": h1,
                "run2Sha256": h2,
                "bytes": len(b1) if same else None,
                "identicalAcrossRuns": same,
            }
        )

    all_identical = (
        len(all_rel_paths) > 0
        and len(missing_in_run1) == 0
        and len(missing_in_run2) == 0
        and len(mismatches) == 0
        and all(c["identicalAcrossRuns"] for c in comparisons)
    )
    return {
        "artifactsComparedCount": len(all_rel_paths),
        "missingInRun1": missing_in_run1,
        "missingInRun2": missing_in_run2,
        "mismatchedArtifacts": mismatches,
        "artifactRunComparisons": comparisons,
        "allBitExact": all_identical,
    }


def _spawn_single_run(repo_root: Path, python_executable: str, out_dir: Path) -> Dict[str, Any]:
    env = dict(os.environ)
    env["PYTHONHASHSEED"] = "0"
    cmd = [
        python_executable,
        str(repo_root / "scripts" / "m00_execute_all.py"),
        "--single-run",
        "--output-dir",
        str(out_dir),
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(repo_root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout, stderr = proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"Single-run subprocess (pid={proc.pid}) failed with exit code {proc.returncode}.\n"
            f"STDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        )
    return {
        "pid": proc.pid,
        "returncode": proc.returncode,
        "stdoutTail": stdout.strip().splitlines()[-5:] if stdout.strip() else [],
    }


def run_two_subprocess_reproducibility_check(
    repo_root: Path = REPO_ROOT,
    python_executable: str | None = None,
) -> Dict[str, Any]:
    """Runs two completely independent OS subprocesses and compares all generated deterministic JSON artifacts."""
    py_exe = python_executable or sys.executable
    with tempfile.TemporaryDirectory(prefix="patroner_m00_replay_") as tmp_str:
        tmp = Path(tmp_str)
        run1_dir = tmp / "run1"
        run2_dir = tmp / "run2"
        run1_dir.mkdir(parents=True, exist_ok=True)
        run2_dir.mkdir(parents=True, exist_ok=True)

        r1_meta = _spawn_single_run(repo_root, py_exe, run1_dir)
        r2_meta = _spawn_single_run(repo_root, py_exe, run2_dir)
        cmp_res = compare_run_directories(run1_dir, run2_dir)

        distinct_pids = r1_meta["pid"] != r2_meta["pid"]
        passed = bool(distinct_pids and cmp_res["allBitExact"])

        return {
            "replayMethod": "TWO_ISOLATED_OS_SUBPROCESSES",
            "pythonExecutable": py_exe,
            "pythonHashSeed": "0",
            "distinctSubprocessesExecuted": distinct_pids,
            "run1Pid": r1_meta["pid"],
            "run2Pid": r2_meta["pid"],
            "artifactsComparedCount": cmp_res["artifactsComparedCount"],
            "missingInRun1": cmp_res["missingInRun1"],
            "missingInRun2": cmp_res["missingInRun2"],
            "mismatchedArtifacts": cmp_res["mismatchedArtifacts"],
            "artifactRunComparisons": cmp_res["artifactRunComparisons"],
            "allBitExact": passed,
        }


def main() -> int:
    result = run_two_subprocess_reproducibility_check(REPO_ROOT, sys.executable)
    print(json.dumps(result, indent=2))
    if not result["allBitExact"]:
        print("FAIL: Two-subprocess reproducibility verification detected drift or missing artifacts.", file=sys.stderr)
        return 1
    print(
        f"PASS: Two isolated OS subprocesses (PIDs {result['run1Pid']} vs {result['run2Pid']}) produced "
        f"100% bit-exact SHA-256 digests across all {result['artifactsComparedCount']} deterministic artifacts."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
