# 08 — Vertical Slice 1 Definition: End-to-End Deterministic 2D CAD to Signed DXF-AAMA

**Document ID:** `PATRONER-R2.1.2-R1-08`  
**Baseline:** Blueprint Revision 2.1.2-R1 (Targeted Mathematical Correction, Singularity Classification & Governance Alignment)  
**Governing Authority:** Monograph v5.16; Addendum v4.1; `ADR-001`, `ADR-003`, `ADR-009` (`R2.1.2-R1`); `06_ACCEPTANCE_AND_EVIDENCE_FRAMEWORK.md`  
**Status:** **CONTROLLED SPECIFICATION — BLOCKED PENDING M00 COMPLETION & GATE AUTH-2 SIGN-OFF**

> **Mandatory Governance Boundary (`R2.1.2-R1`):** `R2.1.2-R1` is a documentation correction only. `M00` remains blocked pending explicit owner approval.

---

## 1. Objective and Scope of Vertical Slice 1

Vertical Slice 1 proves the core architectural thesis of Addendum v4.1 and Blueprint `R2.1.2-R1`: **an end-to-end, deterministic, mathematically certified pipeline from anthropometric `BodyProfile` intake to an industrial-grade, round-trip-verified DXF-AAMA cut package and `Ed25519`-signed `TechPackManifest`** for two canonical woven blocks:
1. **Block 1:** Structured Women's Darted Bodice (Front + Back + Sleeve).
2. **Block 2:** Tailored Straight-Leg Trouser (Front + Back + Waistband).

Vertical Slice 1 spans `M01` (`M01.1`–`M01.3`), `M02` (`M02a`–`M02g`), and `M05` (`M05.1`, `M05.3`, `M05.5`) and culminates in **`Gate Auth-3`**.

---

## 2. End-to-End Pipeline Stages & Mathematical Invariants

### Stage 1: Anthropometric Intake & Contract Validation (`apps/web` $\to$ `M02a`)
* User submits a 14-measurement `BodyProfile` (`cm`) via the Next.js 15 UI (`apps/web/`).
* FastAPI (`services/geometry-engine/`) validates anatomical plausibility bounds and covariance constraints against the `M00.1` schema.

### Stage 2: Deterministic Parametric Block Drafting & Grading (`M02b`, `M02c`, `M02d`)
* Python `C1-Fast` synthesizes the exact cubic Bezier boundary segments $\mathbf{B}_i(t)$ ($t \in [0, 1]$) oriented **counter-clockwise (CCW)** along the exterior sew boundary (`Layer 8`) in the right-handed $(x, y)$ plane (`ADR-009 §1.1`).
* All curved seams (armscye, neckline, sleeve cap, crotch curve) are measured via **5-point adaptive Gauss-Legendre quadrature** ($\le 10^{-6}\text{ cm}$ error, `M02c`) and walked to place orthogonal notches via **monotone Newton-Brent inversion** ($|L(t^*) - s_{\mathrm{target}}| \le 10^{-7}\text{ cm}$, with dual parameter/physical stopping criteria $\delta_t \le 10^{-12}$ AND $\Delta_{\mathrm{pos}}([t]) \le 10^{-7}\text{ cm}$, `ADR-009 §4.1`).

### Stage 3: Certified Seam Allowance Offset & Singularity Classification (`M02e`, `ADR-009`)
* For each boundary segment $\mathbf{B}(t)$ and seam allowance width $d > 0$ (`e.g., d = 1.5 cm` side/shoulder seams, `d = 1.0 cm` armscye/neckline, with outward direction sign $s = -1$ on a CCW exterior contour so $s\,d\,\mathbf{N}_+(t) = -d\,\mathbf{N}_+(t)$ points **outward**):
  $$\mathbf{O}(t) = \mathbf{B}(t) + s\,d\,\mathbf{N}_+(t), \qquad \mathbf{O}'(t) = \bigl(1 - s\,d\,\kappa(t)\bigr)\,\mathbf{B}'(t) = f(t)\,\mathbf{B}'(t)$$
