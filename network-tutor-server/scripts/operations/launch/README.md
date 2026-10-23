# Phase2 official launch: preserve existing student data

Policy changed on 2026-10-20: official launch retains all existing accounts, credentials,
learning progress, chats, answers, attempts, scores, rankings, bookmarks and settings.
The phase1 archive is never modified. Only service_launch changes during the launch.

The authenticated administrator start endpoint retains its exact confirmation and one-way
beta -> starting -> official guards. The host worker stops both writers, creates and
verifies a private backup, and runs reset.sql. That historical filename now contains
only the guarded official-stage update; it must never clear any learning tables or
change users/auth versions. Repeated launch requests cannot reset data.
Failed backups leave beta and its data intact; committed official launch is idempotent.
Run worker_test.py and src/features/settings/launch.test.ts after changes.
