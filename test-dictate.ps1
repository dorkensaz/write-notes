# Self-check for dictate.ps1: speak a known sentence to a WAV, feed it back through the
# recognizer, and assert real words come out on the streaming protocol. No mic needed.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File test-dictate.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$wav = Join-Path $env:TEMP 'writenotes-dictate-test.wav'

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($wav)
$synth.Rate = -1
$synth.Speak('call the client about the invoice tomorrow morning')
$synth.Dispose()

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'dictate.ps1') -WavFile $wav 2>&1
$text = ($out | Out-String)

$fail = $false
if ($text -notmatch '"t":"ready"')  { Write-Output 'FAIL: helper never reported ready'; $fail = $true }
if ($text -notmatch '"t":"final"')  { Write-Output 'FAIL: no final result emitted'; $fail = $true }
if ($text -notmatch 'invoice|client|tomorrow') { Write-Output "FAIL: no recognizable words. Got: $text"; $fail = $true }

Remove-Item $wav -ErrorAction SilentlyContinue
if ($fail) { Write-Output 'DICTATION SELF-CHECK FAILED'; exit 1 }
Write-Output 'DICTATION SELF-CHECK PASSED'
Write-Output $text
