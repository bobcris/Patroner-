# WORKLOAD M01 — CANONICAL FOUNDATION, CONTRACTS, SECURITY & PROVENANCE

## 1. Workload ID & Title
- **Workload ID:** `M01`
- **Title:** Canonical Fashion World Model, Typed System Contracts, Multi-Tenant IAM, RBAC+ABAC Security & Append-Only Revision Graph
- **Roadmap Phase Mapping:** `v5.16 Ch. 15 — Phase A (Foundation, Contracts & Security Architecture)`

## 2. Purpose & Architectural Role
`M01` constructs the authoritative backbone of Patroner in `services/fashion-engine` (Python/FastAPI/PostgreSQL) and connects `apps/web` (Next.js) exclusively via versioned contracts. It implements the **Fashion World Model** (`Dossier 01`), **API & Async Job Orchestration** (`Dossier 02`, corrected to Python), and **Enterprise Multi-Tenant Security, RBAC+ABAC, Append-Only Revision Provenance, and Signed Media Governance** (`Dossier 16` & `v5.16 Ch. 11`).

## 3. Governing Monograph Chapters, Addenda & Dossiers
- `Patroner_Living_Project_Monograph_v5.16_Consolidated_Master.pdf`: `Ch. 04`, `Ch. 09`, `Ch. 10`, `Ch. 11`, `Ch. 15 (Phase A)`
- `Patroner_Architecture_Correction_Addendum_v4.1.pdf`
- `Dossier 01 v4.9` (Domain System of Record), `Dossier 02 v5.0` (API Workflows & Orchestration), `Dossier 16 v5.14` (Platform Security, Multi-Tenancy, RBAC/ABAC & Provenance)

## 4. Canonical Requirements Implemented (`REQ-*`)
- **`REQ-ARCH-01`**, **`REQ-ARCH-02`** (Python/Next.js System-of-Systems & Versioned Contracts)
- **`REQ-WM-01`** (Canonical Fashion World Model Entities)
- **`REQ-WM-02`** (Append-Only Revision Graph & SHA-256 Provenance)
- **`REQ-ORCH-01`** (Synchronous vs. Asynchronous Job Contract & Worker Re-Authorization)
- **`REQ-SEC-01`** (Multi-Tenant Isolation & Identity Hierarchy)
- **`REQ-SEC-02`** (RBAC + ABAC Policy Engine & Secure Media Pipeline)

## 5. Current Repository Baseline & Classification
- **Identity / Tenant / RBAC / ABAC**: `M` (Missing) — Only a passive `tenantId?: string` string check exists in `piece-production-sheet.ts` (`DEF-M00-04`).
- **Persistence & Revision Graph**: `D` (Demo/Mock) — `src/App.tsx` holds a single hardcoded in-memory React state (`INITIAL_SKIRT_SPEC`).
- **Async Job Orchestration**: `M` (Missing).
- **Secure Media / Signed Export Links**: `M` (Missing).

## 6. Residual Defects & Technical Debt to Close (`DEF-*`)
- Closes **`DEF-M00-04`** structurally by making `tenant_id` a non-nullable, server-injected security context derived from authenticated session tokens and verified by row-level security (RLS) and ABAC policy checks on every read, write, builder invocation, and background worker task.
- Closes **`CNF-001`** and **`CNF-002`** by establishing Python FastAPI + PostgreSQL as the single authoritative System of Record.

## 7. Prerequisites & Upstream Dependencies
- Requires **`M00.10`** (`packages/contracts` pipeline, `services/fashion-engine` & `apps/web` workspace layout, and RFC 8785 canonical JSON SHA-256 utility).

## 8. Target Architecture & Module Ownership
- **`services/fashion-engine/app/iam/`**: `Person`, `Organization`, `Tenant`, `RoleBinding`, OIDC/JWT session verification, RBAC + ABAC policy evaluator.
- **`services/fashion-engine/app/world_model/`**: PostgreSQL SQLAlchemy 2.0 models & repositories for `FashionProject`, `GarmentRevisionNode`, `RevisionEdge`, `ArtifactRecord`, `AuditLogEntry`.
- **`services/fashion-engine/app/orchestration/`**: Durable job state machine (`Pending` → `Running` → `Succeeded` / `Failed` / `Cancelled` / `Superseded`), worker re-authorization middleware, SSE/WebSocket progress publisher.
- **`services/fashion-engine/app/media/`**: Malware/MIME/magic-byte validator, EXIF scrubber, content-addressed object storage client, time-limited HMAC/Ed25519 signed URL issuer.
- **`apps/web/src/`**: Next.js 15 App Router workspace shell, typed API client, project/revision tree navigator, job status drawer.

