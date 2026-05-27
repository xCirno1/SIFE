# SIFE — Development Pipeline Agents

This document describes the five specialized agents for **SIFE (Smart Indexing File Engine)** and how they work together in a coordinated development workflow. Each agent has a specific role; combined, they form a complete pipeline from planning to production release.

## Project Overview

SIFE is a local, offline-first, high-performance hybrid file indexing and semantic search engine for Windows built on **Electron + TypeScript + Vite + React + Tailwind CSS**. All heavy work (file watching, vector embedding, DB I/O) runs in `worker_threads`. The Main and Renderer processes stay lightweight.

**Always enforce across all agents:**
- No heavy work on Main or Renderer — all CPU tasks in `worker_threads`
- IPC payloads must be tiny (paths/metadata/arrays — no embeddings or buffers)
- `contextBridge` security bridge mandatory (`nodeIntegration: false`, `contextIsolation: true`)
- Install packages via CLI only (`npm install <pkg>`) — never write to `package.json` manually
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` after every change
- Commit to GitHub after each feature, fix, or update

---

## Agent Overview

| Agent | Role | Phase | Use When |
|-------|------|-------|----------|
| **Orchestrator** | Workflow coordinator | Meta | You have a complete SIFE feature/epic and want the full pipeline (Architect → Builder → Validator → Scribe) |
| **Architect** | Planning & design | Analysis | You need to understand requirements, design architecture, or create a roadmap before building |
| **Builder** | Implementation | Development | You have a roadmap and need production-ready code written and integrated |
| **Validator** | Testing & QA | Validation | You need comprehensive test coverage, quality assurance, and production readiness confirmation |
| **Scribe** | Documentation | Release | You need API docs, guides, examples, and architecture diagrams for a feature |

---

## Complete Workflow

### The Orchestrator Pipeline (Recommended)

Use the **Orchestrator** for complete SIFE features from planning to release:

```
User Request: "Build the ingestion pipeline"
       ↓
┌─────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Coordinates entire workflow)             │
└─────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────┐
│  PHASE 1: ARCHITECT (Planning)                          │
│  • Explores codebase and SIFE architecture rules        │
│  • Analyzes requirements and constraints                │
│  • Designs architecture (thread isolation, IPC safety)  │
│  • Creates implementation roadmap (phases + risks)      │
│  └─ HANDOFF: Architecture Design & Roadmap             │
└─────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────┐
│  PHASE 2: BUILDER (Implementation)                      │
│  • Reads Architect's roadmap                            │
│  • Implements features — no stubs, no TODOs             │
│  • Installs deps via CLI; runs tsc, lint, build         │
│  • Commits to GitHub after each phase                   │
│  └─ HANDOFF: Working Code + Build Verification         │
└─────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────┐
│  PHASE 3: VALIDATOR (Quality Assurance)                 │
│  • Writes Jest unit & integration tests                 │
│  • Writes Playwright E2E tests                          │
│  • Validates query latency <5 ms                        │
│  • Validates coverage ≥80%                              │
│  • Checks IPC payload safety & thread isolation         │
│  └─ Decision Point:                                     │
│     ✓ PASS: All gates pass                              │
│     ❌ BLOCK: Quality gate failed → STOP PIPELINE      │
└─────────────────────────────────────────────────────────┘
       ↓ (if PASS)
