"""Write Notes dictation helper.

Streams one JSON object per line to stdout:
  {"t":"loading"} {"t":"ready"} {"t":"partial","text":..} {"t":"final","text":..} {"t":"error","msg":..}
Reads one command per line on stdin: start | stop | quit

Runs Whisper locally through faster-whisper. Nothing leaves the machine, no API key.
Windows' built-in SAPI recognizer was tried first and was not usable for free-form
dictation ("Hi. My name is Ken..." came back as "Scandals that I'm saying the exact
since then"), so accuracy, not bundle size, drives the engine choice here.

Two tiers, because one model cannot be both fast and accurate:
  tiny.en  repaints the greyed live text while you are still talking
  small.en re-transcribes the finished phrase and commits the accurate version
"""
import json
import os
import sys
import threading
import queue
import time

import numpy as np

RATE = 16000
CHUNK = 1024
SILENCE_HANG = 0.7      # seconds of quiet that end a phrase
PARTIAL_EVERY = 0.9     # seconds between live repaints
MAX_PHRASE = 25.0       # force a commit so one long ramble still lands on the note
FAST_MODEL = os.environ.get('WN_FAST_MODEL', 'tiny.en')
ACCURATE_MODEL = os.environ.get('WN_MODEL', 'small.en')


def emit(**obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def transcribe(model, audio):
    segs, _ = model.transcribe(
        audio, language='en', beam_size=1,
        condition_on_previous_text=False,  # stops Whisper looping a phrase it already emitted
        vad_filter=True,
    )
    return ''.join(s.text for s in segs).strip()


def main():
    try:
        from faster_whisper import WhisperModel
        import pyaudiowpatch as pyaudio
    except ImportError as e:
        emit(t='error', msg='missing dependency: %s' % e)
        return 1

    emit(t='loading')
    try:
        fast = WhisperModel(FAST_MODEL, device='cpu', compute_type='int8')
        accurate = WhisperModel(ACCURATE_MODEL, device='cpu', compute_type='int8')
    except Exception as e:
        emit(t='error', msg='could not load the speech model: %s' % e)
        return 1

    commands = queue.Queue()

    def read_stdin():
        for line in sys.stdin:
            commands.put(line.strip().lower())
        commands.put('quit')

    threading.Thread(target=read_stdin, daemon=True).start()

    frames = queue.Queue()
    listening = threading.Event()

    # --wav replays a file through the identical VAD/partial/final loop, so the self-check
    # exercises the real pipeline instead of a stubbed copy of it.
    wav_path = None
    if '--wav' in sys.argv:
        wav_path = sys.argv[sys.argv.index('--wav') + 1]

    def replay():
        import wave
        listening.wait()
        with wave.open(wav_path) as w:
            assert w.getframerate() == RATE and w.getnchannels() == 1, 'self-check wav must be 16k mono'
            while True:
                data = w.readframes(CHUNK)
                if not data:
                    break
                frames.put(data)
        frames.put(b'\x00' * CHUNK * 2 * 40)  # trailing quiet so the phrase closes
        while not frames.empty():
            time.sleep(0.05)  # let the loop actually consume the file before ending the run
        commands.put('stop')
        commands.put('quit')

    def capture():
        pa = pyaudio.PyAudio()
        stream = None
        while True:
            listening.wait()
            if stream is None:
                try:
                    stream = pa.open(format=pyaudio.paInt16, channels=1, rate=RATE,
                                     input=True, frames_per_buffer=CHUNK)
                except Exception as e:
                    emit(t='error', msg='no microphone: %s' % e)
                    listening.clear()
                    continue
            try:
                data = stream.read(CHUNK, exception_on_overflow=False)
            except Exception:
                continue
            if listening.is_set():
                frames.put(data)
            else:
                stream.close()
                stream = None

    threading.Thread(target=replay if wav_path else capture, daemon=True).start()
    emit(t='ready')

    buf = np.zeros(0, dtype=np.float32)
    # ponytail: energy VAD against a slowly-tracked noise floor. Good enough for a quiet
    # desk; swap in webrtcvad/silero if a noisy room ever starts chopping phrases early.
    noise = 0.0025
    audio_t = 0.0
    last_voice = 0.0
    last_partial = 0.0
    phrase_start = 0.0
    speaking = False

    def finalize():
        nonlocal buf, speaking
        audio, buf, speaking = buf, np.zeros(0, dtype=np.float32), False
        if len(audio) < RATE * 0.3:
            return
        text = transcribe(accurate, audio)
        if text:
            emit(t='final', text=text)

    while True:
        while not commands.empty():
            cmd = commands.get()
            if cmd == 'start':
                buf = np.zeros(0, dtype=np.float32)
                speaking = False
                with frames.mutex:
                    frames.queue.clear()
                listening.set()
            elif cmd == 'stop':
                listening.clear()
                if speaking:
                    finalize()
                buf = np.zeros(0, dtype=np.float32)
            elif cmd == 'quit':
                return 0

        if not listening.is_set():
            time.sleep(0.05)
            continue

        try:
            data = frames.get(timeout=0.2)
        except queue.Empty:
            data = None

        # Clock off audio consumed, not the wall clock: transcription blocks for a second
        # or two at a time, and frames queue up behind it. Wall-clock timing would call
        # that backlog "silence" and chop a phrase mid-sentence.
        if data is not None:
            audio_t += (len(data) // 2) / RATE
        now = audio_t
        if data is not None:
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            level = float(np.sqrt(np.mean(samples ** 2)) + 1e-9)
            voiced = level > max(noise * 3.0, 0.006)
            if not voiced:
                noise = 0.95 * noise + 0.05 * level  # track the room, not the voice
            if voiced:
                if not speaking:
                    speaking = True
                    phrase_start = now
                    last_partial = now
                last_voice = now
            if speaking:
                buf = np.concatenate((buf, samples))

        if speaking:
            if now - last_partial >= PARTIAL_EVERY and len(buf) > RATE * 0.4:
                last_partial = now
                text = transcribe(fast, buf)
                if text:
                    emit(t='partial', text=text)
            if (now - last_voice >= SILENCE_HANG) or (now - phrase_start >= MAX_PHRASE):
                finalize()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:  # never die silently, the note needs to know to reset its button
        emit(t='error', msg=str(exc))
        sys.exit(1)
