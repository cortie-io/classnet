# Phase2 beta and official launch

Only install `schema.sql` on network_tutor_phase2. It creates a singleton in beta mode;
reapplying it never changes an existing stage. The frozen phase1 DB is never migrated.

The authenticated admin POST `/api/admin/service-launch/start?period=2` requires the
exact confirmation `2차 정식 시작`. It atomically moves beta -> starting and records the
requesting admin and UUID. Repeated submissions cannot start a second reset. An archive
period mutation is rejected by the common period middleware.

The host-only systemd worker runs with root-owned scripts/env (0700 directory, 0600 files).
`pg.env` contains PGDATABASE=network_tutor_phase2, host, port, user, password,
PGSSLMODE=verify-full and PGSSLROOTCERT=/cert.pem; rds-ca.pem is the public CA bundle.
The worker uses the pinned official postgres client image, never executes user-supplied
commands, and does not expose Docker or backup permissions to either application.

A requested launch stops BOTH production application containers, creates a full private
phase2 public application-schema custom-format backup in `/var/backups/classnet-phase2-beta`, and verifies it with
pg_restore before executing reset.sql. The reset and official timestamp commit together.
Accounts, credentials, profile/class assignments, curriculum, embeddings, question bank,
exam definitions and settings remain intact. Learning/activity/cache/session rows and
manual student scores are cleared. Auth versions increment for everyone, requiring login.
The untouched drizzle migration ledger is excluded from the application backup; no extra
migration-schema permissions are granted to the runtime account. Sequences are intentionally monotonic, preventing old links from resolving to a new exam.
The login page clears browser-only pending drafts after successful sign-in.

An inventory guard refuses unreviewed new public tables (update policy when integrating
new features). Backup/reset errors roll back the reset and reopen beta. A durable local
restart intent handles a host crash after the official commit without a second reset.
A missing DB connection leaves the worker failed and the state unchanged until retried.
Run `sudo python3 /var/lib/classnet-launch/worker.py --check` for a read-only check.
Never run the start endpoint as a deployment smoke test.

Phase1 keeps its independent read-only connection and administrator 1차/2차 selector
throughout the launch. Beta backups are private recovery material, not student history.
