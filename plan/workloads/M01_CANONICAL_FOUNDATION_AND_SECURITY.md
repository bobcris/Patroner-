# WORKLOAD M01 — CANONICAL FOUNDATION, CONTRACTS, SECURITY & PROVENANCE (`R2.1`)

## 1. Workload ID & Title
- **Workload ID:** `M01`
- **Title:** Canonical Fashion World Model, Typed System Contracts, Dossier 02 Orchestration, Multi-Tenant IAM, RBAC+ABAC Security & Append-Only Revision Graph
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase A & Phase D (Foundation, Contracts, Orchestration & Security Architecture)`

## 2. Purpose & Architectural Role
`M01` constructs the authoritative backbone of Patroner in `services/fashion-engine` (Python/FastAPI/PostgreSQL) and connects `apps/web` (Next.js) exclusively via versioned contracts. It implements the **Fashion World Model** (`Dossier 01`), **API Workflows & `EnginePlan` Job Orchestration** (`Dossier 02 v5.0`, preserving all 7 normative requirements `DOS-02-R1` through `DOS-02-R7` per `Correction 07`), and **Enterprise Multi-Tenant Security, RBAC+ABAC, Append-Only Revision Provenance, Signed Media Governance, and Level A Operational Recovery** (`Dossier 16` & `v5.16 Ch. 11, 16`).

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 09`, `Ch. 10`, `Ch. 11`, `Ch. 16`, `Ch. 15 (Phase A/D)`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf`
- `Dossier 01 v4.9` (Domain System of Record), `Dossier 02 v5.0` (API Workflows & Orchestration — reconciled in `01_SOURCE_REGISTER_AND_REQUIREMENTS.md` §3.1), `Dossier 16 v5.14` (Platform Security, Multi-Tenancy, RBAC/ABAC & Provenance)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-ARCH-01`**, **`REQ-ARCH-02`** (Python/Next.js System-of-Systems & Versioned Contracts)
- **`REQ-WM-01`**, **`REQ-WM-02`** (Canonical Fashion World Model Entities, Append-Only Revision DAG & Selective Dependency Invalidation)
- **`REQ-ORCH-01`** (Dossier 02 `DOS-02-R1`–`R7`: Intake validation, snapshot gates, `EnginePlan`, job state machine, idempotency, retries & 3-point worker re-authorization)
- **`REQ-SEC-01`**, **`REQ-SEC-02`** (Multi-Tenant Isolation, RBAC+ABAC Policy Engine, RFC 8032 Ed25519/OIDC JWK, & Secure Media Pipeline)

