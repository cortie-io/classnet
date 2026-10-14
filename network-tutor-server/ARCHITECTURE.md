# Server structure

- app.ts: HTTP middleware and route composition; importing it starts no listener.
- server.ts: corpus startup, listener and graceful shutdown.
- features/auth: identity, password reset, session revocation and shared request admission.
- features/tutor: question/explanation routes, request parsing and answer pipeline.
- features/exams: exam routes and exam/report/question-bank services.
- features/admin: account/admin endpoints, period selection, frozen archive access and assessment-based ranking.
- features/audit, features/bookmarks, features/settings: their respective APIs.
- infrastructure/db, infrastructure/llm, infrastructure/search: PostgreSQL, model transport and retrieval.
- domain/network: deterministic IP/network calculations.
- ingest: reference parsing and in-place updates that preserve student/question references.
- test: isolated in-memory PostgreSQL and blocked external network calls.

## Contracts and validation

API paths stay compatible. Student history additionally accepts paginated=true and beforeId, with stable (created_at, id) ordering. Legacy array responses remain supported.

Phase1 is frozen in network_tutor_db and selected only by authenticated administrators using period=1. Its ranking is the stored phase_archive_snapshot payload. Its SELECT-only role cannot change historical rows. Phase2 uses network_tutor_phase2 with a separate application role. Its rank sums first completed question scores divided by each question maximum; repeated questions, chat volume, unfinished/invalidated attempts and manual score inputs do not add ranking points. Exact ties share a rank; students without graded records have no rank. No student IDs or artificial score corrections are embedded in the ranking code.

Identity and learning records are physically separated by database. Deleting/editing a phase2 student cannot affect their phase1 identity or history. Authentication always uses the active database, before AsyncLocalStorage selects an administrator's archive pool. Student routes never accept an archive pool selection. Next.js uses the active DATABASE_URL (POSTGRES_URL is retained as a compatibility fallback). All client admin requests and navigation preserve the selected period explicitly.

Run npm run typecheck and npm test. Tests never load production .env, never connect to production PostgreSQL, and do not call actual AI APIs.

Run npm run migrate separately from image builds. Never run migrations against frozen phase1. The phase2 preparation creates a separate database, retains account credentials and curriculum, and leaves all learning/session tables empty. Obsolete token-burn counters are omitted from phase2. npm run ingest updates nodes by section_no; it neither truncates the question bank nor student answers. Regenerate model-specific vectors with npm run embed:nodes after installing a valid provider key.

Build and deploy both services from the same reviewed integration snapshot, after frontend design changes have been merged. Do not bake credentials into images.

## Runtime image

The image compiles TypeScript once and runs dist/server.js as the node user. Tests and development dependencies stay in the builder. SQL and legacy static resources are copied explicitly. Inside the production image use npm run migrate:built or npm run embed:nodes:built; source commands remain available for development.

## Two-stage release

The completed design and frozen-service notice are already deployed independently. Keep the live service on frozen phase1 until the concurrent backend work has been integrated and the complete second release has passed validation. The protected phase1 dump and ranking live in /var/backups/cortie-db/phase1-freeze-20261014 on alpha. scripts/operations/prepare_phase2.py intentionally fails if its target database/roles exist; never rerun by deleting the guards. Protected phase2-runtime.env contains both database variable names and the archive reader URL; it is not part of the image or Git.

Switch both the server DATABASE_URL and web DATABASE_URL/POSTGRES_URL together, plus ACTIVE_SERVICE_PERIOD=2 and server PHASE1_DATABASE_URL. Keep encryption/auth/internal secrets stable. Do not reset the database on startup or deployment. A rollback of UI code must never write to frozen phase1 or overwrite phase2 data.

## Phase2 student groups

Class codes are 1-A, 1-B, 1-C, 2, 3, 4. The first three map to grade1; the others map to grades2/3/4. Grade is derived, never independently editable. Preserved accounts start with class_code=NULL until a teacher assigns them. Profile edits, account creation and CSV imports validate against domain/students/classes.ts. Batch assignment validates the entire student set before one atomic UPDATE; it cannot partially apply to missing or administrator accounts.

Rank filtering accepts exactly one classCode or grade. Question points remain identical to the overall rank; competition ranks are recomputed inside the selected population. Unassigned students remain included overall and can be viewed separately. Phase1 has no retroactive class data; its frozen ranking is never recomputed by group.