* `M02e` executes the **`ADR-009` 6-Category Offset Classifier**:
  1. Checks for base-curve speed zeros $Q(t^*) = 0$ ($\min Q \le 10^{-8} \max Q$) and classifies them via Taylor/Puiseux orders $(m, n)$ to distinguish `Category 2a` (`ACTUAL_ZERO_SPEED_CUSP`, $m$ even) from `Category 2c` (`REMOVABLE_PARAMETERIZATION_DEGENERACY`, $m$ odd, e.g., $\mathbf{B}(t) = (t^3, 0)$, which is reparameterized to a smooth regular segment).
  2. Checks regular curvature cusps $P_{\mathrm{cusp}}(t) = Q(t)^3 - d^2 C(t)^2 = 0$ with sign filter $s \cdot C(t) > 0$ (`Category 2b` transverse vs. `Category 3` tangential grazing).
  3. Fits piecewise cubic Bezier curves to `Category 1` (and reparameterized `Category 2c`) segments achieving dense-grid error $E_{\mathrm{grid}} \le 0.005\text{ cm}$ (`0.05 mm`) and certified interval enclosure $E_{\mathrm{cert}} \le 0.010\text{ cm}$ (`0.10 mm` over $N_{\mathrm{cert}} \ge 256$ panels), with $G^1$ join continuity $\le 0.05^\circ$.
  4. Trims local cusp swallowtails (`Category 2b`) and non-local self-intersections (`Category 4`) and constructs exact miter/bevel/round corner joins.

### Stage 4: Pre-Flight Manufacturing Gatekeeper & DXF-AAMA Export (`M05.1`, `M05.3`, `M05.5`)
* **`M05.3` Gatekeeper Verification:**
  * Confirms all exterior cut (`Layer 1`) and sew (`Layer 8`) boundaries are closed ($\le 10^{-6}\text{ cm}$), simple (`is_simple == True`), CCW-oriented, and free of micro-slivers ($< 10^{-4}\text{ cm}^2$).
  * Confirms **Tier 1 CAD Paired Seam Length Parity (`DEC-11`)**: $|L_{\mathrm{CAD}}(e_A) - L_{\mathrm{CAD}}(e_B) - \Delta_{\mathrm{ease}}| \le 0.05\text{ cm}$ (`0.5 mm`).
  * Confirms zero untrimmed `Category 2a`, `2b`, `3`, or `4` singularities remain on the exported cut contour.
* **Independent DXF-AAMA Round-Trip Check (`M05.1`):**
  * Exports DXF-AAMA (`Layers 1, 2, 4, 7, 8, 11`) and re-parses via the independent `M00.7` parser, verifying $\le 0.001\text{ cm}$ (`0.01 mm`) round-trip fidelity.
* **Cryptographic Signing (`M05.5`, `DEC-09`):**
  * Emits an RFC 8785 JCS canonicalized `TechPackManifest.json` signed with `Ed25519` containing SHA-256 hashes of all pattern artifacts.

### Stage 5: Read-Only Next.js Viewport Rendering (`apps/web/`)
* Next.js 15 renders the Python-authored `PatternPiece[]` JSON payload, displaying `Layer 8` (sew line), `Layer 1` (cut line), notches, grainlines, and the `M05.3` Gatekeeper certification badge with zero client-side coordinate recalculation.

---

## 3. Vertical Slice 1 Exit Criteria (`Gate Auth-3` Readiness)

Vertical Slice 1 is complete when:
1. All 17 Adversarial Geometry Test Families (`AG-01`–`AG-17`, including `AG-11` $\mathbf{B}(t) = (t^3, 0)$) pass 100% in CI (`M00.4`/`M02e`).
2. Both canonical blocks (Darted Bodice + Tailored Trouser) pass `M05.3` Pre-Flight Gatekeeper and independent DXF-AAMA round-trip verification across 25 anthropometric test profiles (`VerticalSlice1VerificationBundle.json`).
3. End-to-end API latency (`C1-Fast` draft + offset + Gatekeeper + DXF export) is $\le 250\text{ ms}$ p95 per garment block.
