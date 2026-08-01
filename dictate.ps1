# Write Notes dictation helper.
# Streams one JSON object per line to stdout: {"t":"ready"} {"t":"partial","text":..} {"t":"final","text":..} {"t":"error","msg":..}
# Uses .NET System.Speech, which ships with Windows -- fully offline, no API key, no bundled model.
# ponytail: SAPI's desktop recognizer is the accuracy ceiling here. Swap in Whisper/Vosk behind this
# same one-JSON-per-line protocol if free-form dictation accuracy ever becomes the complaint.
param([string]$WavFile = '')

$ErrorActionPreference = 'Stop'

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

  if ($WavFile) { $rec.SetInputToWaveFile($WavFile) } else { $rec.SetInputToDefaultAudioDevice() }

  # SpeechHypothesized fires mid-utterance, which is what makes the text land on the note as you talk.
  Register-ObjectEvent -InputObject $rec -EventName SpeechHypothesized -Action {
    $t = $EventArgs.Result.Text
    if ($t) {
      [Console]::Out.WriteLine((@{ t = 'partial'; text = $t } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  } | Out-Null

  Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -Action {
    $t = $EventArgs.Result.Text
    if ($t) {
      [Console]::Out.WriteLine((@{ t = 'final'; text = $t } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
    }
  } | Out-Null

  $done = $false
  Register-ObjectEvent -InputObject $rec -EventName RecognizeCompleted -Action {
    [Console]::Out.WriteLine((@{ t = 'done' } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } | Out-Null

  $rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Emit @{ t = 'ready' }

  # Stay alive until the parent kills us (mic) or the wave file runs dry (self-test).
  $idle = 0
  while ($true) {
    Start-Sleep -Milliseconds 200
    if ($WavFile) { $idle += 200; if ($idle -gt 15000) { break } }
  }
} catch {
  Emit @{ t = 'error'; msg = $_.Exception.Message }
  exit 1
}
