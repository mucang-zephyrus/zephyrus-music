"""Deploy Zephyrus Player web build to mucang.xyz via SSH using paramiko."""
import os
import paramiko

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
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(f"  [{cmd}] -> {out.strip()}")
    if err.strip():
        print(f"  [{cmd}] ERR: {err.strip()}")


def upload_dir(sftp, local, remote):
    """Recursively upload a directory via SFTP, skipping precompressed .gz
    duplicates and files already present with the same size (resumable).

    index.html 永远强制上传：SPA 入口只含资源 hash 文件名，hash 变化时
    文件大小可能完全相同，按 size 跳过会让服务器停留在旧构建。"""
    for item in os.listdir(local):
        if item.endswith(".gz"):
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
            if item != "index.html":
                try:
                    if sftp.stat(remote_path).st_size == local_size:
                        continue
                except FileNotFoundError:
                    pass
            sftp.put(local_path, remote_path)
            print(f"  uploaded: {item}")


def main():
    if not PASSWORD:
        raise SystemExit("Set ZEPHYRUS_SSH_PASSWORD before deploying web build")
    print(f"Connecting to {SERVER}:{PORT}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    # 只走密码认证：默认会扫描 ~/.ssh 的私钥（沙箱/无密钥环境会被拦或误用别的身份）
    ssh.connect(
        SERVER,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=15,
        look_for_keys=False,
        allow_agent=False,
    )
    print("Connected!")

    print("Creating remote directory...")
    ssh_exec(ssh, f"mkdir -p {REMOTE_BASE}")

    print(f"Uploading from {LOCAL_DIST} to {REMOTE_BASE} (resumable)...")
    transport = ssh.get_transport()
    sftp = paramiko.SFTPClient.from_transport(transport)
    upload_dir(sftp, LOCAL_DIST, REMOTE_BASE)
    sftp.close()
    print("Upload complete!")

    print("Ensuring readable permissions...")
    ssh_exec(ssh, f"chmod -R a+rX {REMOTE_BASE}")

    print("Verifying via HTTPS...")
    ssh_exec(
        ssh,
        "curl -s -o /dev/null -w 'index: %{http_code}\\n' "
        "https://www.mucang.xyz/zephyrus/web/ ; "
        "curl -s -o /dev/null -w 'manifest: %{http_code}\\n' "
        "https://www.mucang.xyz/zephyrus/web/manifest.json",
    )

    ssh.close()
    print("Deploy finished!")


if __name__ == "__main__":
    main()
