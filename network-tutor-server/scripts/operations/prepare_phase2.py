"""Run as root on alpha. Prepare isolated phase2; never switch live app configuration.
Requires the protected phase1 dump/ranking and frozen phase1 application privileges.
"""
import json, os, pathlib, runpy, secrets, subprocess, urllib.parse
ROOT = pathlib.Path('/var/backups/cortie-db/phase1-freeze-20261014')
OLD, NEW = 'network_tutor_db', 'network_tutor_phase2'
APP, READER = 'ntutor_phase2_app', 'ntutor_phase1_reader'
helper = runpy.run_path('/usr/local/sbin/cortie-dbctl', run_name='db_tools')
env = {**os.environ, **helper['conn'](admin=True, ask=False)}
def sql(q, database=OLD):
    return subprocess.check_output(['psql','-XAt','-v','ON_ERROR_STOP=1','-d',database,'-c',q],env=env,text=True).strip()
def literal(value): return "'" + value.replace("'", "''") + "'"
def scalar(q, database=OLD): return int(sql(q,database))
if not (ROOT/'phase1.dump').is_file(): raise RuntimeError('Frozen phase1 backup missing')
ranking = json.loads((ROOT/'ranking.json').read_text())
if scalar("SELECT count(*) FROM users WHERE student_id='QA-TOKENBURN'"): raise RuntimeError('QA account remains')
if scalar("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND has_table_privilege('network_tutor_app',format('%I.%I',schemaname,tablename),'INSERT,UPDATE,DELETE,TRUNCATE')"):
    raise RuntimeError('Phase1 application still has write access')
if scalar("SELECT count(*) FROM pg_database WHERE datname="+literal(NEW)): raise RuntimeError('Phase2 already exists; inspect instead of overwriting')
for name in [APP,READER]:
    if scalar("SELECT count(*) FROM pg_roles WHERE rolname="+literal(name)): raise RuntimeError('Target role already exists; inspect before retry')
password, reader_password = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
# Store recovery material before creating any external resources.
secrets_path=ROOT/'phase2-role-secrets.json'
with secrets_path.open('x') as f: json.dump({APP:password,READER:reader_password},f)
secrets_path.chmod(0o600)
schema_path=ROOT/'phase1-schema.dump'
with schema_path.open('xb') as f:
    subprocess.run(['pg_dump','-Fc','--schema-only','--no-owner','--no-acl','-d',OLD],env=env,stdout=f,check=True)
schema_path.chmod(0o600)
static=['users','concept_nodes','lookup_tables','node_embeddings','exam_questions']
if scalar("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='concept_embeddings'"): static.append('concept_embeddings')
data_path=ROOT/'phase2-identities-and-curriculum.dump'
with data_path.open('xb') as f:
    subprocess.run(['pg_dump','-Fc','--data-only','--no-owner','--no-acl','-d',OLD,*sum((['-t',t] for t in static),[])],env=env,stdout=f,check=True)
data_path.chmod(0o600)
sql('CREATE ROLE '+APP+' LOGIN PASSWORD '+literal(password))
sql('CREATE ROLE '+READER+' LOGIN PASSWORD '+literal(reader_password))
sql('CREATE DATABASE '+NEW)
subprocess.run(['pg_restore','--exit-on-error','--no-owner','--no-acl','-d',NEW,str(schema_path)],env=env,check=True)
subprocess.run(['pg_restore','--exit-on-error','--no-owner','--no-acl','-d',NEW,str(data_path)],env=env,check=True)
schema=pathlib.Path(__file__).resolve().parents[2]/'src/infrastructure/db/schema.sql'
subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-d',NEW,'-f',str(schema)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
sql("""BEGIN;
UPDATE users SET level=CASE WHEN role='student' THEN 'beginner' ELSE level END,
manual_pre_test_score=NULL,manual_post_test_score=NULL,auth_version=auth_version+1;
ALTER TABLE users DROP COLUMN IF EXISTS token_quota, DROP COLUMN IF EXISTS token_used,
DROP COLUMN IF EXISTS token_remaining, DROP COLUMN IF EXISTS last_token_burn_at;
COMMIT;""",NEW)
sql('REVOKE CONNECT ON DATABASE '+NEW+' FROM PUBLIC; GRANT CONNECT ON DATABASE '+NEW+' TO '+APP,NEW)
sql('GRANT USAGE ON SCHEMA public TO '+APP+'; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO '+APP+'; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO '+APP,NEW)
sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO '+APP+'; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO '+APP,NEW)
# Frozen ranking is metadata only; no historical row or score is recalculated or rewritten.
sql('CREATE TABLE phase_archive_snapshot(key text PRIMARY KEY,payload jsonb NOT NULL)')
sql("INSERT INTO phase_archive_snapshot VALUES('ranking',"+literal(json.dumps(ranking,ensure_ascii=False))+"::jsonb)")
sql('GRANT CONNECT ON DATABASE '+OLD+' TO '+READER+'; GRANT USAGE ON SCHEMA public TO '+READER+'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+READER)
sql('ALTER ROLE '+READER+' IN DATABASE '+OLD+' SET default_transaction_read_only=on')
for table in ['audit_log','exam_attempts','exam_answers','bookmarks','sessions','student_report_analysis','Chat','Message_v2','Vote_v2','Document','Suggestion','Stream','exam_sets','request_limits']:
    if scalar('SELECT count(*) FROM "'+table+'"',NEW): raise RuntimeError('Phase2 history unexpectedly populated: '+table)
if scalar('SELECT count(*) FROM users',NEW)!=scalar('SELECT count(*) FROM users'): raise RuntimeError('Identity count mismatch')
if scalar("SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name IN ('token_quota','token_used','token_remaining','last_token_burn_at')",NEW): raise RuntimeError('Obsolete demo counters remain')
# Parse the existing application URL without printing or shell interpolation.
old_env=pathlib.Path('/home/ubuntu/projects/classnet-tutor/network-tutor-server/.env.docker')
settings={}
for line in old_env.read_text().splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1);settings[k.strip()]=v.strip().strip('"').strip("'")
u=urllib.parse.urlsplit(settings['DATABASE_URL'])
def url(user,pw,database):
    netloc=urllib.parse.quote(user,safe='')+':'+urllib.parse.quote(pw,safe='')+'@'+u.hostname+(':'+str(u.port) if u.port else '')
    return urllib.parse.urlunsplit((u.scheme,netloc,'/'+database,u.query,u.fragment))
runtime=ROOT/'phase2-runtime.env'
with runtime.open('x') as f:
    f.write('DATABASE_URL='+url(APP,password,NEW)+'\nPHASE1_DATABASE_URL='+url(READER,reader_password,OLD)+'\nACTIVE_SERVICE_PERIOD=2\n')
runtime.chmod(0o600)
print('Phase2 prepared separately. Live service configuration was not changed.')
print('Students:',scalar("SELECT count(*) FROM users WHERE role='student'",NEW))
print('Historical phase2 tables: all empty. Account credentials preserved. Obsolete demo counters: none.')
print('Protected runtime settings:',runtime)
