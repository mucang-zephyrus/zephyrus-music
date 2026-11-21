"""Local CI / signed Android release / server publication, without GitHub credentials."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = 'https://mucang.xyz/zephyrus/apks'
REMOTE = '/var/www/zephyrus/apks'
TEST_BASE_URL = 'https://mucang.xyz/zephyrus/webtest'
TEST_REMOTE = '/var/www/mucang/zephyrus/webtest'


def run(args, *, cwd=ROOT, capture=False, env=None):
    result = subprocess.run([str(a) for a in args], cwd=cwd, env=env,
                            text=True, encoding='utf-8', errors='replace',
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.STDOUT if capture else None)
    if result.returncode:
        # Do not dump Gradle/signing output: credentials may appear in exceptions.
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode})')
    return result.stdout or ''


def npm(*args, env=None):
    executable = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not executable:
        raise RuntimeError('Node.js 22+ and npm are required')
    run([executable, *args], env=env)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def stable_version(value):
    if not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Use a stable version such as 1.4.2')
    return tuple(map(int, value.split('.')))


def test_version(value):
    match = re.fullmatch(r'(\d+\.\d+\.\d+)-test(\d+)', value)
    if not match:
        raise ValueError('Use a test version such as 1.4.3-test1')
    return (*stable_version(match[1]), int(match[2]))


def check_test_upgrade(previous, info):
    previous_version = test_version(previous['tag_name'].removeprefix('v'))
    if test_version(info['version']) < previous_version:
        raise RuntimeError('The test version cannot go backwards')
    if info['version_code'] <= previous['version_code']:
        raise RuntimeError('The Android versionCode must increase for every test build')


def android_tools():
    portable = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'ZephyrusBuild'
    java_home = os.environ.get('JAVA_HOME')
    if not java_home:
        java = shutil.which('java')
        homes = sorted((portable / 'java').glob('jdk-21*'))
        if java:
            java_home = str(Path(java).resolve().parent.parent)
        elif homes:
            java_home = str(homes[-1])
    java = Path(java_home or '') / 'bin' / ('java.exe' if os.name == 'nt' else 'java')
    if not java.is_file():
        raise RuntimeError('JDK 21 is required; set JAVA_HOME. See docs/local-workflow.md')
    version = run([java, '-version'], capture=True)
    if not re.search(r'version "21[.\"]', version):
        raise RuntimeError('This Android build requires JDK 21')
    os.environ['JAVA_HOME'] = str(java.parent.parent)
    os.environ['PATH'] = str(java.parent) + os.pathsep + os.environ['PATH']
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    candidates = [Path(sdk)] if sdk else [portable / 'android-sdk',
        Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Android' / 'Sdk',
        Path.home() / 'Android' / 'Sdk']
    sdk_path = next((p for p in candidates if (p / 'platforms/android-36/android.jar').is_file()), None)
    if not sdk_path:
        raise RuntimeError('Android SDK platform 36 is required; set ANDROID_HOME')
    tools = sdk_path / 'build-tools' / '36.0.0'
    apksigner = tools / ('apksigner.bat' if os.name == 'nt' else 'apksigner')
    aapt = tools / ('aapt.exe' if os.name == 'nt' else 'aapt')
    if not apksigner.is_file() or not aapt.is_file():
        raise RuntimeError('Install Android SDK build-tools;36.0.0')
    os.environ['ANDROID_HOME'] = str(sdk_path)
    return sdk_path, apksigner, aapt


def apk_info(apk, tools, *, test=False):
    _, apksigner, aapt = tools
    signed = run([apksigner, 'verify', '--verbose', '--print-certs', apk], capture=True)
    certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)', signed)
    if len(certs) != 1:
        raise RuntimeError('Expected one verified APK signer')
    badging = run([aapt, 'dump', 'badging', apk], capture=True)
    match = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    if not match or match[1] != 'com.zephyrus.player':
        raise RuntimeError('Wrong Android application ID')
    (test_version if test else stable_version)(match[3])
    return {'version': match[3], 'version_code': int(match[2]),
            'certificate_sha256': certs[0].lower(), 'sha256': sha256(apk)}


def check_upgrade(previous, candidate):
    if previous['certificate_sha256'] != candidate['certificate_sha256']:
        raise RuntimeError('Signing certificate differs from the published APK; publication refused')
    if candidate['version_code'] <= previous['version_code']:
        raise RuntimeError('versionCode must increase; publication refused')
    if stable_version(candidate['version']) <= stable_version(previous['version']):
        raise RuntimeError('Version must increase so installed clients can detect the update')


def manifest_for(apk, info, notes, *, test=False):
    return {
        'tag_name': 'v' + info['version'], 'version_code': info['version_code'],
        'certificate_sha256': info['certificate_sha256'],
        'body': notes, 'published_at': datetime.now(timezone.utc).isoformat(),
        'html_url': TEST_BASE_URL + '/' if test else 'https://mucang.xyz/zephyrus/',
        'assets': [{'name': apk.name, 'browser_download_url': (TEST_BASE_URL if test else BASE_URL) + '/' + apk.name,
                    'size': apk.stat().st_size, 'sha256': info['sha256']}]
    }


def build_apk(args):
    tools = android_tools()
    test = args.test_version is not None
    version = args.test_version if test else json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    (test_version if test else stable_version)(version)
    env = os.environ.copy()
    env.pop('ZEPHYRUS_TEST_VERSION', None)
    env.pop('ZEPHYRUS_TEST_VERSION_CODE', None)
    env['ZEPHYRUS_RELEASE_CHANNEL'] = 'test' if test else 'stable'
    if test:
        env['ZEPHYRUS_TEST_VERSION'] = version
        env['ZEPHYRUS_TEST_VERSION_CODE'] = str(args.version_code)
    if args.install:
        npm('ci')
    # Only the ignored machine-specific SDK path is updated; preserve other local properties.
    local = ROOT / 'android/local.properties'
    lines = local.read_text(encoding='utf-8').splitlines() if local.exists() else []
    lines = [line for line in lines if not line.startswith('sdk.dir=')]
    local.write_text('\n'.join(lines + ['sdk.dir=' + tools[0].as_posix()]) + '\n', encoding='utf-8')
    gradle = ROOT / 'android' / ('gradlew.bat' if os.name == 'nt' else 'gradlew')
    gradle_command = [gradle] if os.name == 'nt' else ['sh', gradle]
    # Verify credentials before spending time building; never emit an unsigned release.
    run([*gradle_command, 'verifyReleaseSigning', '--no-daemon'], cwd=ROOT / 'android')
    npm('run', 'test:lyrics')
    npm('run', 'test:workflow')
    npm('run', 'build', env=env)
    run([ROOT / 'node_modules/.bin' / ('cap.cmd' if os.name == 'nt' else 'cap'), 'sync', 'android'])
    run([*gradle_command, 'assembleRelease', '--no-daemon',
         f'-PtestVersionCode={args.version_code}', f'-PtestVersionName={version}'], cwd=ROOT / 'android')
    apk = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
    info = apk_info(apk, tools, test=test)
    if info['version'] != version or info['version_code'] != args.version_code:
        raise RuntimeError('APK version differs from the requested version')
    output = ROOT / 'dist/releases' / f'{version}-{args.version_code}'
    output.mkdir(parents=True, exist_ok=True)
    name = f'zephyrus-player-v{version}-{args.version_code}.apk'
    dest = output / name
    shutil.copy2(apk, dest)
    notes = (ROOT / args.notes).read_text(encoding='utf-8-sig') if args.notes else (
        '此版本可能不稳定。' if test else (ROOT / 'RELEASE_NOTES.md').read_text(encoding='utf-8-sig')
    )
    manifest = manifest_for(dest, info, notes, test=test)
    (output / 'latest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Verified signed release: {dest}')
    command = 'npm run workflow -- webtest' if test else 'npm run release:publish --'
    print(f'Build complete. Publish separately with: {command} "{output}"')


def publish(args):
    import paramiko  # Only publication requires this dependency.
    directory = Path(args.directory).resolve()
    release = json.loads((directory / 'latest.json').read_text(encoding='utf-8'))
    asset = release['assets'][0]
    if not re.fullmatch(r'zephyrus-player-v\d+\.\d+\.\d+-\d+\.apk', asset['name']):
        raise RuntimeError('Invalid artifact filename')
    apk = directory / asset['name']
    tools = android_tools()
    info = apk_info(apk, tools)
    expected = manifest_for(apk, info, release['body'])
    for field in ('tag_name', 'version_code', 'certificate_sha256', 'assets'):
        if release[field] != expected[field]:
            raise RuntimeError(f'Artifact does not match manifest: {field}')
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    # Match the existing deployment environment; pinned known_hosts is recommended in the guide.
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(os.environ.get('ZEPHYRUS_SSH_HOST', 'mucang.xyz'),
                username=os.environ.get('ZEPHYRUS_SSH_USER', 'root'),
                password=os.environ.get('ZEPHYRUS_SSH_PASSWORD'),
                look_for_keys=not bool(os.environ.get('ZEPHYRUS_SSH_PASSWORD')),
                allow_agent=not bool(os.environ.get('ZEPHYRUS_SSH_PASSWORD')), timeout=20)
    sftp = ssh.open_sftp()
    lock = REMOTE + '/.publish-lock'
    staging = REMOTE + '/.incoming-' + uuid.uuid4().hex
    locked = False
    try:
        sftp.mkdir(lock)
        locked = True
        with tempfile.TemporaryDirectory() as temp:
            previous = Path(temp) / 'previous.apk'
            sftp.get(REMOTE + '/zephyrus-player-latest.apk', str(previous))
            check_upgrade(apk_info(previous, tools), info)
        try:
            with sftp.open(TEST_REMOTE + '/latest.json') as source:
                latest_test = json.load(source)
        except FileNotFoundError:
            latest_test = None
        if latest_test and info['version_code'] <= latest_test['version_code']:
            raise RuntimeError('versionCode must also exceed the published test APK versionCode')
        if args.dry_run:
            print('Publication preflight passed: signature, version, manifest and server access')
            return
        sftp.mkdir(staging)
        sftp.put(str(apk), staging + '/release.apk.part')
        with sftp.open(staging + '/latest.json.part', 'w') as target:
            target.write(json.dumps(expected, ensure_ascii=False).encode('utf-8'))
        # Check uploaded bytes before replacing either public pointer. Immutable APK first,
        # compatible latest symlink second, manifest last; partial uploads never become visible.
        command = 'python3 - ' + shlex.quote(staging)
        stdin, stdout, stderr = ssh.exec_command(command, timeout=120)
        stdin.write("""import hashlib,json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]); base=p.parent
