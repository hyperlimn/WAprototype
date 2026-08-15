# ProtoUniverse architecture

ProtoUniverse is a deterministic universe plus several ways to observe, preserve, and operate it. Its central dependency rule is:

```text
authoritative state and laws
  -> derived measurements
  -> observational snapshots and queries
  -> faculties and projections
  -> human or machine presentation

supervisor
  -> owned runtime services (Bridge/API, frontend)
```

Lower layers must not depend on presentation, operator UI, or experimental policy. Observer projections do not alter the universe. The Laboratory restricts access to truthful authoritative observations; it does not change or fabricate reality.

## Current layers

### Authoritative simulation

`src/simulation/` contains entity and relationship state, deterministic fingerprints and oscillation identity, seeded randomness, physics, dimensional state, relationship lifecycle, rupture, reproduction, fields, and higher-order behavior. `Universe` owns the authoritative runtime and hand-wires the exact step order. `SIMULATION_SYSTEM_ORDER` documents that order; it does not execute it.

`WorldState` currently contains several kinds of data in one compatible runtime shape. `WORLD_STATE_FIELDS` classifies every field without migrating it. Entity arrays, bond and relationship maps, subsystem continuation records, occurrence sequence, PRNG cursor, clock, and scheduler markers together form the continuation surface.

Forbidden dependencies: simulation code must not import UI, Three.js, MCP, Laboratory, persistence stores, or operator modules. Wall-clock profiling and rendering animation must never feed physics.

#### Law Evolution v1

Law Evolution is authoritative, deterministic law state. Every 500,000 completed ticks, after all existing step phases and measurements, the runtime builds `cosmological-state-vector/1`, encodes its classified measurements as fixed-point big-endian bytes, and hashes those bytes with the universe identity, epoch, boundary, grammar versions, previous law-set hash, and previous evolution hash. `law-grammar/1` decodes only a bounded parameter modulation. The mutation is installed atomically and first affects the following tick.

```text
completed authoritative state
-> canonical cosmological vector
-> Law Evolution Hash
-> bounded Law Genome
-> effective parameter set and immutable law-set manifest
-> subsequent authoritative evolution
```

The typed Law Parameter Registry is the only route by which an evolved genome can affect physics. V1 cannot generate code, add phases, change PRNG/tick/save/archive machinery, or allocate per-entity law state. Effective parameter lookup is fixed-size and O(1); immutable birth records are continuation history.

### Derived measurements

Current aggregates in `WorldState`, diagnostics in `src/observation/`, oscillation-at-tick, anomaly scores, comparisons, and attention rankings are derived observations. Some rolling values remain persisted for save compatibility even when rebuildable. Observer-only timing data lives outside `WorldState` and save payloads.

### Persistence

`src/simulation/saveState.ts` defines the executable continuation schema `protouniverse-save-state/2`. `server/save-state/` writes immutable artifacts and verifies compatibility/checksums. Version-1 saves below tick 500,000 migrate explicitly into Law Epoch 0; later version-1 saves fail closed because Law Evolution did not shape their past. `server/memory/` owns observational archives and checkpoints. Checkpoints are evidence; save states are executable continuation points. Neither is presentation state.

Save compatibility rule: do not change the continuation schema, state meaning, PRNG semantics, or law order without an explicit version and migration decision.

### Observation and query

`src/interface/worldSnapshot.ts` creates the canonical machine snapshot from a universe. Reusable diagnostics live in `src/observation/`, never `src/ui/`. `src/query/` and `src/perception/` consume snapshot records and archived evidence. `OBSERVATION_FIELD_CLASSIFICATION` records the known epistemic categories in preparation for a future field-classified schema; it does not yet drive filtering.

### Machine faculties and MCP

`server/mcp/` exposes read-only structured faculties and deterministic rendered Human View through the Bridge/API gateway. Faculties consume observational interfaces rather than simulation implementation objects. MCP must not become a mutation, filesystem, shell, or unrestricted network path.

### Laboratory and the Veil

`server/laboratory/` loads persistent experiment definitions, derives policy, filters outputs/resources centrally, and exposes a distinct Laboratory MCP doorway. Freeze/reveal/compare artifacts remain outside universe history. Laboratory access must always pass through its gateway; experiments must not gain normal MCP, memory, bookmarks, shell, filesystem, or web access unless explicitly designed and safely supported.

### Human projections and rendering

`src/rendering/` contains the 2D camera, renderer, and dimension projection policy. `src/ui/` binds panels and controls to observational state. Projections may filter or emphasize visible information, but cannot write simulation state. The canonical direction is observation/projection policy to renderer, not renderer back into simulation.

### Entity close-up morphology

`src/closeup/` maps immutable fingerprints to a deterministic morphology genome, bounded topology and pattern features, then a lazily created Three.js close-up. Oscillation adds tick-derived visual breathing only. Connection particles are one buffered point per current relationship; their deterministic planes, shells, speed, state color, and glow are observer projections of current relationship measurements. Camera, animation, particles, and WebGL lifecycle are presentation concerns and must remain disposable and non-authoritative.

### Bridge, operator tools, and supervisor

`server/index.ts` hosts the loopback Bridge/API, receives browser-authoritative snapshots, serves observational queries, and runs allowlisted operator jobs. `server/supervisor/` is the control plane and owns the frontend and Bridge/API child PIDs. Runtime replacement uses immutable save-state continuation, semantic health checks, browser reconnection, and provenance verification. It may stop only tracked children and must never expose arbitrary commands or paths.

## Boundaries to preserve

- Authoritative simulation may publish state; it must not know how observers render or filter it.
- Persistence serializes domain schemas, not DOM, canvas, Three.js, or operator-console fields.
- Snapshot/query code may depend on simulation and observation modules, never UI implementations.
- Laboratory policy wraps observational gateways; authoritative query code must remain usable without Laboratory conditions.
- Human and machine projections should converge on shared observation/projection semantics without sharing presentation machinery unnecessarily.
- Supervisor owns process lifecycle; the Bridge/API owns approved application actions; the browser owns neither process spawning nor arbitrary shell execution.

## Versioned guardrails

- Simulation version: `SIMULATION_VERSION`.
- Law/system-order version: `SIMULATION_LAW_SET_VERSION`.
- Save compatibility: `SAVE_STATE_SCHEMA_VERSION`.
- Machine observation: `MACHINE_INTERFACE_VERSION` / server interface version.
- Deterministic state hashes intentionally exclude operational runtime provenance and wall-clock metadata.

Golden replay hashes are law-regression fixtures. An intentional law or continuation change must explain and deliberately update them; an architectural refactor should leave them unchanged.

## Deliberately deferred

Architecture Foundation v1 does not create a dynamic system pipeline, generic plugin loader, new state schema, timeline/branch model, worker-owned simulation, classified Veil schema, or shared renderer scene graph. Those changes require separate compatibility and behavior decisions.
