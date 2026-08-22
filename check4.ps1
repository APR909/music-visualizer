try {
    $r = Invoke-WebRequest -Uri "https://api.github.com/repos/APR909/music-visualizer" -UseBasicParsing -ErrorAction Stop
    $json = $r.Content | ConvertFrom-Json
    Write-Output ("REPO STATUS: " + $r.StatusCode)
    Write-Output ("private: " + $json.private)
    Write-Output ("visibility: " + $json.visibility)
    Write-Output ("has_pages: " + $json.has_pages)
    Write-Output ("default_branch: " + $json.default_branch)
} catch {
    Write-Output ("REPO ERROR: " + $_.Exception.Message)
}