┌─────────────────────────────────────────────────────────┐
│  PHASE 4: SCRIBE (Documentation)                        │
│  • Creates API documentation for sifeEngine bridge      │
│  • Writes usage guides and README updates               │
│  • Generates Mermaid architecture diagrams              │
│  • Documents omnibar query syntax and FileRecord schema │
│  └─ HANDOFF: Production-Ready Release Package           │
└─────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────┐
│  ✓ COMPLETE & READY FOR PRODUCTION                      │
│  • Working, tested, committed code                      │
│  • Comprehensive documentation                          │
│  • Examples and guides                                  │
│  • Quality metrics and coverage reports                 │
└─────────────────────────────────────────────────────────┘
```

### Error Handling in Pipeline

**If Validator BLOCKS** (quality gates fail):
- ❌ Pipeline STOPS immediately
- ❌ Scribe is NOT invoked
- ⚠️ Report: Specific blockers (coverage <80%, failing tests, query latency >5 ms, IPC violation)
- → Recommendation: Fix issues and restart Validator

**If Architect BLOCKS** (requirements unclear):
- ❌ Pipeline STOPS
- → Recommendation: Clarify requirements and restart Architect

**If Builder BLOCKS** (implementation impossible, native binding failure):
- ❌ Pipeline STOPS
- → Recommendation: Escalate to Architect for design revision; try `electron-rebuild` for native binding issues

---

## Individual Agent Usage

### Use Architect Alone

When you need **planning and analysis** without implementation:

- Explore the SIFE codebase and understand its structure
- Design architecture for a new feature (respecting thread isolation rules)
- Analyze how worker threads interact with Main/Renderer via IPC
- Create a technical roadmap aligned to the 6 SIFE implementation steps
- Evaluate LanceDB vs `node:sqlite` FTS5 trade-offs

**Example prompt**: *"Analyze the current query pipeline and propose how to add semantic vector search using Transformers.js CLIP embeddings"*

**Output**: Architecture design, roadmap, identified constraints

---

### Use Builder Alone

When you have a **clear roadmap** and need **implementation only**:

- You already have a detailed technical design from Architect
- You're fixing a specific bug with known requirements
- You're adding a SIFE feature following an existing pattern

**Example prompt**: *"Implement the chokidar file watcher inside a worker thread following this roadmap: [include roadmap]"*

**Output**: Working production-grade code, build verification, GitHub commits, implementation notes

---

### Use Validator Alone

When you need **testing and quality assurance** for existing SIFE code:

- Code is written but not yet tested
- You need comprehensive test suite for an existing feature
- You need to validate quality gates (coverage ≥80%, latency <5 ms)

**Example prompt**: *"Write comprehensive Jest and Playwright tests for the hybrid query engine. Ensure 80%+ coverage and verify query latency stays under 5 ms."*

**Output**: Test reports, coverage metrics, performance metrics, quality gate status (PASS/BLOCK)

---

### Use Scribe Alone

When you need **documentation and examples** for existing SIFE features:

- Code is complete and tested
- You need API documentation for the `sifeEngine` bridge
- You're creating a release package with architecture diagrams
- You're documenting the omnibar query syntax or ingestion pipeline

**Example prompt**: *"Create comprehensive documentation for the ingestion pipeline including API docs, architecture diagram, and omnibar query examples"*

**Output**: API docs, README updates, Mermaid diagrams, examples, organized docs

---

## Decision Tree: Which Agent to Use?

```
Do you have a complete SIFE feature request or epic?
│
├─ YES: Use ORCHESTRATOR (full pipeline: plan → build → test → document)
│
└─ NO: Do you already have a roadmap/design?
   │
   ├─ NO: Use ARCHITECT (planning and analysis only)
   │
   └─ YES: Is the code written?
      │
      ├─ NO: Use BUILDER (implementation only)
      │
      └─ YES: Is it tested?
         │
         ├─ NO: Use VALIDATOR (testing and QA only)
         │
         └─ YES: Is it documented?
            │
            └─ NO: Use SCRIBE (documentation only)
                   YES: ✓ DONE (ready for production)
