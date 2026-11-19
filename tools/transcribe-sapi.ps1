# D3 helper: run the Windows built-in speech recognizer (System.Speech / SAPI desktop) on a 16 kHz mono PCM wav.
# Called by tools/transcribe.mjs; needs Windows PowerShell 5.1 (powershell.exe), not pwsh 7 (no System.Speech there).
# Output: one JSON object per recognized phrase on stdout, UTF-8:
#   {"start_ms":1234,"dur_ms":2345,"text":"...","conf":0.81}
# start_ms / dur_ms are the recognizer's own RecognizedAudio.AudioPosition / Duration. Nothing is estimated here.
param(
  [Parameter(Mandatory = $true)][string]$Wav,
  [string]$Culture = 'zh-CN'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech

$info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
  Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1
if (-not $info) { [Console]::Error.WriteLine("NO_RECOGNIZER $Culture"); exit 3 }

$eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
$eng.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$eng.SetInputToWaveFile($Wav)
# Async multiple mode: one continuous pass, so AudioPosition is measured from the start of the file.
Register-ObjectEvent -InputObject $eng -EventName SpeechRecognized -SourceIdentifier d3rec | Out-Null
Register-ObjectEvent -InputObject $eng -EventName RecognizeCompleted -SourceIdentifier d3done | Out-Null
$eng.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
$done = $false
while (-not $done) {
  $ev = Wait-Event -Timeout 600
  if (-not $ev) { [Console]::Error.WriteLine('TIMEOUT'); exit 4 }
  if ($ev.SourceIdentifier -eq 'd3rec') {
    $r = $ev.SourceEventArgs.Result
    if ($r.Audio) {
      $o = [ordered]@{
        start_ms = [int64]$r.Audio.AudioPosition.TotalMilliseconds
        dur_ms   = [int64]$r.Audio.Duration.TotalMilliseconds
        text     = $r.Text
        conf     = [math]::Round($r.Confidence, 3)
      }
      [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
    }
  } elseif ($ev.SourceIdentifier -eq 'd3done') {
    $err = $ev.SourceEventArgs.Error
    if ($err) { [Console]::Error.WriteLine("RECOGNIZE_ERROR $($err.Message)"); exit 5 }
    $done = $true
  }
  Remove-Event -EventIdentifier $ev.EventIdentifier
}
Unregister-Event d3rec; Unregister-Event d3done
$eng.Dispose()
