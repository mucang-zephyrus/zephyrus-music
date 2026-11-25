set -euo pipefail
cd /opt/zephyrus-platform-webtest
release="$1"
unit=zephyrus-platform-webtest.service
unit_path=/etc/systemd/system/$unit
envfile=/etc/zephyrus-platform-webtest.env
parent=/etc/nginx/snippets/zephyrus-webtest.conf
snippet=/etc/nginx/snippets/zephyrus-platform-webtest.conf
include="include $snippet;"
if [ -e current ] && [ ! -L current ]; then exit 1; fi
previous=$(readlink current || true)
cp -p "$parent" "$release/webtest.before"
test ! -e "$unit_path" || cp -p "$unit_path" "$release/unit.before"
test ! -e "$snippet" || cp -p "$snippet" "$release/snippet.before"
if [ ! -s "$envfile" ]; then
    (umask 077; test ! -e "$envfile"; printf 'QQ_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > "$envfile")
fi
switch() {
    ln -s "$1" "$release/current.next"
    mv -Tf "$release/current.next" current
}
rollback() {
    code=$?
    [ "$code" -eq 0 ] && return
    set +e
    cp -p "$release/webtest.before" "$parent"
    if [ -f "$release/snippet.before" ]; then cp -p "$release/snippet.before" "$snippet"; else unlink "$snippet"; fi
    nginx -t -q && systemctl reload nginx
    systemctl stop "$unit"
    if [ -f "$release/unit.before" ]; then cp -p "$release/unit.before" "$unit_path"; else unlink "$unit_path"; fi
    systemctl daemon-reload
    if [ -n "$previous" ]; then switch "$previous"; systemctl start "$unit"; else unlink current; fi
}
trap rollback EXIT
switch "$release"
install -m 644 "$release/platform-gateway.service" "$unit_path"
systemctl daemon-reload
systemctl restart "$unit"
base=http://127.0.0.1:3052/platform
curl -fsS --retry 5 --retry-connrefused --max-time 12 "$base/qq/api/login/channels" | python3 -c 'import json,sys; assert "qqmusic" in json.load(sys.stdin)["data"]["channels"]'
install -m 644 "$release/platform-gateway-location.conf" "$snippet"
if ! grep -Fxq "$include" "$parent"; then printf '\n%s\n' "$include" >> "$parent"; fi
nginx -t -q
systemctl reload nginx
health=https://mucang.xyz/zephyrus/api-test/platform/health
ready=0
for attempt in {1..12}; do
    response=$(curl -fsS --resolve mucang.xyz:443:127.0.0.1 --max-time 4 "$health" || true)
    if [[ "$response" == *'"service":"zephyrus-music-gateway"'* ]]; then ready=1; break; fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then echo 'Test gateway HTTPS route did not become ready' >&2; exit 1; fi
systemctl enable "$unit"
