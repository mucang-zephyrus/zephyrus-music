#!/bin/sh
# Retired: GitHub release polling has been replaced by local signed builds.
# Remove the apk-release-agent.sh cron entry; keep existing APKs and latest.json.
# See docs/local-workflow.md and npm run release:publish.
printf '%s\n' 'GitHub APK polling is retired. Use the local release workflow.'
