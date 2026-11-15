# ADR-002 — CANONICAL FASHION WORLD MODEL & APPEND-ONLY REVISION GRAPH

- **ADR ID:** `ADR-002`
- **Revision:** `2.1` (Controlled Architecture, Dependency, Numerical Assurance & Release-Governance Correction)
- **Status:** Accepted & Mandatory
- **Date:** 15 November 2026
- **Governing Sources:** `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf` (`Ch. 04`, `Ch. 09`, `Ch. 11`), `Dossier 01 v4.9` (Domain System of Record), `Dossier 02 v5.0` (`DOS-02-R1`–`R7`), `Dossier 16 v5.14`, `REQ-WM-01`, `REQ-WM-02`

---

## 1. Context & Problem Statement
In fashion engineering and physical manufacturing, mutating a pattern or material specification in place destroys auditability: if a workshop cuts 25 garments from a pattern revision that is later overwritten in the database, it becomes impossible to reconcile physical POM defects (`M07`) or customer fit returns (`M09`) against the exact geometry that was cut. In the current repository prototype (`src/App.tsx`), garment specifications are held as mutable in-memory React state with no persistence or revision lineage.

---

## 2. Decision
1. **Immutable Append-Only Revision Directed Acyclic Graph (`RevisionDAG`) & Canonical `v5.16 Ch. 09` Lifecycle States:**
   - Every state change in a `FashionProject` across the 9 canonical `v5.16 Ch. 09` states (`Concept` → `Specified` → `Drafted` → `Validated` → `Fit_Approved` → `Sample_Approved` → `Production_Ready` → `In_Production_Completed`, plus terminal branch state `Superseded_Archived`) creates a new, immutable `GarmentRevisionNode` referencing one or more `parent_revision_ids`.
   - PostgreSQL database triggers strictly prohibit `UPDATE` or `DELETE` on `garment_revision_nodes` and `artifact_records`.
2. **RFC 8785 (JCS) Canonical JSON SHA-256 Merkle Provenance:**
   - Every domain artifact (`DesignObservationBundle`, `GarmentIntentSpecification`, `ValidatedBodyProfile`, `CalibratedMaterialSpec`, `DraftedPatternRevision`, `GradedPatternFamily`, `MarkerNestingResult`, `SimulationCaseResult`, `FitEvaluationReport`, `PieceProductionSheet`, `ManufacturingTechPack`, `PhysicalSampleApprovalRecord`, `SignedManufacturingReleasePackage`) is serialized via RFC 8785 Canonical JSON and hashed with SHA-256.
   - The `GarmentRevisionNode.canonical_sha256` is the Merkle root over its parent revision digests, all bound artifact digests, the deterministic random seed, and the `services/fashion-engine` semantic version.
3. **Optimistic Concurrency & Automatic Staleness Propagation (`DOS-02-R3`, `DOS-02-R4`, `DOS-02-R5`):**
   - Every state-mutating request requires `expected_head_revision_id` and `Idempotency-Key`.
   - Branching a new revision node automatically marks any in-flight asynchronous jobs (`M01.4`) or unapproved downstream previews on superseded sibling nodes as `Superseded_Archived`.

---

## 3. Consequences & Enforcement
- **Positive:** Guarantees 100% deterministic reproducibility from intent to shop floor, prevents stale-pipeline cut errors, and satisfies institutional audit requirements (`AC-02`, `AC-11`, `Gate F.8`).
- **Enforcement:** Verified by automated SQL immutability tests, `DOS-02-R1`–`R7` orchestration tests, and end-to-end Merkle lineage replay in `M01`, `M05`, and `M07`.
