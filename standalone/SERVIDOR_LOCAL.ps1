$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$listener = $null
$selectedPort = $null

foreach ($port in 4173..4190) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
        $candidate.Start()
        $listener = $candidate
        $selectedPort = $port
        break
    } catch {
        if ($candidate) {
            try { $candidate.Stop() } catch {}
        }
    }
}

if (-not $listener) {
    Write-Host "Nao foi possivel encontrar uma porta local livre." -ForegroundColor Red
    exit 1
}

$url = "http://127.0.0.1:$selectedPort/"
Write-Host ""
Write-Host "Pixel Island iniciado em:" -ForegroundColor Green
Write-Host $url -ForegroundColor Cyan
Write-Host ""
Write-Host "Nao feche esta janela enquanto estiver jogando."
Write-Host "Para encerrar, pressione Ctrl+C."
Write-Host ""

Start-Process $url

function Get-MimeType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.mjs'  { 'application/javascript; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.wasm' { 'application/wasm' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.gif'  { 'image/gif' }
        '.svg'  { 'image/svg+xml' }
        '.ico'  { 'image/x-icon' }
        '.webp' { 'image/webp' }
        '.mp3'  { 'audio/mpeg' }
        '.ogg'  { 'audio/ogg' }
        '.wav'  { 'audio/wav' }
        default { 'application/octet-stream' }
    }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader(
                $stream,
                [System.Text.Encoding]::ASCII,
                $false,
                8192,
                $true
            )

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                $client.Close()
                continue
            }

            do {
                $headerLine = $reader.ReadLine()
            } while ($headerLine -ne $null -and $headerLine -ne '')

            $parts = $requestLine.Split(' ')
            if ($parts.Count -lt 2 -or $parts[0] -ne 'GET') {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Metodo nao suportado')
                $header = "HTTP/1.1 405 Method Not Allowed`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($hb, 0, $hb.Length)
                $stream.Write($body, 0, $body.Length)
                continue
            }

            $requestPath = ($parts[1] -split '\?')[0]
            $requestPath = [System.Uri]::UnescapeDataString($requestPath)

            if ($requestPath -eq '/' -or [string]::IsNullOrWhiteSpace($requestPath)) {
                $relativePath = 'index.html'
            } else {
                $relativePath = $requestPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            }

            $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))

            if (-not $candidatePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('Acesso negado')
                $header = "HTTP/1.1 403 Forbidden`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($hb, 0, $hb.Length)
                $stream.Write($body, 0, $body.Length)
                continue
            }

            if ([System.IO.Directory]::Exists($candidatePath)) {
                $candidatePath = Join-Path $candidatePath 'index.html'
            }

            if (-not [System.IO.File]::Exists($candidatePath)) {
                $fallback = Join-Path $root 'index.html'
                if ([System.IO.File]::Exists($fallback)) {
                    $candidatePath = $fallback
                } else {
                    $body = [System.Text.Encoding]::UTF8.GetBytes('Arquivo nao encontrado')
                    $header = "HTTP/1.1 404 Not Found`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
                    $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($hb, 0, $hb.Length)
                    $stream.Write($body, 0, $body.Length)
                    continue
                }
            }

            $bytes = [System.IO.File]::ReadAllBytes($candidatePath)
            $mime = Get-MimeType $candidatePath
            $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $hb = [System.Text.Encoding]::ASCII.GetBytes($header)

            $stream.Write($hb, 0, $hb.Length)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush()
        } catch {
            Write-Host "Aviso: falha ao atender uma requisicao local: $($_.Exception.Message)" -ForegroundColor Yellow
        } finally {
            try { $client.Close() } catch {}
        }
    }
} finally {
    if ($listener) {
        try { $listener.Stop() } catch {}
    }
}
