"""vasr —— 本地语音转写。faster-whisper + small 模型，全本地、不联网、不花钱。

用法：python vasr.py <音频文件.wav> [模型目录] [--json]
说明：只吃 16kHz 单声道 wav（先用 ffmpeg 抽出来）。这样绕开 PyAV ——
      那东西跟 faster-whisper 的版本老打架，直接喂 numpy 数组干净得多。
"""
import json
import os
import sys
import time
import wave

import numpy as np

# 模型目录：传参 > 环境变量 > 插件自带 > 本机老位置（2026-11-03 改）。
# 原来写死 E 盘——那是本机的路径，别人机器上必然没有。
def pick_model():
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [
        os.environ.get("AJING_ASR_MODEL"),
        os.path.join(here, "..", "vendor", "models", "faster-whisper-small"),
        r"E:\_DSH\models\faster-whisper-small",
    ]
    for d in cands:
        if d and os.path.isfile(os.path.join(d, "model.bin")):
            return d
    return cands[-1] if cands[-1] else ""


def load_wav(path):
    with wave.open(path, "rb") as w:
        if w.getnchannels() != 1 or w.getframerate() != 16000:
            raise SystemExit("要 16kHz 单声道 wav，这条是 %d Hz / %d 声道" % (
                w.getframerate(), w.getnchannels()))
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    if not args:
        print("用法：python vasr.py <音频.wav> [模型目录] [--json]", file=sys.stderr)
        return 2
    audio_path = args[0]
    model_dir = args[1] if len(args) > 1 else pick_model()

    if not os.path.exists(audio_path):
        print("找不到文件：" + audio_path, file=sys.stderr)
        return 2
    if not os.path.isdir(model_dir):
        print("找不到模型目录：" + model_dir, file=sys.stderr)
        return 2

    audio = load_wav(audio_path)
    seconds = len(audio) / 16000.0

    t0 = time.time()
    from faster_whisper import WhisperModel

    model = WhisperModel(model_dir, device="cpu", compute_type="int8", local_files_only=True)
    load_ms = int((time.time() - t0) * 1000)

    segments, info = model.transcribe(audio, language="zh", vad_filter=True, beam_size=5)
    rows = []
    for s in segments:
        rows.append({
            "start": round(float(s.start), 2),
            "end": round(float(s.end), 2),
            "text": str(s.text).strip(),
        })

    took = round(time.time() - t0, 1)
    if as_json:
        print(json.dumps({
            "audio": os.path.basename(audio_path),
            "duration": round(seconds, 2),
            "load_ms": load_ms,
            "seconds": took,
            "segments": rows,
        }, ensure_ascii=False))
        return 0

    print("# 转写 · %s" % os.path.basename(audio_path))
    print("# %.1f 分钟音频 · 用了 %.1f 秒（模型加载 %d 毫秒）· %d 条" % (
        seconds / 60, took, load_ms, len(rows)))
    print()
    for r in rows:
        m, sec = divmod(int(r["start"]), 60)
        print("[%02d:%02d] %s" % (m, sec, r["text"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
