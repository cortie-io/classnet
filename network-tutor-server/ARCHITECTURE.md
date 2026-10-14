# Server structure

- app.ts: HTTP middleware and route composition; importing it starts no listener.
- server.ts: corpus startup, listener and graceful shutdown.
- features/auth: identity, password reset, session revocation and shared request admission.
- features/tutor: question/explanation routes, request parsing and answer pipeline.
- features/exams: exam routes and exam/report/question-bank services.
- features/admin: account/admin endpoints and the existing explicit ranking policy.
- features/audit, features/bookmarks, features/settings: their respective APIs.
- infrastructure/db, infrastructure/llm, infrastructure/search: PostgreSQL, model transport and retrieval.
- domain/network: deterministic IP/network calculations.
- ingest: reference parsing and in-place updates that preserve student/question references.
- test: isolated in-memory PostgreSQL and blocked external network calls.

## Contracts and validation

API paths stay compatible. Student history additionally accepts paginated=true and beforeId, with stable (created_at, id) ordering. Legacy array responses remain supported.

The existing manually fixed ranking is kept in features/admin/rankingPolicy.ts. Dialogue wording does not change activity counts, dates or exam results.

Run npm run typecheck and npm test. Tests never load production .env, never connect to production PostgreSQL, and do not call actual AI APIs.

Run npm run migrate separately from image builds. New columns/tables are additive. npm run ingest updates nodes by section_no; it neither truncates the question bank nor student answers. Regenerate model-specific vectors with npm run embed:nodes after installing a valid provider key.

Build and deploy both services from the same reviewed integration snapshot, after frontend design changes have been merged. Do not bake credentials into images.

## Runtime image

The image compiles TypeScript once and runs dist/server.js as the node user. Tests and development dependencies stay in the builder. SQL and legacy static resources are copied explicitly. Inside the production image use npm run migrate:built or npm run embed:nodes:built; source commands remain available for development.
