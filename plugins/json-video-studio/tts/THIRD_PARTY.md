# English TTS components

- Model and English voices: [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), Apache-2.0.
- ONNX conversion assets and inference library: [thewh1teagle/kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). The Python library uses the MIT license; see its installed distribution metadata and upstream LICENSE.
- English phonemization: eSpeak NG and phonemizer, installed with their distribution license notices.
- CPU inference: ONNX Runtime. WAV encoding: soundfile and libsndfile.

The model is downloaded only during the image build. Its license is saved at
`/opt/kokoro/models/LICENSE`; file checksums and installed Python package versions
are stored in `manifest.json` in the same directory. Third-party license terms
remain applicable independently of this plugin's own code. Generated output
credits identify the model and selected voice; they are not a listening review.
