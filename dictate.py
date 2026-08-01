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

Tuned for sensitivity and for text landing fast:
  - transcription runs on its own thread, so it can never stall audio capture
  - a rolling pre-roll keeps the attack of the first word, which the gate would clip
  - quiet audio is gain-normalized before it reaches Whisper
  - Whisper's own vad_filter stays OFF; it is a second gate that throws away quiet
    speech this file already decided was speech
"""
import json
import os
import sys
import threading
import queue
import time
from collections import deque

import numpy as np

RATE = 16000
CHUNK = 512             # ~32ms, so the gate reacts within a syllable
SILENCE_HANG = 0.45     # seconds of quiet that end a phrase and commit it
PARTIAL_EVERY = 0.35    # seconds between live repaints
FIRST_PARTIAL = 0.25    # show something almost immediately once you start talking
PREROLL = 0.35          # audio kept from before the gate opened, so word one survives
MIN_PHRASE = 0.20       # shorter than this is a cough, not a word
MAX_PHRASE = 20.0       # force a commit so one long ramble still lands on the note
NOISE_MULT = 2.0        # how far above the room's noise floor counts as speech
NOISE_FLOOR = 0.0015    # absolute floor, low so soft or distant speech still opens the gate
TARGET_PEAK = 0.95
MAX_GAIN = 25.0
FAST_MODEL = os.environ.get('WN_FAST_MODEL', 'tiny.en')
# Whisper pads every call out to a 30 second window, so a model's cost is essentially
# fixed per phrase, not proportional to how long you spoke. Measured on this machine:
# base.en commits in ~0.7s, small.en in ~2.2s, and on both normal and heavily attenuated
# audio they returned identical text. Set WN_MODEL=small.en to trade that second back
# for accuracy on harder audio (accents, background noise, mumbling).
ACCURATE_MODEL = os.environ.get('WN_MODEL', 'base.en')


def emit(**obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def normalize(audio):
    """Lift quiet speech up to a level Whisper was trained on. Peak-based, so it
    never clips; a laptop mic three feet away lands far below Whisper's comfort zone."""
    if not len(audio):
        return audio
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-5:
        return audio
    return audio * min(TARGET_PEAK / peak, MAX_GAIN)


def transcribe(model, audio):
    segs, _ = model.transcribe(
        normalize(audio), language='en', beam_size=1,
        condition_on_previous_text=False,  # stops Whisper looping a phrase it already emitted
        vad_filter=False,                  # our own gate already ran; a second one only drops quiet speech
        no_speech_threshold=0.8,           # lean towards emitting a quiet phrase over swallowing it
        log_prob_threshold=-2.0,
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
    except Exception as e:
        emit(t='error', msg='could not load the speech model: %s' % e)
        return 1

    # The accurate model is the memory-hungry one. On a loaded machine it can fail with
    # "mkl_malloc: failed to allocate memory", so step down rather than leaving the user
    # with a dead mic button. Degraded dictation beats none.
    accurate = None
    for name in [ACCURATE_MODEL, 'base.en', 'tiny.en', FAST_MODEL]:
        try:
            accurate = WhisperModel(name, device='cpu', compute_type='int8')
            break
        except Exception:
            continue
    if accurate is None:
        accurate = fast

    # ---- transcription runs here, never on the audio loop ----
    # One worker, so partials and finals still come out in the order they were queued.
    # A queued partial that hasn't started yet gets dropped when a newer one arrives:
    # only the newest live preview is worth anything.
    jobs = []
    jobs_cv = threading.Condition()
    stopping = threading.Event()

    def submit(kind, audio):
        with jobs_cv:
            if kind == 'partial':
                jobs[:] = [j for j in jobs if j[0] != 'partial']
            jobs.append((kind, audio))
            jobs_cv.notify()

    def worker():
        while True:
            with jobs_cv:
                while not jobs and not stopping.is_set():
                    jobs_cv.wait(0.2)
                if not jobs:
                    if stopping.is_set():
                        return
                    continue
                kind, audio = jobs.pop(0)
            try:
                text = transcribe(fast if kind == 'partial' else accurate, audio)
            except Exception as e:
                emit(t='error', msg='transcription failed: %s' % e)
                continue
            if text:
                emit(t=kind, text=text)

    worker_thread = threading.Thread(target=worker, daemon=True)
    worker_thread.start()

    commands = queue.Queue()

    def read_stdin():
        for line in sys.stdin:
            commands.put(line.strip().lower())
        commands.put('quit')  # parent closed the pipe, so the app is gone

    threading.Thread(target=read_stdin, daemon=True).start()

    frames = queue.Queue()
    listening = threading.Event()

    # --wav replays a file through the identical gate/partial/final loop, so the
    # self-check exercises the real pipeline instead of a stubbed copy of it.
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
        frames.put(b'\x00' * CHUNK * 2 * 60)  # trailing quiet so the phrase closes
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

    empty = np.zeros(0, dtype=np.float32)
    buf = empty
    preroll = deque(maxlen=max(1, int(PREROLL * RATE / CHUNK)))
    noise = NOISE_FLOOR
    audio_t = 0.0
    last_voice = 0.0
    last_partial = 0.0
    phrase_start = 0.0
    speaking = False

    def finalize():
        nonlocal buf, speaking
        audio, buf, speaking = buf, empty, False
        if len(audio) >= RATE * MIN_PHRASE:
            submit('final', audio)  # queued, not run here: the loop must keep reading audio

    while True:
        while not commands.empty():
            cmd = commands.get()
            if cmd == 'start':
                buf = empty
                speaking = False
                preroll.clear()
                with frames.mutex:
                    frames.queue.clear()
                listening.set()
            elif cmd == 'stop':
                listening.clear()
                if speaking:
                    finalize()
                buf = empty
            elif cmd == 'quit':
                stopping.set()
                with jobs_cv:
                    jobs_cv.notify_all()
                worker_thread.join(timeout=30)  # let a queued final land before we die
                return 0

        if not listening.is_set():
            time.sleep(0.02)
            continue

        try:
            data = frames.get(timeout=0.2)
        except queue.Empty:
            continue

        # Clock off audio consumed, not the wall clock. Transcription is off-thread now,
        # but frames can still arrive in bursts, and wall-clock timing would read a burst
        # as silence and chop a phrase mid-sentence.
        audio_t += (len(data) // 2) / RATE
        now = audio_t

        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        level = float(np.sqrt(np.mean(samples ** 2)) + 1e-9)
        voiced = level > max(noise * NOISE_MULT, NOISE_FLOOR)
        if not voiced:
            noise = 0.95 * noise + 0.05 * level  # track the room, not the voice

        if voiced and not speaking:
            speaking = True
            phrase_start = now
            last_partial = now - PARTIAL_EVERY + FIRST_PARTIAL
            # the gate always opens a beat late, so glue the moments before it back on
            buf = np.concatenate(list(preroll) + [samples]) if preroll else samples
        elif speaking:
            buf = np.concatenate((buf, samples))
        else:
            preroll.append(samples)

        if voiced:
            last_voice = now

        if speaking:
            if now - last_partial >= PARTIAL_EVERY and len(buf) > RATE * MIN_PHRASE:
                last_partial = now
                submit('partial', buf)
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
