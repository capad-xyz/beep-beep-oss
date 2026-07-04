# _postboot-dockerup.ps1
# One-time post-reboot bring-up, invoked via a RunOnce entry after the next login.
# Wraps docker-up.ps1 with a transcript so the result can be checked afterwards.
$log = Join-Path $env:USERPROFILE 'docker-up-postboot.log'
try { Start-Transcript -Path $log -Force | Out-Null } catch {}
try { & (Join-Path $PSScriptRoot 'docker-up.ps1') } catch { Write-Host "postboot bring-up error: $($_.Exception.Message)" }
try { Stop-Transcript | Out-Null } catch {}
