"""Self-check for dictate.py. No microphone needed.

Speaks a known sentence to a 16k mono WAV, replays it through the real gate +
partial + final loop, and asserts the committed text actually matches. The sentence
is the one Windows' old SAPI recognizer mangled into "Scandals that I'm saying the
exact since then", which is why this app runs Whisper instead.

Runs the same audio twice: once at normal level, once attenuated hard, because
"picks up quiet speech" is a requirement and a gate that only hears shouting
passes every test written against loud audio.

Run: python test-dictate.py
"""
import json
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SENTENCE = 'Hi. My name is Ken, and I am saying the exact same thing that I am saying to Claude.'
MUST_CONTAIN = ['name is ken', 'exact same thing', 'claude']
QUIET_GAIN = 0.08  # about 22 dB down, a soft voice well away from the mic

loud_wav = os.path.join(tempfile.gettempdir(), 'writenotes-selfcheck.wav')
quiet_wav = os.path.join(tempfile.gettempdir(), 'writenotes-selfcheck-quiet.wav')

ps = (
    "Add-Type -AssemblyName System.Speech;"
    "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,"
    "[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,"
    "[System.Speech.AudioFormat.AudioChannel]::Mono);"
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
    f"$s.SetOutputToWaveFile('{loud_wav}', $f); $s.Speak('{SENTENCE}'); $s.Dispose()"
)
subprocess.run(['powershell', '-NoProfile', '-Command', ps], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

with wave.open(loud_wav) as w:
    params = w.getparams()
    pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
with wave.open(quiet_wav, 'wb') as w:
    w.setparams(params)
    w.writeframes((pcm.astype(np.float32) * QUIET_GAIN).astype(np.int16).tobytes())


def run(wav):
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, 'dictate.py'), '--wav', wav],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
    proc.stdin.write('start\n')
    proc.stdin.flush()
    events = []
    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    finally:
        proc.terminate()
    return events


fails = []
for label, wav in [('normal level', loud_wav), ('quiet speech', quiet_wav)]:
    events = run(wav)
    kinds = [e['t'] for e in events]
    finals = [e['text'] for e in events if e['t'] == 'final']
    partials = [e['text'] for e in events if e['t'] == 'partial']

    print('[%s] partials: %d, finals: %d' % (label, len(partials), len(finals)))
    for f in finals:
        print('   FINAL: %s' % f)

    if 'ready' not in kinds:
        fails.append('%s: helper never reported ready' % label)
    if not partials:
        fails.append('%s: no live partial text, the note would stay blank while talking' % label)
    if not finals:
        fails.append('%s: no committed text emitted' % label)
    else:
        # a pause mid-sentence legitimately commits more than one phrase; the note gets
        # them appended in order, so the self-check judges the joined result
        got = ' '.join(finals).lower()
        missing = [p for p in MUST_CONTAIN if p not in got]
        if missing:
            fails.append('%s: committed text missing %s. Got: %r' % (label, missing, ' '.join(finals)))
    for e in events:
        if e['t'] == 'error':
            fails.append('%s: error event: %s' % (label, e.get('msg')))

for f in (loud_wav, quiet_wav):
    os.remove(f)

if fails:
    print('\n'.join('FAIL: ' + f for f in fails))
    print('DICTATION SELF-CHECK FAILED')
    sys.exit(1)
print('DICTATION SELF-CHECK PASSED')
