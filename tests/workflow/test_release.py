import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('workflow', Path(__file__).resolve().parents[2] / 'scripts/workflow.py')
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.old = dict(version='1.4.1', version_code=11, certificate_sha256='a' * 64)
        self.new = dict(version='1.4.2', version_code=12, certificate_sha256='a' * 64)

    def test_valid_upgrade(self):
        workflow.check_upgrade(self.old, self.new)

    def test_rejects_wrong_key_or_non_upgrades(self):
        for changed in ({'certificate_sha256': 'b' * 64}, {'version_code': 11},
                        {'version': '1.4.1'}, {'version': '1.3.9'}, {'version': '1.4.2-beta'}):
            with self.subTest(changed=changed), self.assertRaises((ValueError, RuntimeError)):
                workflow.check_upgrade(self.old, {**self.new, **changed})

    def test_manifest_has_real_size_hash_and_immutable_url(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp) / 'zephyrus-player-v1.4.2-12.apk'
            apk.write_bytes(b'signed artifact fixture')
            info = {**self.new, 'sha256': workflow.sha256(apk)}
            manifest = workflow.manifest_for(apk, info, '中文发布说明')
            self.assertEqual(manifest['body'], '中文发布说明')
            self.assertEqual(manifest['assets'][0]['size'], apk.stat().st_size)
            self.assertEqual(manifest['assets'][0]['sha256'], info['sha256'])
            self.assertTrue(manifest['assets'][0]['browser_download_url'].endswith(apk.name))

    def test_bad_signature_or_wrong_package_aborts(self):
        tools = (Path('/sdk'), Path('apksigner'), Path('aapt'))
        with patch.object(workflow, 'run', side_effect=RuntimeError('Invalid signature')):
            with self.assertRaises(RuntimeError):
                workflow.apk_info('bad.apk', tools)
        with patch.object(workflow, 'run', side_effect=[
            'Signer #1 certificate SHA-256 digest: ' + 'a' * 64,
            "package: name='wrong.app' versionCode='12' versionName='1.4.2'"
        ]):
            with self.assertRaises(RuntimeError):
                workflow.apk_info('bad.apk', tools)


if __name__ == '__main__':
    unittest.main()
