#!/usr/bin/env python3
"""Independent M00 Manifest Integrity Verifier (PKG-M00-04 I-07).

Verifies `M00_ARTIFACT_HASH_VERIFICATION.json` independently against disk:
- Rejects self-hashing (manifest path appearing inside `allAuditedFiles`)
- Rejects duplicate paths in `allAuditedFiles`
- Rejects any non-deterministic runtime observation artifacts leaking into `allAuditedFiles`
- Verifies every referenced file exists, matches its declared `sha256`, and matches its declared `bytes` size
- Verifies declared `compatibilityMirrorFiles` match their primary artifact SHA-256
- Exits non-zero on any tamper, omission, duplicate, or hash mismatch.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
NON_DETERMINISTIC_EXCLUDED_PATHS = {
    "artifacts/m00/IntervalCandidateBenchmarks.json",
    "artifacts/m00/RuntimeBenchmarkObservation.json",
}


def verify_manifest_file(
    manifest_path: Path = REPO_ROOT / "M00_ARTIFACT_HASH_VERIFICATION.json",
    repo_root: Path = REPO_ROOT,
) -> Dict[str, Any]:
    """Independently audits `manifest_path` against files on disk under `repo_root`."""
    errors: List[str] = []
    mismatches: List[Dict[str, Any]] = []
    missing_files: List[str] = []
    duplicates: List[str] = []
    self_hash_detected = False
    volatile_leaked: List[str] = []

    if not manifest_path.is_file():
        return {
            "manifestPath": str(manifest_path),
            "passed": False,
            "totalAuditedEntries": 0,
            "uniquePathsCount": 0,
            "selfHashDetected": False,
            "duplicates": [],
            "missingFiles": [],
            "mismatches": [],
            "volatileArtifactsLeaked": [],
            "errors": [f"Manifest file does not exist: {manifest_path}"],
        }

    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    try:
        manifest_rel = manifest_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        manifest_rel = manifest_path.name

    entries = doc.get("allAuditedFiles")
    if not isinstance(entries, list) or len(entries) == 0:
        errors.append("allAuditedFiles must be a non-empty list")
        entries = []

    seen_paths: set[str] = set()
    sha_by_path: Dict[str, str] = {}

    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"Entry #{idx} is not an object")
            continue
        rel = entry.get("path")
        declared_sha = entry.get("sha256")
        declared_bytes = entry.get("bytes")
        if not isinstance(rel, str) or not rel:
            errors.append(f"Entry #{idx} missing valid path")
            continue
        norm_rel = Path(rel).as_posix()

        if norm_rel == manifest_rel:
            self_hash_detected = True
            errors.append(f"Self-hashing prohibited: manifest references itself ({norm_rel})")

        if norm_rel in NON_DETERMINISTIC_EXCLUDED_PATHS:
            volatile_leaked.append(norm_rel)
            errors.append(f"Volatile non-deterministic runtime artifact leaked into deterministic manifest: {norm_rel}")

        if norm_rel in seen_paths:
            duplicates.append(norm_rel)
            errors.append(f"Duplicate path in allAuditedFiles: {norm_rel}")
            continue
        seen_paths.add(norm_rel)

        if not isinstance(declared_sha, str) or not _HEX64_RE.match(declared_sha):
            errors.append(f"Invalid SHA-256 format for {norm_rel}: {declared_sha!r}")
            continue

        full = repo_root / norm_rel
        if not full.is_file():
            missing_files.append(norm_rel)
            errors.append(f"Missing file referenced by manifest: {norm_rel}")
            continue

        raw = full.read_bytes()
        actual_sha = hashlib.sha256(raw).hexdigest()
        actual_bytes = len(raw)
        sha_by_path[norm_rel] = actual_sha

        bytes_mismatch = False
        if declared_bytes is not None:
            try:
                if int(declared_bytes) != actual_bytes:
                    bytes_mismatch = True
            except (TypeError, ValueError):
                bytes_mismatch = True

        if actual_sha != declared_sha or bytes_mismatch:
            mismatches.append(
                {
                    "path": norm_rel,
                    "declaredSha256": declared_sha,
                    "actualSha256": actual_sha,
                    "declaredBytes": declared_bytes,
                    "actualBytes": actual_bytes,
                }
            )
            errors.append(
                f"Integrity mismatch for {norm_rel}: sha256={actual_sha} (expected {declared_sha}), "
                f"bytes={actual_bytes} (expected {declared_bytes})"
            )

    # Verify compatibility mirrors match their primary paths
    mirrors = doc.get("compatibilityMirrorFiles", [])
    if isinstance(mirrors, list):
        for m in mirrors:
            p_path = m.get("primaryPath")
            m_path = m.get("mirrorPath")
            if p_path in sha_by_path and m_path in sha_by_path:
                if sha_by_path[p_path] != sha_by_path[m_path]:
                    errors.append(f"Compatibility mirror {m_path} diverges from primary {p_path}")

    # Verify declared totalFilesAudited matches actual unique entry count
    declared_total = doc.get("summary", {}).get("totalFilesAudited")
    if declared_total is not None and declared_total != len(entries):
        errors.append(f"summary.totalFilesAudited ({declared_total}) != len(allAuditedFiles) ({len(entries)})")

    passed = (
        len(entries) > 0
        and len(errors) == 0
        and len(mismatches) == 0
        and len(missing_files) == 0
        and len(duplicates) == 0
        and not self_hash_detected
        and len(volatile_leaked) == 0
    )

    return {
        "manifestPath": manifest_rel,
        "passed": passed,
        "totalAuditedEntries": len(entries),
        "uniquePathsCount": len(seen_paths),
        "selfHashDetected": self_hash_detected,
        "duplicates": duplicates,
        "missingFiles": missing_files,
        "mismatches": mismatches,
        "volatileArtifactsLeaked": volatile_leaked,
        "errors": errors,
    }


def main() -> int:
    manifest_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else (REPO_ROOT / "M00_ARTIFACT_HASH_VERIFICATION.json")
    result = verify_manifest_file(manifest_arg, REPO_ROOT)
    print(json.dumps(result, indent=2))
    if not result["passed"]:
        print(f"FAIL: Manifest verification failed with {len(result['errors'])} error(s).", file=sys.stderr)
        return 1
    print(
        f"PASS: Verified {result['totalAuditedEntries']} unique audited entries in {result['manifestPath']} "
        "(0 duplicates, 0 self-hashes, 0 missing, 0 mismatches)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
