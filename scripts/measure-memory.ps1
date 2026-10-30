# Samples the working set of the running KastenFlow desktop app on Windows:
# the app's own process plus every process it started (the WebView2 windows
# hold most of the memory). Prints one line per sample and the largest, then
# the smallest, so a table of readings is easy to fill in.
#
#   powershell -File scripts/measure-memory.ps1 -Label idle -Samples 6 -EverySeconds 10
#   powershell -File scripts/measure-memory.ps1 -Label after-20x -Samples 1
#
# Start the app first (the release build: pnpm -C app tauri build), open the
# big vault, and leave it alone while it samples. Readings are in MB.

param(
    [string]$ProcessName = "kasten-app",
    [string]$Label = "sample",
    [int]$Samples = 6,
    [int]$EverySeconds = 10
)

function Get-Tree([int]$RootId) {
    $all = Get-CimInstance Win32_Process
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add($RootId)
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $grew = $true }
        }
    }
    return $ids
}

$root = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $root) {
    Write-Error "No process named $ProcessName is running. Start the desktop app first."
    exit 2
}

$readings = @()
for ($i = 1; $i -le $Samples; $i++) {
    $ids = Get-Tree $root.Id
    $bytes = 0
    foreach ($id in $ids) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p) { $bytes += $p.WorkingSet64 }
    }
    $mb = [math]::Round($bytes / 1MB, 1)
    $readings += $mb
    Write-Output ("{0} {1} sample {2}/{3}: {4} MB across {5} processes" -f (Get-Date -Format "HH:mm:ss"), $Label, $i, $Samples, $mb, $ids.Count)
    if ($i -lt $Samples) { Start-Sleep -Seconds $EverySeconds }
}

$sorted = $readings | Sort-Object
Write-Output ("{0}: smallest {1} MB, largest {2} MB" -f $Label, $sorted[0], $sorted[-1])
