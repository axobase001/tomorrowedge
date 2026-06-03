param(
  [string]$Model = "gpt-image-2",
  [string]$Quality = "medium",
  [int]$Concurrency = 2,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$ImageGen = Join-Path $env:USERPROFILE ".codex\skills\.system\imagegen\scripts\image_gen.py"
$InputJsonl = Join-Path $RepoRoot "docs\ui\image2-components\prompts.jsonl"
$OutDir = Join-Path $RepoRoot "output\imagegen\tomorrowedge-components"

if (-not (Test-Path $ImageGen)) {
  throw "image_gen.py not found at $ImageGen"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$argsList = @(
  $ImageGen,
  "generate-batch",
  "--input", $InputJsonl,
  "--out-dir", $OutDir,
  "--concurrency", "$Concurrency"
)

if ($DryRun) {
  $argsList += "--dry-run"
} elseif (-not $env:OPENAI_API_KEY) {
  throw "OPENAI_API_KEY is not set. Set it locally before running real gpt-image-2 generation."
}

python @argsList

Write-Host "Component outputs: $OutDir"
