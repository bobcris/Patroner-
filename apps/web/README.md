# Apps/Web — Next.js 15 Presentation Shell Staging Boundary (`DEC-01` & `M00.3`)

Per **`DEC-01`** (Approved at **`Gate Auth-1`**, Checkpoint 12, `16 November 2026`):
- `apps/web/` is the designated monorepo boundary for the Next.js 15 App Router read-only presentation shell (`M01.2` Strangler-Fig migration).
- During `M00` (`M00.1`–`M00.10`), the existing Vite application at the repository root remains the active interactive shell on port `3000`, while `packages/contracts/` and `services/geometry-engine/` execute the `M00` verification, library qualification (`IntervalLibraryQualificationReport`), and 17-family adversarial geometry oracle (`AG-01`–`AG-17`).
- Full cutover of `apps/web/` and production `M02` geometry routes remains gated on **`Gate Auth-2` / `DEC-13 Stage 2`**.
