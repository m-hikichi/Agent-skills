"""Offline Kokoro worker. Node supplies a temporary JSON request, never shell code."""
import argparse
import json
import os
from pathlib import Path

os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--models', required=True)
args = parser.parse_args()
request = json.loads(Path(args.input).read_text(encoding='utf-8'))
models = Path(args.models)
manifest = json.loads((models / 'manifest.json').read_text(encoding='utf-8'))
voice = request['voiceId']
language = request['language']
if voice not in manifest['voices'] or language not in ('en-US', 'en-GB'):
    raise ValueError('Unsupported English voice or language')
if not voice.startswith('a' if language == 'en-US' else 'b'):
    raise ValueError('Voice accent does not match language')
text = request['text']
if not isinstance(text, str) or not text.strip() or len(text) > 2000:
    raise ValueError('Text must contain 1 to 2000 characters')
speed = request['speedScale']
volume = request['volumeScale']
if not 0.5 <= speed <= 2 or not 0 <= volume <= 2:
    raise ValueError('Invalid speed or volume')

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(models / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
kokoro = Kokoro.from_session(session, str(models / 'voices-v1.0.bin'))
samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=language.lower())
if not len(samples) or not np.isfinite(samples).all():
    raise ValueError('Kokoro produced empty or non-finite audio')
sf.write(args.output, np.clip(samples * volume, -1, 1), sample_rate, subtype='PCM_16')
print(json.dumps({'samples': len(samples), 'sampleRate': sample_rate}))
