# Offline test double: no user32 imports, actual windows, input or screenshots.
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type @'
using System;
public static class NativeWechat {
  public static bool Ready=true;
  public static IntPtr Foreground=new IntPtr(9);
  public static int Attempts=0;
  public static int SucceedAt=3;
  public static bool DesktopReady(){return Ready;}
  public static IntPtr GetForegroundWindow(){return Foreground;}
  public static bool TryActivateWindow(IntPtr h){Attempts++;if(Attempts>=SucceedAt)Foreground=h;return Foreground==h;}
}
'@
$script:lockOnWait=$false
function Start-Sleep([int]$Milliseconds) { if($script:lockOnWait){[NativeWechat]::Ready=$false} }
. (Join-Path $PSScriptRoot '..\windows\foreground.ps1')
function Reset-Case {
    [NativeWechat]::Ready=$true
    [NativeWechat]::Foreground=[IntPtr]9
    [NativeWechat]::Attempts=0
    [NativeWechat]::SucceedAt=3
    $script:lockOnWait=$false
}
function Assert-Case([bool]$condition,[string]$description){if(-not $condition){throw $description}}

Reset-Case
[NativeWechat]::Foreground=[IntPtr]42
Activate-WechatWindow ([IntPtr]42)
Assert-Case ([NativeWechat]::Attempts -eq 0) 'Already foreground must not reactivate'

Reset-Case
Activate-WechatWindow ([IntPtr]42)
Assert-Case ([NativeWechat]::Attempts -eq 3) 'Delayed foreground activation should recover'

Reset-Case
[NativeWechat]::SucceedAt=99
$denied=$false
try{Activate-WechatWindow ([IntPtr]42)}catch{$denied=$_.Exception.Message.StartsWith('启动失败：')}
Assert-Case ($denied -and [NativeWechat]::Attempts -eq 8) 'Denied activation must be bounded and explained'

Reset-Case
[NativeWechat]::Ready=$false
$locked=$false
try{Activate-WechatWindow ([IntPtr]42)}catch{$locked=$_.Exception.Message.Contains('桌面已锁定')}
Assert-Case ($locked -and [NativeWechat]::Attempts -eq 0) 'Locked desktop must not activate'

Reset-Case
$script:lockOnWait=$true
$lockedOnWait=$false
try{Activate-WechatWindow ([IntPtr]42)}catch{$lockedOnWait=$_.Exception.Message.Contains('桌面已锁定')}
Assert-Case ($lockedOnWait -and [NativeWechat]::Attempts -eq 1) 'Lock during activation must stop'

Reset-Case
$interrupted=$false
try{Assert-Foreground ([IntPtr]42)}catch{$interrupted=$_.Exception.Message.Contains('操作过程中微信失去前台')}
Assert-Case ($interrupted -and [NativeWechat]::Attempts -eq 0) 'Mid-operation interruption must stop without reactivation'
@{ok=$true;checks=6} | ConvertTo-Json -Compress
