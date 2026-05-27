# PowerShell wrapper for the Dockerized dev environment.
#
# Usage from any directory:
#   .\scripts\dev.ps1 up          # boot the stack
#   .\scripts\dev.ps1 down        # stop the stack
#   .\scripts\dev.ps1 logs        # tail every service
#   .\scripts\dev.ps1 log backend # tail one service
#   .\scripts\dev.ps1 shell bet   # open /bin/sh in one container
#   .\scripts\dev.ps1 psql bet    # open psql against the bet DB
#   .\scripts\dev.ps1 db-reset    # drop + re-migrate + re-seed both DBs
#   .\scripts\dev.ps1 clean       # DESTRUCTIVE: drop all volumes
#
# This script is a thin shim around `docker compose` so Windows users
# without `make` get the same UX as Mac/Linux. Every target maps 1:1
# to a target in Makefile.dev.

[CmdletBinding()]
param(
  [Parameter(Position=0)] [string] $Command = 'help',
  [Parameter(Position=1)] [string] $Arg1,
  [Parameter(Position=2)] [string] $Arg2
)

$ErrorActionPreference = 'Stop'

# Anchor to the repo root regardless of where this is invoked from.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$ComposeFile     = 'docker-compose.yml'
$ComposeProdFile = 'docker-compose.prod.yml'

function Invoke-Compose {
  param([string[]] $ComposeArgs)
  & docker compose -f $ComposeFile @ComposeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-ComposeProd {
  param([string[]] $ComposeArgs)
  & docker compose -f $ComposeFile -f $ComposeProdFile @ComposeArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Ensure-Env {
  if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host "Created .env from .env.example — review and edit if needed." -ForegroundColor Yellow
  }
}

function Show-Endpoints {
  $ports = @{
    PROXY_HTTP_PORT      = '8000'
    BACKEND_PORT         = '4000'
    BET_PORT             = '3100'
    AUCTIONS_PORT        = '3200'
    AVIATOR_PORT         = '3000'
    ADMIN_PORT           = '5173'
    ADMINER_PORT         = '8080'
    REDIS_COMMANDER_PORT = '8081'
    MAILPIT_HTTP_PORT    = '8025'
  }
  if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') {
      if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$' -and $ports.ContainsKey($Matches[1])) {
        $ports[$Matches[1]] = $Matches[2]
      }
    }
  }
  Write-Host ""
  Write-Host "Stack is up. Open:" -ForegroundColor Green
  Write-Host ("  http://localhost:{0,-5} (proxy — bet at /, auctions at /auctions/, aviator at /aviator/, admin at /admin/)" -f $ports.PROXY_HTTP_PORT)
  Write-Host ("  http://localhost:{0,-5} (backend API)" -f $ports.BACKEND_PORT)
  Write-Host ("  http://localhost:{0,-5} (bet)" -f $ports.BET_PORT)
  Write-Host ("  http://localhost:{0,-5} (auctions)" -f $ports.AUCTIONS_PORT)
  Write-Host ("  http://localhost:{0,-5} (aviator)" -f $ports.AVIATOR_PORT)
  Write-Host ("  http://localhost:{0,-5} (admin SPA)" -f $ports.ADMIN_PORT)
  Write-Host ("  http://localhost:{0,-5} (Adminer — Postgres GUI)" -f $ports.ADMINER_PORT)
  Write-Host ("  http://localhost:{0,-5} (redis-commander, admin/admin)" -f $ports.REDIS_COMMANDER_PORT)
  Write-Host ("  http://localhost:{0,-5} (Mailpit — outbound mail)" -f $ports.MAILPIT_HTTP_PORT)
}

