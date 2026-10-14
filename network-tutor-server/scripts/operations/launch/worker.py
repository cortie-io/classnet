#!/usr/bin/env python3
"""Host-only, one-way phase2 launch. No Docker socket or backup credentials enter the app.
The web request only records a request. This worker stops every application writer,
validates a full phase2 backup, resets learning data atomically, then reopens service.
"""
import fcntl,json,os,pathlib,subprocess,sys,uuid
BASE=pathlib.Path('/var/lib/classnet-launch')
BACKUPS=pathlib.Path('/var/backups/classnet-phase2-beta')
COMPOSE='/home/ubuntu/projects/classnet-tutor/docker-compose.yml'
CLIENT='postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'
SERVICES=['network-tutor-server','network-tutor-web']
KNOWN={'users','concept_nodes','lookup_tables','node_embeddings','concept_embeddings','exam_questions','exam_sets','app_settings','service_launch','audit_log','answer_cache','exam_answers','exam_proctor_events','exam_attempts','student_report_analysis','bookmarks','Vote_v2','Message_v2','Stream','Chat','Suggestion','Document','sessions','request_limits'}

def run(args,**kw):
    return subprocess.run(args,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,**kw).stdout.strip()
def pg_args():
    return ['docker','run','--rm','-i','--env-file',str(BASE/'pg.env'),'-v',str(BASE/'rds-ca.pem')+':/cert.pem:ro']
def sql(query):
    guard="DO $$ BEGIN IF current_database()<>'network_tutor_phase2' THEN RAISE EXCEPTION 'Wrong database'; END IF; END $$;\n"
    return run(pg_args()+[CLIENT,'psql','-XqAt','-v','ON_ERROR_STOP=1'],input=guard+query)
def state():
    return json.loads(sql("SELECT row_to_json(s) FROM service_launch s WHERE id=1"))
def compose(*args):
    return run(['docker','compose','-p','classnet','-f',COMPOSE,*args])
def verify_inventory():
    actual=set(json.loads(sql("SELECT coalesce(json_agg(tablename),'[]') FROM pg_tables WHERE schemaname='public'")))
    if actual-KNOWN:raise RuntimeError('Unreviewed schema: review reset policy before launching')
def make_backup(request_id):
    target='phase2-beta-'+str(uuid.UUID(request_id))+'.dump'
    run(pg_args()+['-v',str(BACKUPS)+':/backup',CLIENT,'pg_dump','--schema=public','--format=custom','--no-owner','--no-acl','--file=/backup/'+target])
    path=BACKUPS/target
    if not path.is_file() or path.stat().st_size<100:raise RuntimeError('Backup missing or empty')
    path.chmod(0o600)
    run(pg_args()+['-v',str(BACKUPS)+':/backup:ro',CLIENT,'pg_restore','--list','/backup/'+target])
    return target

def transition():
    current=state()
    pending=BASE/'pending.json'
    # Durable restart intent covers a host crash after a committed reset. Never reset twice.
    if current['stage']=='official':
        if pending.exists():
            compose('up','-d','--no-build',*SERVICES)
            pending.unlink()
        return
    if current['stage']!='starting':return
    request_id=str(uuid.UUID(current['request_id']))
    if pending.exists() and json.loads(pending.read_text())['request_id']!=request_id:
        raise RuntimeError('Unexpected pending launch')
    stopped=False
    try:
        verify_inventory()
        pending.write_text(json.dumps({'request_id':request_id}));pending.chmod(0o600)
        # Stop both writers before backup/reset. Killed AI streams cannot write back afterwards.
        compose('stop','--timeout','10','network-tutor-web','network-tutor-server');stopped=True
        target=make_backup(request_id)
        set_context="SELECT set_config('classnet.launch_request','"+request_id+"',false); SELECT set_config('classnet.launch_backup','"+target+"',false);\n"
        sql(set_context+(BASE/'reset.sql').read_text())
        if state()['stage']!='official':raise RuntimeError('Launch did not commit')
        compose('up','-d','--no-build',*SERVICES)
        pending.unlink()
        print('Phase2 official launch committed; protected beta backup:',target)
    except Exception:
        # Query state after any ambiguous result. A committed launch must NEVER return to beta.
        latest=state()
        if latest['stage']=='starting':
            sql("UPDATE service_launch SET stage='beta',last_error='정식 전환을 완료하지 못했습니다. 사전 운영 기록을 유지했습니다. 관리자에게 서버 상태 확인을 요청해 주세요.' WHERE id=1 AND stage='starting' AND request_id='"+request_id+"'")
        if stopped or pending.exists():compose('up','-d','--no-build',*SERVICES)
        if pending.exists():pending.unlink()
        raise

def main():
    settings=dict(line.split('=',1) for line in (BASE/'pg.env').read_text().splitlines() if '=' in line)
    if settings.get('PGDATABASE')!='network_tutor_phase2':raise RuntimeError('Phase1 must never be a launch target')
    with (BASE/'worker.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if '--check' in sys.argv:
            verify_inventory()
            print('Launch worker ready; phase2 state:',state()['stage'])
        else:transition()
if __name__=='__main__':
    try:main()
    except BlockingIOError:pass
    except Exception as error:
        # Never print subprocess env, credentials, SQL result rows or student information.
        print('Official-launch worker failed:',type(error).__name__,file=sys.stderr)
        sys.exit(1)
