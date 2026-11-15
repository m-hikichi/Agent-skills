"""Fetch the versioned upstream model once, during the image build."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import urllib.request

import numpy as np

root = Path('/opt/kokoro/models')
root.mkdir(parents=True, exist_ok=True)
base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1'
expected = {
    'kokoro-v1.0.onnx': 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}
files = {}
for name in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
    destination = root / name
    urllib.request.urlretrieve(f'{base}/{name}', destination)
    files[name] = hashlib.sha256(destination.read_bytes()).hexdigest()
    if files[name] != expected[name]:
        raise ValueError(f'Upstream model checksum mismatch: {name}')
urllib.request.urlretrieve('https://www.apache.org/licenses/LICENSE-2.0.txt', root / 'LICENSE')
with np.load(root / 'voices-v1.0.bin', allow_pickle=False) as voices:
    names = sorted(name for name in voices.files if name.startswith(('af_', 'am_', 'bf_', 'bm_')))
manifest = {
    'engine': 'kokoro-onnx',
    'version': importlib.metadata.version('kokoro-onnx'),
    'files': files,
    'voices': names,
    'dependencies': {item.metadata['Name']: item.version for item in importlib.metadata.distributions()},
    'runnerSha256': hashlib.sha256(Path('/app/tts/kokoro.py').read_bytes()).hexdigest(),
    'modelSource': base,
    'modelLicense': 'Apache-2.0',
}
(root / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True), encoding='utf-8')
print(f'Downloaded Kokoro v1.0 with {len(names)} English voices')
