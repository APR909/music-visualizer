try {
    $r = Invoke-WebRequest -Uri "https://api.github.com/repos/APR909/music-visualizer/pages" -UseBasicParsing -ErrorAction Stop
    Write-Output ("PAGES API STATUS: " + $r.StatusCode)
    Write-Output $r.Content
} catch {
    Write-Output ("PAGES API ERROR: " + $_.Exception.Message)
}

try {
    $r2 = Invoke-WebRequest -Uri "https://apr909.github.io/music-visualizer/" -UseBasicParsing -ErrorAction Stop
    Write-Output ("SITE STATUS: " + $r2.StatusCode)
    Write-Output ("First 150 chars: " + $r2.Content.Substring(0, [Math]::Min(150, $r2.Content.Length)))
} catch {
    Write-Output ("SITE ERROR: " + $_.Exception.Message)
}