## 9. Domain Entities, State Machines & Data Contracts
1. **Identity & Multi-Tenant Hierarchy (`Dossier 16`):**
   - `Person` (`person_id`, `email`, `mfa_enabled`, `status`)
   - `Organization` (`org_id`, `legal_name`, `org_type: "BRAND" | "CREATOR_STUDIO" | "WORKSHOP_MAKER" | "PATRONER_INTERNAL"`)
   - `Tenant` (`tenant_id`, `owner_org_id`, `isolation_tier`, `kms_key_arn`)
   - `MembershipRoleBinding` (`binding_id`, `person_id`, `tenant_id`, `role: "TENANT_ADMIN" | "LEAD_PATTERNMAKER" | "DESIGNER" | "QA_APPROVER" | "MAKER_OPERATOR" | "FINANCE_CONTROLLER" | "READ_ONLY_AUDITOR"`, `abac_scopes`)
2. **Append-Only Revision Graph (`Dossier 01`):**
   - `FashionProject` (`project_id`, `tenant_id`, `title`, `garment_family`, `head_revision_id`, `created_by`, `created_at`)
   - `GarmentRevisionNode` (`revision_id`, `project_id`, `tenant_id`, `parent_revision_ids: UUID[]`, `lifecycle_state` [8 canonical states from `plan/10`], `intent_spec_id`, `body_profile_id`, `material_spec_id`, `pattern_revision_id`, `simulation_result_id`, `fit_report_id`, `tech_pack_id`, `release_package_id`, `is_production_ready: bool`, `canonical_sha256`, `created_by`, `created_at`) — **UPDATE/DELETE prohibited by DB trigger**.

## 10. Mathematical, Algorithmic & Domain Specifications
1. **Merkle Revision Digest Calculation:**
   $$\text{digest}(R_k) = \text{SHA256}\Big(\text{JCS}\big(\{\texttt{tenant\_id}, \texttt{project\_id}, \texttt{parent\_digests}, \texttt{lifecycle\_state}, \texttt{artifact\_digests}, \texttt{engine\_version}, \texttt{random\_seed}\}\big)\Big)$$
2. **ABAC Policy Evaluation Function:**
   $$\text{Authorize}(s, a, r, e) = \text{RBAC}(s.\text{roles}, a) \land (s.\text{tenant\_id} = r.\text{tenant\_id} \lor \text{ExplicitGrant}(s, r, a, e.\text{now})) \land \neg \text{Revoked}(s, e.\text{now})$$
   where Maker (`WORKSHOP_MAKER`) access to a revision $r$ is restricted strictly to resources bound via an active `WorkOrderGrant` and never exposes customer PII or unrelated projects.

## 11. API Endpoints, Async Jobs & Event Contracts
- `POST /api/v1/projects` / `GET /api/v1/projects/{project_id}`
- `POST /api/v1/projects/{project_id}/revisions` (Creates immutable child revision node)
- `GET /api/v1/projects/{project_id}/revisions/{revision_id}/provenance` (Returns full Merkle lineage)
- `POST /api/v1/jobs` / `GET /api/v1/jobs/{job_id}` / `POST /api/v1/jobs/{job_id}/cancel`
- `POST /api/v1/media/upload-url` / `POST /api/v1/media/{media_id}/finalize` / `GET /api/v1/artifacts/{artifact_id}/signed-download`

## 12. Security, Tenant Isolation, RBAC/ABAC & Provenance Controls
- **PostgreSQL Row-Level Security (RLS):** Every domain table enforces `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`.
- **Three-Point Async Job Authorization (`REQ-ORCH-01`):**
  1. Verified at HTTP job submission (`POST /api/v1/jobs`),
  2. Re-verified by the background worker immediately before task execution begins,
  3. Re-verified inside the database transaction immediately prior to committing output artifacts and revision nodes.
- **Upload & Export Hardening (`REQ-SEC-02`):** Strict MIME + magic-byte inspection (`image/png`, `image/jpeg`, `image/webp`, `model/obj`, `application/dxf`), maximum file size caps, image re-encoding/EXIF stripping, and short-lived (`TTL <= 300s`) tenant-scoped signed download URLs.

## 13. User Experience & Workspace Surfaces (`apps/web`)
- Next.js Fashion Project Workspace shell featuring:
  - Tenant & Project Switcher,
  - Interactive Append-Only Revision Graph timeline (showing parent/child lineage, lifecycle state badges, and SHA-256 verification status),
  - Real-time Async Job Progress Drawer with cancellation and supersession indicators,
  - Role-aware action gating (e.g., only `QA_APPROVER` / `LEAD_PATTERNMAKER` sees approval controls).