## 5. Current Repository Baseline & Classification
- **Identity / Tenant / RBAC / ABAC**: `I1 + X` for in-memory Ed25519/JWK verifier primitives (`garment-specification.ts`); `M` (Missing) for persistent `Person`/`Organization`/`Tenant`/`Membership` IAM and server middleware (`DEF-M00-04`).
- **Persistence & Revision Graph**: `I1 + X` for in-memory dependency invalidation (`dependency-invalidation.ts`); `M` (Missing) for PostgreSQL persistence.
- **Async Job Orchestration (`Dossier 02`)**: `M` (Missing).
- **Secure Media / Signed Export Links**: `M` (Missing).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Closes **`DEF-M00-04`** structurally by making `tenant_id` a non-nullable, server-injected security context verified by PostgreSQL Row-Level Security (RLS) and ABAC policy checks on every read, write, builder invocation, and background worker task.
- Closes **`CNF-001`** and **`CNF-002`** by implementing `DOS-02-R1` through `DOS-02-R7` in Python FastAPI + PostgreSQL.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M00.10`** (`packages/contracts` pipeline, `services/fashion-engine` & `apps/web` workspace layout, and RFC 8785 canonical JSON SHA-256 utility).

## 8. Target Architecture & Module Ownership
- **`services/fashion-engine/app/iam/`**: `Person`, `Organization`, `Tenant`, `MembershipRoleBinding`, OIDC/JWT session verification, RBAC + ABAC policy evaluator (`8` action verbs: `view`, `edit`, `approve`, `release`, `export`, `share`, `administer`, `impersonate`).
- **`services/fashion-engine/app/world_model/`**: PostgreSQL SQLAlchemy 2.0 models & repositories for `FashionProject`, `BrandProject`, `GarmentRevisionNode`, `RevisionEdge`, `ArtifactRecord`, 13-stage dependency invalidation DAG, and `AuditLogEntry`.
- **`services/fashion-engine/app/orchestration/` (`Dossier 02`):** Intake validator (`DOS-02-R1`), snapshot gate (`DOS-02-R2`), `EnginePlan` runner (`DOS-02-R3`), durable job state machine (`queued` → `running` → `succeeded` / `failed` / `canceled` / `superseded`, `DOS-02-R4`), idempotency & retry manager (`DOS-02-R5`), 3-point worker re-authorization middleware (`DOS-02-R6`), and `ExecutionManifest` publisher (`DOS-02-R7`).
- **`services/fashion-engine/app/media/`**: Malware/MIME/magic-byte validator, sandboxed parser, EXIF scrubber, content-addressed object storage client, time-limited signed URL issuer.
- **`apps/web/src/`**: Next.js 15 App Router workspace shell, typed API client, project/revision tree navigator, job status drawer.

## 9. Domain Entities, State Machines & Data Contracts
1. **Identity & Multi-Tenant Hierarchy (`Dossier 16`):**
   - `Person` (`person_id`, `email`, `mfa_enabled`, `status`)
   - `Organization` (`org_id`, `legal_name`, `org_type: "BRAND" | "CREATOR_STUDIO" | "WORKSHOP_MAKER" | "PATRONER_INTERNAL" | "PATRONER_OWN_LABEL"`)
   - `Tenant` (`tenant_id`, `owner_org_id`, `isolation_tier`, `kms_key_arn`)
   - `MembershipRoleBinding` (`binding_id`, `person_id`, `tenant_id`, `role`, `allowed_actions: ActionVerb[]`, `abac_scopes`)
2. **Append-Only Revision Graph (`Dossier 01`):**
   - `FashionProject` (`project_id`, `tenant_id`, `title`, `garment_family`, `head_revision_id`, `created_by`, `created_at`)
   - `GarmentRevisionNode` (`revision_id`, `project_id`, `tenant_id`, `parent_revision_ids: UUID[]`, `lifecycle_state` [8 canonical states from `plan/10`], bound artifact IDs, `staleness_status: "FRESH" | "STALE"`, `is_production_ready: bool`, `execution_manifest_id`, `canonical_sha256`, `created_by`, `created_at`) — **UPDATE/DELETE prohibited by DB trigger**.

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Merkle Revision Digest & Execution Manifest (`DOS-01`, `DOS-02-R7`):**
   $$\text{digest}(R_k) = \text{SHA256}\Big(\text{JCS}\big(\{\texttt{tenant\_id}, \texttt{project\_id}, \texttt{parent\_digests}, \texttt{lifecycle\_state}, \texttt{artifact\_digests}, \texttt{engine\_version}, \texttt{random\_seed}\}\big)\Big)$$
2. **ABAC Policy & Workshop Scoped Grant Evaluation (`DOS-16`):**
   $$\text{Authorize}(s, a, r, e) = \text{RBAC}(s.\text{roles}, a) \land (s.\text{tenant\_id} = r.\text{tenant\_id} \lor \text{ActiveWorkshopGrant}(s, r, a, e.\text{now})) \land \neg \text{Revoked}(s, e.\text{now})$$
   where a `WORKSHOP_MAKER` grant is strictly time-bounded, order-scoped, and exposes only technical manufacturing packages (`M05`/`M07`), never customer PII or unrelated tenant projects.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/projects` / `GET /api/v1/projects/{project_id}`
- `POST /api/v1/projects/{project_id}/revisions` (Creates immutable child revision node and propagates `STALE` status to superseded downstream branches)
- `GET /api/v1/projects/{project_id}/revisions/{revision_id}/provenance`
- `POST /api/v1/jobs` (`Idempotency-Key` required) / `GET /api/v1/jobs/{job_id}` / `POST /api/v1/jobs/{job_id}/cancel`
- `POST /api/v1/media/upload-url` / `POST /api/v1/media/{media_id}/finalize` / `GET /api/v1/artifacts/{artifact_id}/signed-download`

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- **PostgreSQL Row-Level Security (RLS):** Every domain table enforces `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`.
- **Three-Point Async Job Re-Authorization (`DOS-02-R6`, `REQ-ORCH-01`):** Verified at (1) HTTP enqueue, (2) worker execution start, and (3) database commit transaction before publishing artifacts.
- **Level A Operational Backup & GDPR Erase Procedure (`Correction 03`, `Gate F.10 Level A`):** Configures automated daily single-region PostgreSQL PITR + object-store backups with a verified pre-pilot restoration drill (`RPO <= 1 hr`, `RTO <= 2 hr`) and a documented, auditable GDPR subject erasure procedure for the `M09` pilot (while multi-region active/standby DR and automated crypto-shredding at scale are scoped to `M10` `Level C`).