```

---

## Agent Interactions & Handoffs

### Handoff: Architect → Builder

**What Architect delivers**:
- Clear architecture design (thread isolation, IPC routing, DB strategy)
- Implementation roadmap (phases, dependencies)
- SIFE-specific constraints and decisions
- Identified risks (native bindings, model cold-start, NTFS events)

**What Builder needs from Architect**:
- Scope: What's in/out of this implementation?
- Design: How should components interact across the 3-process boundary?
- Phases: What's the logical order to build?
- Constraints: Which patterns/conventions to follow?

---

### Handoff: Builder → Validator

**What Builder delivers**:
- Working, integrated code (all `tsc --noEmit`, `lint`, `build` checks pass)
- GitHub commit(s) for each phase
- Implementation notes and technical decisions
- List of changes by phase

**What Validator needs from Builder**:
- Source code in the repository
- Build command that works
- Understanding of what was implemented
- Acceptance criteria for each phase

---

### Handoff: Validator → Scribe (or Stop)

**If PASS** ✓:
- All tests passing (0 failures), coverage ≥80%, query latency <5 ms
- IPC payloads verified safe, worker thread isolation confirmed
- Quality gate: APPROVED FOR RELEASE

**If BLOCK** ❌:
- Pipeline STOPS; Validator reports specific blockers
- Builder/Architect addresses issues; Validator re-runs until PASS

---

## Tool Access by Agent

| Tool | Architect | Builder | Validator | Scribe | Orchestrator |
|------|:---------:|:-------:|:---------:|:------:|:------------:|
| **read** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **edit** | ✗ | ✓ | ✓ | ✓ | ✗ |
| **execute** | ✗ | ✓ | ✓ | ✗ | ✗ |
| **search** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **web** | ✓ | ✗ | ✗ | ✓ | ✗ |
| **todo** | ✓ | ✓ | ✓ | ✗ | ✓ |
| **agent** | ✓ | ✓ | ✓ | ✗ | ✓ |

---

## Quality Gates & Success Criteria

### Architect Phase Success
- ✓ Codebase exploration complete
- ✓ Architecture design documented (respects SIFE thread isolation + IPC rules)
- ✓ Roadmap broken into phases aligned to 6 SIFE implementation steps
- ✓ Technical constraints identified (native bindings, model cold-start, NTFS)
- ✓ Risks and mitigations documented

### Builder Phase Success
- ✓ All roadmap phases implemented (no stubs, no TODOs)
- ✓ Code builds successfully (`tsc --noEmit`, `lint`, `build` all pass)
- ✓ SIFE architecture rules followed (thread isolation, IPC safety, security bridge)
- ✓ All changes committed to GitHub
- ✓ Implementation notes documented

### Validator Phase Success
- ✓ All tests pass (0 failures)
- ✓ Coverage ≥ 80% across all modules
- ✓ Query latency confirmed <5 ms
- ✓ Worker thread isolation verified
- ✓ IPC payloads confirmed safe (no embeddings/buffers over IPC)
- ✓ Quality gates: **PASS** (ready for release)

### Scribe Phase Success
- ✓ `sifeEngine` bridge API documented with TypeScript signatures and examples
- ✓ README updated with setup, `.env` variables, build commands, and quick-start
- ✓ Architecture diagrams show 3-process design and IPC flow
- ✓ Omnibar query syntax documented with examples
- ✓ Troubleshooting FAQ covers native binding issues and `electron-rebuild`
- ✓ Docs organized in `docs/` and cross-referenced

---

## Quick Reference: Prompt Templates

### Use Orchestrator
```
"Build and release: [SIFE feature description]. Run full pipeline."
```

### Use Architect
```
"Design the [feature] architecture for SIFE. Create a roadmap respecting thread isolation and IPC rules."
```

### Use Builder
```
"Implement [feature] for SIFE following this roadmap: [paste roadmap]"
```

### Use Validator
```
"Test [feature] comprehensively with Jest + Playwright. Target 80%+ coverage. Verify query latency <5 ms."
```

### Use Scribe
```
"Document [feature] for SIFE. Create API docs, README, architecture diagrams, and examples."
```

---

## Common Workflows

### Workflow 1: Full Feature Release (Recommended)
```
User → Orchestrator → [Architect → Builder → Validator → Scribe] → Production ✓
```

### Workflow 2: Rapid Iteration (Design Already Known)
```
User → Builder → Validator → Scribe → Production ✓
(Skip Architect if design is already clear)
```

### Workflow 3: Architecture Review Only
```
User → Architect → Decision Point → Architect improvements/clarifications
(Get design approval before Builder starts)
```

### Workflow 4: Quality Review of Existing Code
```
User → Validator → Blocker? → Builder (fixes) → Validator again → Scribe → Production ✓
```

---

## Agent Locations

All custom agents are located in `.github/agents/`:

- `.github/agents/orchestrator.agent.md` — Workflow coordinator
- `.github/agents/architect.agent.md` — Planning & design
- `.github/agents/builder.agent.md` — Implementation
- `.github/agents/validator.agent.md` — Testing & QA
- `.github/agents/scribe.agent.md` — Documentation & examples

---

## Tips & Best Practices

1. **Use Orchestrator for complete SIFE features** — It handles handoffs automatically
2. **Let each agent specialize** — Don't ask Builder to test or Validator to write code
3. **Review Architect's roadmap before Builder starts** — Prevents thread isolation rework
4. **Never skip Validator** — Quality gates enforce the <5 ms latency and IPC safety requirements
5. **Document as you go** — Give Scribe clear implementation notes
6. **Escalate native binding issues early** — LanceDB + Electron may require `electron-rebuild`
7. **Track progress with todo lists** — Each agent maintains clear status

---

## Support & Troubleshooting

**LanceDB native bindings fail after `npm install`?**
- Run `npx electron-rebuild` to recompile native modules for the current Electron version
- Ensure `electron-rebuild` is in `devDependencies`

**Transformers.js model not loading?**
- Verify the model cache path is set in `.env` (`MODEL_CACHE_PATH`)
- On first run, the model downloads automatically — check network/firewall

**chokidar missing NTFS rename events?**
- Use `{ usePolling: false, awaitWriteFinish: true }` options on Windows
- Ensure the watcher runs inside a `worker_threads` context, not on Main

**Pipeline blocked at Validator?**
- Review specific blocker (coverage, failing tests, latency >5 ms, IPC violation)
- Address root cause in code; re-run Validator until PASS

---
