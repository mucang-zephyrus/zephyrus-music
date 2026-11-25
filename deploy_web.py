"""Deploy Zephyrus Player web build to mucang.xyz via SSH using paramiko."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import uuid

import paramiko

from scripts.workflow import (REMOTE as APK_REMOTE, TEST_REMOTE, android_tools, apk_info,
                              check_test_upgrade, manifest_for, stable_version, test_version)

SERVER = os.environ.get("ZEPHYRUS_SSH_HOST", "mucang.xyz")
PORT = 22
USER = "root"
PASSWORD = os.environ.get("ZEPHYRUS_SSH_PASSWORD")
# 默认取仓库内 vite 产物（root=src/renderer，默认 outDir 为其下 dist），可用
# ZEPHYRUS_WEB_DIST 覆盖；不再硬编码旧机器的桌面绝对路径
DEFAULT_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "renderer", "dist")
LOCAL_DIST = os.environ.get("ZEPHYRUS_WEB_DIST", DEFAULT_DIST)
REMOTE_BASE = "/var/www/mucang/zephyrus/web"


def ssh_exec(ssh, cmd):
    _, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(err.strip() or f'Remote command failed: {cmd}')
    return out.strip()


def upload_file(sftp, local, remote, verify=None):
    temporary = f'{remote}.{uuid.uuid4().hex}.part'
    try:
        sftp.put(str(local), temporary)
        sftp.chmod(temporary, 0o644)
        if verify is not None:
            verify(temporary)
        sftp.posix_rename(temporary, remote)
    finally:
        try:
            sftp.remove(temporary)
        except FileNotFoundError:
            pass


def upload_dir(sftp, local, remote):
    """Recursively upload a directory via SFTP, skipping precompressed .gz
    duplicates and files already present with the same size (resumable).

    The caller switches the entry point after all assets are ready."""
    for item in os.listdir(local):
        if item.endswith(".gz") or item in {"index.html", "build-version.json"}:
            continue
        local_path = os.path.join(local, item)
        remote_path = f"{remote}/{item}"
        if os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                sftp.mkdir(remote_path)
            upload_dir(sftp, local_path, remote_path)
        else:
            local_size = os.path.getsize(local_path)
            try:
                if sftp.stat(remote_path).st_size == local_size:
                    continue
            except FileNotFoundError:
                pass
            upload_file(sftp, local_path, remote_path)
            print(f"  uploaded: {item}")


def load_test_release(directory, version, version_code):
    manifest_path = directory / 'latest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if not isinstance(version_code, int) or version_code <= 0:
        raise RuntimeError('Build the test Web and APK together with a versionCode')
    apk = directory / f'zephyrus-player-v{version}-{version_code}.apk'
    info = apk_info(apk, android_tools(), test=True)
    expected = manifest_for(apk, info, manifest['body'], test=True)
    if (info['version'], info['version_code']) != (version, version_code) or any(
        manifest[field] != expected[field]
        for field in ('tag_name', 'version_code', 'certificate_sha256', 'assets')
    ):
        raise RuntimeError('The test Web build and signed APK must belong to the same release')
    return manifest_path, apk, info


def deploy_test(ssh, sftp, dist, version, manifest, apk, info):
    lock = APK_REMOTE + '/.publish-lock'
    sftp.mkdir(lock)
    try:
        with sftp.open(APK_REMOTE + '/latest.json') as source:
            stable = json.load(source)
        if stable['certificate_sha256'] != info['certificate_sha256']:
            raise RuntimeError('Test APK must use the published release signing certificate')
        if info['version_code'] <= stable['version_code']:
            raise RuntimeError('Test APK versionCode must exceed the published stable versionCode')
        try:
            with sftp.open(TEST_REMOTE + '/latest.json') as source:
                previous = json.load(source)
        except FileNotFoundError:
            previous = None
        if previous:
            check_test_upgrade(previous, info)
        ssh_exec(ssh, f'mkdir -p {TEST_REMOTE}')
        apk_remote = f'{TEST_REMOTE}/{apk.name}'

        def verify(path):
            digest = ssh_exec(ssh, f'sha256sum -- {shlex.quote(path)}').split()[0]
            if digest != info['sha256']:
                raise RuntimeError('Uploaded APK hash differs from the signed build')

        try:
            sftp.stat(apk_remote)
        except FileNotFoundError:
            upload_file(sftp, apk, apk_remote, verify)
        else:
            verify(apk_remote)
        upload_dir(sftp, dist, TEST_REMOTE)
        upload_file(sftp, dist / 'build-version.json', f'{TEST_REMOTE}/build-version.json')
        upload_file(sftp, dist / 'index.html', f'{TEST_REMOTE}/index.html')
        upload_file(sftp, manifest, f'{TEST_REMOTE}/latest.json')
    finally:
        sftp.rmdir(lock)


def deploy_test_web(ssh, sftp, dist, build):
    lock = APK_REMOTE + '/.publish-lock'
    sftp.mkdir(lock)
    try:
        with sftp.open(TEST_REMOTE + '/latest.json') as source:
            manifest = json.load(source)
        if (manifest['tag_name'], manifest['version_code']) != (
            f"v{build['version']}", build.get('versionCode')
        ):
            raise RuntimeError('Build the Web with the version and versionCode of the published test APK')
        upload_dir(sftp, dist, TEST_REMOTE)
        upload_file(sftp, dist / 'build-version.json', f'{TEST_REMOTE}/build-version.json')
        upload_file(sftp, dist / 'index.html', f'{TEST_REMOTE}/index.html')
        served = ssh_exec(ssh, 'curl -fsS --max-time 30 https://mucang.xyz/zephyrus/webtest/index.html | sha256sum')
        if served.split()[0] != hashlib.sha256((dist / 'index.html').read_bytes()).hexdigest():
            raise RuntimeError('Published test Web entry point could not be verified')
    finally:
        sftp.rmdir(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--test-release', type=Path, help='Directory containing the signed test APK and latest.json')
    modes.add_argument('--test-web', action='store_true', help='Publish Web only, keeping the current test APK')
    args = parser.parse_args()
    dist = Path(LOCAL_DIST)
    build = json.loads((dist / 'build-version.json').read_text(encoding='utf-8'))
    version = build['version']
    if args.test_release:
        test_version(version)
        release = load_test_release(args.test_release, version, build.get('versionCode'))
    elif args.test_web:
        test_version(version)
    else:
        stable_version(version)
    if not PASSWORD:
        raise SystemExit('Set ZEPHYRUS_SSH_PASSWORD before deploying web build')

    with paramiko.SSHClient() as ssh:
        ssh.load_system_host_keys()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(SERVER, port=PORT, username=USER, password=PASSWORD, timeout=15,
                    look_for_keys=False, allow_agent=False)
        with ssh.open_sftp() as sftp:
            if args.test_release:
                deploy_test(ssh, sftp, dist, version, *release)
                url = 'https://mucang.xyz/zephyrus/webtest/'
            elif args.test_web:
                deploy_test_web(ssh, sftp, dist, build)
                url = 'https://mucang.xyz/zephyrus/webtest/'
            else:
                ssh_exec(ssh, f'mkdir -p {REMOTE_BASE}')
                upload_dir(sftp, dist, REMOTE_BASE)
                upload_file(sftp, dist / 'build-version.json', f'{REMOTE_BASE}/build-version.json')
                upload_file(sftp, dist / 'index.html', f'{REMOTE_BASE}/index.html')
                url = 'https://mucang.xyz/zephyrus/web/'
        served = json.loads(ssh_exec(ssh, f'curl -fsS {url}build-version.json'))
        if served != build:
            raise RuntimeError('Published Web version could not be verified')
    print(f'Deployed {version}: {url}')


if __name__ == '__main__':
    main()