## 14. Detailed Work Packages & Implementation Sequence
1. **`M01.1` — PostgreSQL Schema, RLS & Append-Only Triggers:** Implement `iam`, `world_model`, `jobs`, and `audit_log` tables with Alembic migrations and immutability triggers.
2. **`M01.2` — RBAC + ABAC Policy Engine & Auth Middleware:** Implement JWT/session context extraction, tenant binding, and fine-grained resource policy checks.
3. **`M01.3` — Fashion World Model & Merkle Provenance Service:** Implement `FashionProject` and `GarmentRevisionNode` CRUD (append-only) and lineage verification endpoints.
4. **`M01.4` — Durable Async Job Orchestrator:** Implement job queue, worker three-point re-authorization, idempotency keys, and supersession of stale jobs when a newer revision is submitted.
5. **`M01.5` — Secure Media & Artifact Storage Service:** Implement content-addressed S3/GCS storage, upload sanitization, and signed URL issuance.
6. **`M01.6` — Next.js Workspace Shell (`apps/web`):** Port workspace shell to Next.js 15 App Router wired strictly to `/api/v1/*` contracts.

## 15. Migration & Parity Strategy (Class A vs Class B Fixtures)
- Replaces the in-memory `src/App.tsx` state container and local `computeSha256Hex` helper (`src/engine/production/crypto.ts`) with server-authoritative PostgreSQL revision nodes and RFC 8785 SHA-256 digests (`Class B`).

## 16. Unit, Property & Adversarial Test Plan
- **Cross-Tenant Penetration Suite:** Tenant A attempts to read, branch, download artifacts, or subscribe to job events belonging to Tenant B → 100% HTTP `403`/`404` rejection.
- **Mid-Job Permission Revocation Test:** Submit long-running job as User U; revoke User U's role while job is `Running`; verify worker aborts commit at Step 3 re-authorization and logs security event.
- **Immutability Tamper Test:** Attempt SQL `UPDATE` or `DELETE` on `garment_revision_nodes` or `audit_log_entries` → blocked by database trigger.
- **Malicious Upload Suite:** Polyglot PNG/HTML, oversized zip bomb, and spoofed Content-Type headers → rejected at media intake gate.

## 17. Independent Verification Oracles
- Independent SQL RLS policy verifier + standalone Merkle DAG lineage auditor script verifying every revision digest from root to head.

## 18. Physical, Manufacturing or Financial Validation Protocol
- N/A for physical cutting in `M01`; validates institutional audit-log completeness and cryptographic non-repudiation required by `M05`, `M07`, and `M08`.

## 19. Acceptance Criteria (`AC-01`–`AC-12` Mapping)
- **`AC-01`**: 100% OpenAPI 3.1 / Pydantic v2 / TypeScript contract conformance.
- **`AC-02`**: 100% unit and integration test pass rate.
- **`AC-04`**: Next.js `apps/web` performs zero local domain computation or unauthenticated state mutation.
- **`AC-11`**: Zero cross-tenant leakage, 100% three-point worker re-authorization, and verified append-only revision immutability.

## 20. Failure Modes, Rollback & Recovery Procedures
- **Worker Crash Mid-Job:** Durable job heartbeat timeout marks job `Retryable`; idempotent worker restarts with fresh ABAC check or marks `Failed` after max retries without corrupting parent revision node.

## 21. Observability, Audit Logging & Telemetry
- Every authorization decision, revision creation, job state change, and signed-URL issuance writes an immutable `AuditLogEntry` (`actor_id`, `tenant_id`, `action`, `resource_id`, `decision`, `trace_id`, `timestamp`).

## 22. Explicit Non-Goals & Scope Guardrails
- `M01` does not implement pattern drafting (`M02`), 3D cloth simulation (`M06`), or payment ledgering (`M08`); it provides the canonical entity graph, job runner, and security boundary those workloads plug into.

## 23. Downstream Unlocks
- Unlocks **`M02b`–`M02h`**, **`M03`**, **`M04`**, **`M05`**, and **`M08`**.

## 24. Definition of Done Checklist
- [ ] PostgreSQL schema with RLS and append-only triggers deployed and tested.
- [ ] `Person` / `Organization` / `Tenant` / `Role` RBAC+ABAC policy engine active on 100% of endpoints.
- [ ] Three-point async job re-authorization verified under mid-job revocation tests.
- [ ] Secure media upload & signed artifact download pipeline verified.
- [ ] Next.js `apps/web` workspace connected to `services/fashion-engine` via generated contracts.
