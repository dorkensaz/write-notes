"""Self-check for dictate.py. No microphone needed.

Speaks a known sentence to a 16k mono WAV, replays it through the real VAD +
partial + final loop, and asserts the committed text actually matches. The sentence
is the one Windows' old SAPI recognizer mangled into "Scandals that I'm saying the
exact since then", which is why this app runs Whisper instead.

Run: .venv/Scripts/python.exe test-dictate.py
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SENTENCE = 'Hi. My name is Ken, and I am saying the exact same thing that I am saying to Claude.'
MUST_CONTAIN = ['name is ken', 'exact same thing', 'claude']

wav = os.path.join(tempfile.gettempdir(), 'writenotes-selfcheck.wav')
ps = (
    "Add-Type -AssemblyName System.Speech;"
    "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,"
    "[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,"
    "[System.Speech.AudioFormat.AudioChannel]::Mono);"
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
    f"$s.SetOutputToWaveFile('{wav}', $f); $s.Speak('{SENTENCE}'); $s.Dispose()"
)
subprocess.run(['powershell', '-NoProfile', '-Command', ps], check=True,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
    try:
        proc.stdin.write('quit\n')
        proc.stdin.flush()
    except Exception:
        pass
    proc.terminate()

os.remove(wav)

kinds = [e['t'] for e in events]
finals = [e['text'] for e in events if e['t'] == 'final']
partials = [e['text'] for e in events if e['t'] == 'partial']
fails = []

if 'ready' not in kinds:
    fails.append('helper never reported ready')
if not partials:
    fails.append('no live partial text emitted, the note would stay blank while talking')
if not finals:
    fails.append('no committed text emitted')
else:
    # a pause mid-sentence legitimately commits more than one phrase; the note gets them
    # appended in order, so the self-check judges the joined result
    got = ' '.join(finals).lower()
    missing = [p for p in MUST_CONTAIN if p not in got]
    if missing:
        fails.append('committed text missing %s. Got: %r' % (missing, ' '.join(finals)))

for e in events:
    if e['t'] == 'error':
        fails.append('error event: %s' % e.get('msg'))

print('partials: %d, finals: %d' % (len(partials), len(finals)))
for f in finals:
    print('FINAL: %s' % f)
if fails:
    print('\n'.join('FAIL: ' + f for f in fails))
    print('DICTATION SELF-CHECK FAILED')
    sys.exit(1)
print('DICTATION SELF-CHECK PASSED')
