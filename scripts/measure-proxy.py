#!/usr/bin/env python3
"""Measure real HTTPS requests through an existing local proxy; never switch routes."""
import argparse
import datetime
import json
import math
from pathlib import Path
import statistics
import subprocess
import tempfile
from urllib.parse import urlparse

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--proxy',default='http://127.0.0.1:18998')
p.add_argument('--rounds',type=int,default=5)
p.add_argument('--expected-ip',help='Optional expected IPv4 egress; mismatch is a failed sample')
p.add_argument('--output',type=Path)
a=p.parse_args();proxy=urlparse(a.proxy)
if proxy.scheme not in ['http','socks5h'] or proxy.hostname not in ['127.0.0.1','localhost','::1'] or proxy.username or proxy.password:
    p.error('Use a local proxy without credentials in its URL')
if not 1<=a.rounds<=30:p.error('Choose 1 to 30 rounds')
targets=[('egress','https://ipv4.webshare.io/',[200]),('github','https://raw.githubusercontent.com/xykt/IPQuality/main/ip.sh',[200]),('anthropic','https://api.anthropic.com/v1/models',[401]),('openai','https://api.openai.com/v1/models',[401])]
samples=[]
with tempfile.TemporaryDirectory() as directory:
    body=Path(directory)/'body';body.touch(mode=0o600)
    for round_number in range(1,a.rounds+1):
        for name,url,expected in targets:
            result=subprocess.run(['curl','-4','-sS','--proxy',a.proxy,'--noproxy','','--connect-timeout','8','--max-time','20','-o',str(body),'-w','%{http_code} %{time_connect} %{time_appconnect} %{time_total}',url],capture_output=True,text=True)
            parts=result.stdout.split();status=int(parts[0]) if len(parts)==4 and parts[0].isdigit() else 0
            times=[float(x) for x in parts[1:]] if len(parts)==4 else [None,None,None]
            ip=body.read_text().strip() if name=='egress' and result.returncode==0 and status==200 else None
            ok=result.returncode==0 and status in expected and (not a.expected_ip or name!='egress' or ip==a.expected_ip)
            sample={'round':round_number,'target':name,'status':status,'curl_exit':result.returncode,'connect_s':times[0],'tls_s':times[1],'total_s':times[2],'ok':ok}
            if name=='egress':sample['egress']=ip
            samples.append(sample);print(f'{round_number}/{a.rounds} {name}: HTTP {status}, total {times[2]}s, '+('pass' if ok else 'failed'),flush=True)
summary={}
for name,_,_ in targets:
    group=[s for s in samples if s['target']==name];durations=sorted(s['total_s'] for s in group if s['ok'])
    summary[name]={'samples':len(group),'passed':sum(s['ok'] for s in group),'timeouts':sum(s['curl_exit']==28 for s in group),'failed':sum(not s['ok'] for s in group),'median_s':statistics.median(durations) if durations else None,'p95_s':durations[math.ceil(.95*len(durations))-1] if durations else None}
report={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'proxy':a.proxy,'samples':samples,'summary':summary,'note':'AI HTTP 401 verifies network reachability only, not authenticated login or generation. Small samples do not establish long-term stability.'}
output=a.output or Path('data/vps-measurements')/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.json');output.parent.mkdir(parents=True,exist_ok=True,mode=0o700);output.write_text(json.dumps(report,ensure_ascii=False,indent=2));output.chmod(0o600)
print('Report saved:',output)
for name,values in summary.items():print(name,json.dumps(values))
raise SystemExit(0 if all(s['ok'] for s in samples) else 1)
