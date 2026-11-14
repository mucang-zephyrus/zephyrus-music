"""Publish the isolated alternate gateway or its homepage announcement via SSH."""
import argparse
import json
import os
from pathlib import Path
import shlex
import time

import paramiko

ROOT = Path(__file__).resolve().parent
RELEASE = "/opt/zephyrus-netease-enhanced-release-20261112"


def run(ssh, command, timeout=180):
    _, out, err = ssh.exec_command(command, timeout=timeout)
    for line in out:
        print(line.rstrip(), flush=True)
    errors = err.read().decode()
    if errors.strip():
        print(errors.strip(), flush=True)
    if out.channel.recv_exit_status():
        raise RuntimeError("Remote operation failed")


def upload_gateway(ssh):
    source = ROOT / "server" / "netease-enhanced"
    run(ssh, "mkdir -p " + shlex.quote(RELEASE))
    with ssh.open_sftp() as sftp:
        for name in ["package.json", "package-lock.json", "server.cjs", "zephyrus-netease-enhanced.service", "nginx-location.conf"]:
            sftp.put(str(source / name), RELEASE + "/" + name)
    run(ssh, "cd " + shlex.quote(RELEASE) + " && npm ci --omit=dev --ignore-scripts --no-audit --no-fund")
    activate = r'''
import json,os,pathlib,shutil,subprocess,time,urllib.request
release=pathlib.Path('/opt/zephyrus-netease-enhanced-release-20261112')
stable=pathlib.Path('/opt/zephyrus-netease-enhanced')
nginx=pathlib.Path('/etc/nginx/sites-enabled/mucang').resolve()
stamp=time.strftime('%Y%m%d-%H%M%S')
backup=pathlib.Path('/opt/zephyrus-deploy-backups')/stamp
backup.mkdir(parents=True)
old=nginx.read_text()
shutil.copy2(nginx,backup/'nginx-mucang.conf')
unit=pathlib.Path('/etc/systemd/system/zephyrus-netease-enhanced.service')
if unit.exists():shutil.copy2(unit,backup/unit.name)
if stable.exists() and not stable.is_symlink():raise RuntimeError('Stable release path is not a symlink')
previous=os.readlink(stable) if stable.is_symlink() else None
if stable.is_symlink():stable.unlink()
stable.symlink_to(release,target_is_directory=True)
shutil.copy2(release/unit.name,unit)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','zephyrus-netease-enhanced'],check=True)
try:
 subprocess.run(['systemctl','restart','zephyrus-netease-enhanced'],check=True)
 for _ in range(45):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3051/health',timeout=2) as response:health=json.load(response)
   if health.get('backend')=='enhanced':break
  except OSError:time.sleep(1)
 else:raise RuntimeError('Alternate gateway readiness failed')
 print(json.dumps({'gateway':health}),flush=True)
 if 'location ^~ /zephyrus/api/netease-enhanced/' not in old:
  anchor='    location /zephyrus/api/ {'
  if old.count(anchor)!=1:raise RuntimeError('Nginx location anchor was not unique')
  block=(release/'nginx-location.conf').read_text()
  nginx.write_text(old.replace(anchor,block+'\n'+anchor,1))
 test=subprocess.run(['nginx','-t'],capture_output=True,text=True)
 if test.returncode:raise RuntimeError('Nginx validation failed')
 subprocess.run(['systemctl','reload','nginx'],check=True)
 print('Alternate gateway activated; previous music gateway was not restarted.',flush=True)
 print('Backup: '+str(backup),flush=True)
except Exception:
 nginx.write_text(old)
 subprocess.run(['systemctl','reload','nginx'],check=False)
 subprocess.run(['systemctl','stop','zephyrus-netease-enhanced'],check=False)
 if stable.is_symlink():stable.unlink()
 if previous:stable.symlink_to(previous,target_is_directory=True)
 if (backup/unit.name).exists():shutil.copy2(backup/unit.name,unit)
 else:unit.unlink(missing_ok=True)
 subprocess.run(['systemctl','daemon-reload'],check=False)
 if previous:subprocess.run(['systemctl','restart','zephyrus-netease-enhanced'],check=False)
 else:subprocess.run(['systemctl','disable','zephyrus-netease-enhanced'],check=False)
 raise
'''
    run(ssh, "python3 -c " + shlex.quote(activate))
    run(ssh, "curl --fail --silent --show-error --max-time 20 https://www.mucang.xyz/zephyrus/api/netease-enhanced/health")


def publish_announcement(ssh):
    new = json.loads((ROOT / "server" / "announcements.json").read_text(encoding="utf-8"))[0]
    remote = "/var/www/mucang/server-music/announcements.json"
    with ssh.open_sftp() as sftp:
        with sftp.open(remote, "r") as file:
            previous_bytes = file.read()
        previous = json.loads(previous_bytes)
        merged = [new] + [item for item in previous if item.get("id") != new["id"]]
        backup = remote + ".backup-" + time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        with sftp.open(backup, "wb") as file:
            file.write(previous_bytes)
        with sftp.open(remote + ".next", "wb") as file:
            file.write((json.dumps(merged, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        sftp.chmod(remote + ".next", 0o644)
        sftp.posix_rename(remote + ".next", remote)
    verify = r'''
import json,urllib.request
with urllib.request.urlopen('https://www.mucang.xyz/server-music/announcements.json?t=20261112',timeout=20) as r:
 data=json.load(r)
 assert data[0]['id']=='announce-20261112-netease-api'
 print(json.dumps({'announcement':data[0]['id'],'http':r.status,'retained':len(data)-1}))
'''
    run(ssh, "python3 -c " + shlex.quote(verify))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["gateway", "announcement"])
    action = parser.parse_args().action
    password = os.environ.get("ZEPHYRUS_SSH_PASSWORD")
    if not password:
        raise SystemExit("Set ZEPHYRUS_SSH_PASSWORD before publishing")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(os.environ.get("ZEPHYRUS_SSH_HOST", "mucang.xyz"), username="root", password=password,
                timeout=15, look_for_keys=False, allow_agent=False)
    try:
        (upload_gateway if action == "gateway" else publish_announcement)(ssh)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
