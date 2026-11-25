"""Publish only the test-site QQ and Kugou gateway."""
from pathlib import Path
import shlex
from uuid import uuid4

import paramiko

from deploy_web import PASSWORD, PORT, SERVER, USER, ssh_exec, upload_file

ROOT = Path(__file__).resolve().parent
BASE = '/opt/zephyrus-platform-webtest'
FILES = ('server-platform-login.js', 'server-qq-api.js', 'server-kugou-api.js',
         'server-listen-together.js', 'server-bilibili.js', 'server-share-link.js')
CONFIG = ('platform-gateway.service', 'platform-gateway-location.conf', 'activate-platform-gateway.sh')


def main():
    if not PASSWORD:
        raise SystemExit('Set ZEPHYRUS_SSH_PASSWORD before deploying the test gateway')
    release = f'{BASE}/release-{uuid4().hex}'
    with paramiko.SSHClient() as ssh:
        ssh.load_system_host_keys()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(SERVER, port=PORT, username=USER, password=PASSWORD, timeout=15,
                    look_for_keys=False, allow_agent=False)
        ssh_exec(ssh, f'mkdir -p {BASE} && mkdir {release}')
        with ssh.open_sftp() as sftp:
            for file in FILES + CONFIG:
                source = ROOT / (file if file in FILES else f'server/webtest/{file}')
                upload_file(sftp, source, f'{release}/{file}')
        ssh_exec(ssh, f'cd {release} && ln -s /opt/netease-api/node_modules node_modules && '
                 'for file in server-*.js; do node --check "$file" || exit; done')
        command = f'flock -w 10 {BASE}/deploy.lock bash {release}/{CONFIG[-1]} {release}'
        # Normalize CRLF in checked-out shell scripts before running them on Linux.
        ssh_exec(ssh, f"sed -i 's/\\r$//' {shlex.quote(release + '/' + CONFIG[-1])} && {command}")
    print(f'Deployed test platform gateway: {release}')


if __name__ == '__main__':
    main()
