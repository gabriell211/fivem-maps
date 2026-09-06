param(
    [string]$BlenderVersion = "4.5.13",
    [string]$RuntimeRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $RuntimeRoot = Join-Path $repoRoot ".runtime"
}
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$blenderRoot = Join-Path $RuntimeRoot "blender"
$venvRoot = Join-Path $RuntimeRoot "venv"
$jobsRoot = Join-Path $RuntimeRoot "jobs"
$zipPath = Join-Path $RuntimeRoot "blender.zip"

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $jobsRoot | Out-Null

$blender = Get-ChildItem $blenderRoot -Filter blender.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $blender) {
    Write-Host "Downloading Blender $BlenderVersion..."
    $url = "https://download.blender.org/release/Blender4.5/blender-$BlenderVersion-windows-x64.zip"
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    if (Test-Path $blenderRoot) { Remove-Item $blenderRoot -Recurse -Force }
    Expand-Archive $zipPath -DestinationPath $blenderRoot
    Remove-Item $zipPath -Force
    $blender = Get-ChildItem $blenderRoot -Filter blender.exe -Recurse | Select-Object -First 1
}
if (-not $blender) { throw "blender.exe was not found after installation." }
$blenderBin = $blender.FullName

Write-Host "Installing Sollumz extension..."
& $blenderBin --online-mode --command extension repo-add mapforge_sollumz --name "Sollumz" --url "https://repo.sollumz.org/"
$repoAddExit = $LASTEXITCODE
if ($repoAddExit -ne 0) {
    Write-Host "Sollumz repository may already exist; continuing with install/sync."
}
& $blenderBin --online-mode --command extension install -s -e sollumz
if ($LASTEXITCODE -ne 0) { throw "Failed to install/enable Sollumz." }

Write-Host "Installing Sollumz native dependencies (including PyMateria)..."
$previousCi = $env:CI
$env:CI = "1"
$verifyExpr = @'
import bpy
import importlib
import sys
roots = [m for m in sys.modules if m == "sollumz" or m.endswith(".sollumz")]
if not roots:
    raise RuntimeError("Sollumz module not loaded")
deps = importlib.import_module(f"{roots[0]}.dependencies")
print("MAP_FORGE_NATIVE=" + str(deps.IS_SZIO_NATIVE_AVAILABLE))
if not deps.IS_SZIO_NATIVE_AVAILABLE:
    raise RuntimeError(deps.PYMATERIA_REQUIRED_MSG or "Native provider unavailable")
'@
& $blenderBin --online-mode --background --python-exit-code 1 --python-expr $verifyExpr
$verifyExit = $LASTEXITCODE
if ($null -eq $previousCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $previousCi }
if ($verifyExit -ne 0) { throw "Sollumz native dependencies are not ready." }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "Python 3.12+ is required for the FastAPI worker." }
& $python.Source -c "import sys; assert sys.version_info >= (3, 12), 'Python 3.12+ required'"
if ($LASTEXITCODE -ne 0) { throw "Python 3.12+ is required." }

if (-not (Test-Path (Join-Path $venvRoot "Scripts\python.exe"))) {
    & $python.Source -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw "Failed to create worker virtual environment." }
}
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $repoRoot "worker\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Failed to install worker Python dependencies." }

$tokenBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$workerToken = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
$envPath = Join-Path $RuntimeRoot "worker.env.ps1"
@"
`$env:BLENDER_BIN = '$($blenderBin.Replace("'", "''"))'
`$env:MAP_FORGE_JOBS = '$($jobsRoot.Replace("'", "''"))'
`$env:MAP_FORGE_WORKER_TOKEN = '$workerToken'
`$env:MAP_FORGE_MAX_CONCURRENT = '1'
`$env:MAP_FORGE_EXPORT_TIMEOUT = '1200'
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host ""
Write-Host "Windows worker runtime is ready." -ForegroundColor Green
Write-Host "Blender: $blenderBin"
Write-Host "Environment: $envPath"
Write-Host "Start with: powershell -ExecutionPolicy Bypass -File worker/windows/start.ps1"
Write-Host "Use the generated MAP_FORGE_WORKER_TOKEN in the web application's server-side environment."