switch ($Command.ToLower()) {
  'help'    {
    @"
Kalki — Dockerized development (PowerShell wrapper)

Usage: .\scripts\dev.ps1 <command> [args]

  up              Start the dev stack (build images if missing)
  up-prod         Start with the production Dockerfiles
  worker          Start the stack INCLUDING the cron-only worker
  down            Stop containers (named volumes preserved)
  stop            Pause containers without removing them
  start           Resume previously stopped containers
  restart         Restart all services
  clean           DESTRUCTIVE: stop + drop every volume
  build           Build all dev images
  rebuild         Force-rebuild from scratch (no cache)
  pull            Pull base images
  ps              Show container status
  ports           Show port mappings
  logs            Tail logs for ALL services
  log <svc>       Tail logs for ONE service
  shell <svc>     Open /bin/sh in a service
  psql [db]       Open psql against the chosen DB (default uniquebid)
  redis-cli       Open redis-cli
  migrate         Apply Prisma migrations on backend + bet
  seed            Run prisma:seed on backend + bet
  db-reset        DESTRUCTIVE: drop + re-migrate + re-seed both DBs
  db-dump         Dump both DBs to .\backups\
  test            Run backend + bet test suites
  lint            Lint the backend
  env             Ensure .env exists (copies from .env.example)
"@ | Write-Host
  }

  'env'      { Ensure-Env }
  'up'       { Ensure-Env; Invoke-Compose @('up','-d','--build'); Show-Endpoints }
  'up-prod'  { Ensure-Env; Invoke-ComposeProd @('up','-d','--build') }
  'worker'   { Ensure-Env; Invoke-Compose @('--profile','worker','up','-d','--build') }
  'down'     { Invoke-Compose @('down') }
  'stop'     { Invoke-Compose @('stop') }
  'start'    { Invoke-Compose @('start') }
  'restart'  { Invoke-Compose @('restart') }

  'clean' {
    $ans = Read-Host "About to remove ALL named volumes (postgres, redis, uploads, node_modules). Type 'yes' to continue"
    if ($ans -ne 'yes') { Write-Host "Aborted." -ForegroundColor Yellow; return }
    Invoke-Compose @('down','-v')
    Write-Host "Stack stopped, all volumes removed." -ForegroundColor Green
  }

  'build'    { Invoke-Compose @('build') }
  'rebuild'  { Invoke-Compose @('build','--no-cache','--pull') }
  'pull'     { Invoke-Compose @('pull') }
  'ps'      { Invoke-Compose @('ps') }
  'ports'   { Invoke-Compose @('ps','--format','table {{.Name}}\t{{.Status}}\t{{.Ports}}') }
  'logs'    { Invoke-Compose @('logs','-f','--tail=200') }

  'log' {
    if (-not $Arg1) { Write-Error "Usage: .\scripts\dev.ps1 log <service>"; exit 1 }
    Invoke-Compose @('logs','-f','--tail=200',$Arg1)
  }

  'shell' {
    if (-not $Arg1) { Write-Error "Usage: .\scripts\dev.ps1 shell <service>"; exit 1 }
    Invoke-Compose @('exec',$Arg1,'sh')
  }

  'psql' {
    $db = if ($Arg1) { $Arg1 } else { 'uniquebid' }
    $pgUser = $env:POSTGRES_USER; if (-not $pgUser) { $pgUser = 'kalki' }
    Invoke-Compose @('exec','postgres','psql','-U',$pgUser,'-d',$db)
  }

  'redis-cli' { Invoke-Compose @('exec','redis','redis-cli') }

  'migrate' {
    Invoke-Compose @('exec','backend','npx','prisma','migrate','deploy')
    Invoke-Compose @('exec','bet',    'npx','prisma','migrate','deploy')
  }

  'seed' {
    Invoke-Compose @('exec','backend','npm','run','prisma:seed')
    Invoke-Compose @('exec','bet',    'npm','run','prisma:seed')
  }

  'db-reset' {
    $ans = Read-Host "About to DROP the uniquebid and bet databases. Type 'yes' to continue"
    if ($ans -ne 'yes') { Write-Host "Aborted." -ForegroundColor Yellow; return }
    Invoke-Compose @('exec','backend','npx','prisma','migrate','reset','--force','--skip-generate')
    Invoke-Compose @('exec','bet',    'npx','prisma','migrate','reset','--force','--skip-generate')
    Write-Host "Both databases reset, re-migrated, and re-seeded." -ForegroundColor Green
  }

  'db-dump' {
    if (-not (Test-Path 'backups')) { New-Item -ItemType Directory backups | Out-Null }
    $ts = Get-Date -Format 'yyyyMMddTHHmmssZ' -AsUTC
    $pgUser = $env:POSTGRES_USER; if (-not $pgUser) { $pgUser = 'kalki' }
    foreach ($db in @('uniquebid','bet')) {
      $out = Join-Path 'backups' "$db-$ts.sql.gz"
      Write-Host "Dumping $db → $out"
      # PowerShell pipeline can't pipe binary cleanly; route through docker exec's stdout.
      docker compose -f $ComposeFile exec -T postgres pg_dump -U $pgUser -d $db | & gzip > $out
    }
  }

  'test' {
    Invoke-Compose @('exec','backend','npm','test')
    Invoke-Compose @('exec','bet',    'npm','test')
  }

  'lint' {
    Invoke-Compose @('exec','backend','npm','run','lint')
  }

  default {
    Write-Error "Unknown command: $Command. Run '.\scripts\dev.ps1 help' for usage."
    exit 1
  }
}