## 13. User Experience & Workspace Surfaces (`apps/web`)
- Next.js 15 Fashion Project Workspace shell featuring Tenant/Project switcher, interactive Append-Only Revision Graph & Staleness DAG viewer, Async Job Progress Drawer, and role-aware action controls.

## 14. Detailed Work Packages & Implementation Sequence
1. **`M01.1` — PostgreSQL Schema, RLS & Append-Only Triggers:** Implement `iam`, `world_model`, `jobs`, `jti_replay_store`, and `audit_log` tables.
2. **`M01.2` — RBAC + ABAC Policy Engine & Cryptographic Verifiers:** Port verified Ed25519 / OIDC JWK / strict ISO-8601 timestamp primitives into Python and enforce 8-verb ABAC policies.
3. **`M01.3` — Fashion World Model, 13-Stage Dependency Invalidation DAG & Merkle Provenance Service.**
4. **`M01.4` — Dossier 02 Durable Job Orchestrator:** Implement `DOS-02-R1`–`R7` (`EnginePlan`, job state machine, idempotency, retries, 3-point re-auth, `ExecutionManifest`).
5. **`M01.5` — Secure Media Upload Sandboxing & Signed Artifact Storage Service.**
6. **`M01.6` — Next.js Workspace Shell (`apps/web`) & Level A Backup Drill Verification.**

## 15. Migration & Parity Strategy (Class A vs. Class B Fixtures)
- Ports verified cryptographic, revision-snapshot, and 13-stage dependency-invalidation invariants (`src/engine/production/*`) into persistent Python/PostgreSQL services (`Class B`).

## 16. Unit, Property & Adversarial Test Plan
- **Cross-Tenant Penetration Suite:** Tenant A attempts to read, branch, download artifacts, or subscribe to job events belonging to Tenant B (or Patroner Own-Label vs. External Brand) → 100% HTTP `403`/`404` rejection.
- **Mid-Job Permission Revocation Test (`DOS-02-R6`):** Revoke user role while job is `running`; verify worker aborts commit at Step 3 re-authorization.
- **Immutability & JTI Replay Tamper Tests:** Attempt SQL `UPDATE`/`DELETE` on `garment_revision_nodes` or replay a consumed Ed25519/JWK `jti` token → blocked.

## 17. Independent Verification Oracles
- Independent SQL RLS policy verifier + standalone Merkle DAG lineage auditor script verifying every revision digest and dependency invalidation edge.

## 18. Physical, Manufacturing or Financial Validation Protocol
- Validates institutional audit-log completeness, cryptographic non-repudiation, and `Level A` backup restoration required before `M05`, `M07`, `M08`, and `M09`.

## 19. Acceptance Criteria (`AC-01`–`AC-12` & Release Level Mapping)
- **`AC-01`**, **`AC-02`**, **`AC-04`** (zero domain computation in `apps/web`), **`AC-11`** (RBAC+ABAC, 3-point job re-auth, RLS, and `Level A` backup restore drill). Required for **Release Level A**.

## 20. Failure Modes, Rollback & Recovery Procedures
- **Worker Crash Mid-Job:** Durable job heartbeat timeout marks job retryable up to $N_{\max}=3$ with fresh ABAC check, or transitions to `failed` without corrupting parent revision heads.

## 21. Observability, Audit Logging & Telemetry
- Every authorization decision, revision creation, dependency invalidation, job transition, and signed-URL issuance writes an immutable `AuditLogEntry`.

## 22. Explicit Non-Goals & Scope Guardrails
- `M01` does not implement pattern drafting (`M02`), multimodal vision extraction (`M04a`), cloth simulation (`M06`), or multi-currency accounting (`M08`); it provides the canonical entity graph, job orchestrator, and security boundary they execute within.

## 23. Downstream Unlocks
- Unlocks **`M02b`–`M02h`**, **`M03`**, **`M04a`**, **`M05`**, and **`M08`**.

## 24. Definition of Done Checklist
- [ ] PostgreSQL schema with RLS and append-only triggers deployed and tested.
- [ ] All 7 Dossier 02 requirements (`DOS-02-R1`–`R7`) implemented and verified.
- [ ] `Person` / `Organization` / `Tenant` / `Role` RBAC+ABAC policy engine active on 100% of endpoints.
- [ ] Secure media upload sandboxing & signed artifact download pipeline verified.
- [ ] Level A single-region backup restoration drill completed (`Gate F.10 Level A`).
