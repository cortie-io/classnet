import importlib.util,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('launch_worker',pathlib.Path(__file__).with_name('worker.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
REQUEST='00000000-0000-0000-0000-000000000001'
class LaunchTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.base=pathlib.Path(self.temp.name);(self.base/'reset.sql').write_text('RESET_MARKER');self.events=[];self.stage='starting'
 def state(self):return {'stage':self.stage,'request_id':REQUEST}
 def compose(self,*args):self.events.append(('compose',args))
 def sql(self,q):
  self.events.append(('sql',q))
  if 'RESET_MARKER' in q:self.stage='official'
 def execute(self,backup):
  with patch.object(m,'BASE',self.base),patch.object(m,'state',self.state),patch.object(m,'verify_inventory',lambda:self.events.append(('inventory',))),patch.object(m,'compose',self.compose),patch.object(m,'make_backup',backup),patch.object(m,'sql',self.sql):m.transition()
 def test_backup_must_succeed_before_any_reset(self):
  def fail(_):self.events.append(('backup_failed',));raise RuntimeError('no backup')
  with self.assertRaises(RuntimeError):self.execute(fail)
  self.assertFalse(any(x[0]=='sql' and 'RESET_MARKER' in x[1] for x in self.events));self.assertIn(('compose',('up','-d','--no-build',*m.SERVICES)),self.events)
 def test_stop_all_writers_then_backup_then_atomic_reset(self):
  def backup(_):self.events.append(('backup',));return 'verified.dump'
  self.execute(backup)
  stop=next(i for i,e in enumerate(self.events) if e[0]=='compose' and e[1][0]=='stop');b=self.events.index(('backup',));reset=next(i for i,e in enumerate(self.events) if e[0]=='sql' and 'RESET_MARKER' in e[1]);self.assertLess(stop,b);self.assertLess(b,reset);self.assertEqual(self.stage,'official');self.assertFalse((self.base/'pending.json').exists())
 def test_crash_after_commit_only_restarts_never_resets(self):
  self.stage='official';(self.base/'pending.json').write_text('{}')
  self.execute(lambda _:self.fail('Must never backup or reset again'));self.assertEqual(self.events,[('compose',('up','-d','--no-build',*m.SERVICES))])
 def test_official_without_pending_is_noop(self):
  self.stage='official';self.execute(lambda _:self.fail('Must never reset'));self.assertEqual(self.events,[])
if __name__=='__main__':unittest.main()
