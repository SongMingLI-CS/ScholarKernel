# Phase 7 Engineering and Research Plan

## Goal

Complete the locally executable handover and Phase 6 closure, then make focused Phase 7 reliability improvements from the verified Phase 6 baseline. Preserve the user's existing checkout and report any old-device assets that are unavailable.

## Verified baseline and limits

- Base commit: `62055ecc7ced5738866f1b27b0032e3d31c76ba9` (`origin/phase6-final-reliability-ai-validation`).
- Development branch: `feature/phase7-engineering-research`, in an isolated worktree.
- The requested old-device commit `8c4c3ae425d1b564d4ce8a302ca8b1e7b79c4194` is absent from the fetched repository objects.
- This Windows device has Node 22 and PostgreSQL 18 available; no PostgreSQL 16 service is running. Docker is installed but its daemon is stopped.
- No independent `ScholarKernel-reranker` source/checkpoint or PyTorch installation has been found so far. No real provider credentials are configured; live paid inference and training are out of scope.

## Execution sequence

1. Fix the reproducible Windows PDF.js directory URL failure and workflow-test argument quoting, with focused regression checks.
2. Add fixture-only executor audit tests for retrieved evidence propagation, empty/failed search state, human-intervention cancellation, and reviewer failure; fix only demonstrated gaps.
3. Split GitHub Actions into independent quality, integration, build, and browser-test jobs. Keep Node 22, PostgreSQL 16, migrations, schema parity, Playwright, and mock-only model calls.
4. Review the existing Phase 6 durable-job, retrieval, and UI behavior. Implement only bounded, evidence-backed gaps; do not replace the BM25 design or fabricate model results.
5. Run the complete locally applicable checks on the isolated PostgreSQL database and fixture endpoints. Record platform/version, pass/fail/skip counts, mock versus real IO, and limits.
6. Write the handover and Phase 7 reports with explicit validation categories, create meaningful local commits, and confirm the final branch/worktree. Do not push, merge, deploy, or alter the original checkout.

## Acceptance criteria

- Focused regressions pass on Windows; quality/workflow, typecheck, lint, build, upgrade integration, and Playwright results are reported from actual runs.
- CI configuration has separate jobs and preserves the intended runtime/database checks; remote CI is not reported as passing without a run.
- No API secret, model weight, user data, or generated benchmark claim is committed.
- All seven required handover/report documents exist and distinguish implemented-and-verified work, mock-only checks, unverified work, and external blockers.
- Local commits exist, the final worktree state is recorded, and the original checkout remains untouched.