m=json.loads((p/'latest.json.part').read_text(encoding='utf-8')); asset=m['assets'][0]
src=p/'release.apk.part'; dest=base/asset['name']
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''): h.update(chunk)
 return h.hexdigest()
assert digest(src)==asset['sha256'], 'Upload checksum mismatch'
assert not dest.exists() or digest(dest)==asset['sha256'], 'Immutable artifact already exists'
src.chmod(0o644); os.replace(src,dest)
link=p/'latest.apk'; link.symlink_to(dest.name); os.replace(link,base/'zephyrus-player-latest.apk')
(p/'latest.json.part').chmod(0o644); os.replace(p/'latest.json.part',base/'latest.json')
print('Published '+asset['name'])
""")
        stdin.channel.shutdown_write()
        output = stdout.read().decode()
        error = stderr.read().decode()
        if stdout.channel.recv_exit_status():
            raise RuntimeError('Server publication failed: ' + error)
        print(output.strip())
        _, stdout, _ = ssh.exec_command('curl --fail --silent --show-error --max-time 20 ' +
                                       shlex.quote(BASE_URL + '/latest.json'))
        served = json.loads(stdout.read().decode())
        if stdout.channel.recv_exit_status() or served != expected:
            raise RuntimeError('Published files need inspection: HTTPS manifest verification failed')
        print('HTTPS release manifest verified')
    finally:
        for name in ('release.apk.part', 'latest.json.part', 'latest.apk'):
            try:
                sftp.remove(staging + '/' + name)
            except OSError:
                pass
        try:
            sftp.rmdir(staging)
        except OSError:
            pass
        if locked:
            sftp.rmdir(lock)
        sftp.close()
        ssh.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('check', 'web', 'apk'):
        item = sub.add_parser(action)
        item.add_argument('--install', action='store_true', help='Run npm ci first')
        if action == 'web':
            item.add_argument('--deploy', action='store_true')
        if action == 'apk':
            item.add_argument('--version-code', required=True, type=int)
            item.add_argument('--notes')
            item.add_argument('--test-version')
    item = sub.add_parser('webtest')
    item.add_argument('directory')
    sub.add_parser('doctor')
    sub.add_parser('test')
    item = sub.add_parser('publish')
    item.add_argument('directory')
    item.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    os.chdir(ROOT)
    os.environ['VITE_DISABLE_GZIP'] = '1'
    if args.action == 'test':
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/workflow', '-p', 'test_*.py', '-v'])
    elif args.action == 'doctor':
        tools = android_tools()
        print('Android toolchain ready:', tools[0])
    elif args.action == 'apk':
        if not 0 < args.version_code <= 2100000000:
            parser.error('version-code must be between 1 and 2100000000')
        build_apk(args)
    elif args.action == 'publish':
        publish(args)
    elif args.action == 'webtest':
        run([sys.executable, ROOT / 'deploy_web.py', '--test-release', args.directory])
    else:
        if args.install:
            npm('ci')
        npm('run', 'test:lyrics')
        npm('run', 'test:workflow')
        npm('run', 'build:web' if args.action == 'web' else 'build',
            env={**os.environ, 'ZEPHYRUS_RELEASE_CHANNEL': 'stable'})
        if args.action == 'web' and args.deploy:
            run([sys.executable, ROOT / 'deploy_web.py'])


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, KeyError) as error:
        print(f'Workflow failed: {error}', file=sys.stderr)
        sys.exit(1)
