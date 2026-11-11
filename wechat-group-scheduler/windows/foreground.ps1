# Called only when acquiring the window, before any search, paste or send.
# During an operation, Assert-Foreground still stops immediately on lost focus.
function Activate-WechatWindow($h) {
    for ($attempt=0; $attempt -lt 8; $attempt++) {
        if (-not [NativeWechat]::DesktopReady()) { throw 'Windows 桌面已锁定或不可操作，请先解锁' }
        if ([NativeWechat]::GetForegroundWindow() -ne $h) {
            [void][NativeWechat]::TryActivateWindow($h)
        }
        Start-Sleep -Milliseconds 200
        if (-not [NativeWechat]::DesktopReady()) { throw 'Windows 桌面已锁定或不可操作，请先解锁' }
        if ([NativeWechat]::GetForegroundWindow() -eq $h) { return }
    }
    throw '启动失败：Windows 未允许程序将微信切到前台。请先手动打开微信主窗口，再重试；微信和本程序需使用相同权限。这不表示你移动了鼠标，也未执行本次消息输入或发送'
}

function Assert-Foreground($h) {
    if (-not [NativeWechat]::DesktopReady()) { throw 'Windows 桌面已锁定或不可操作，已停止' }
    if ([NativeWechat]::GetForegroundWindow() -ne $h) {
        throw '操作过程中微信失去前台，已停止；可能被浏览器、通知或其他窗口切走，请核查微信中的草稿和发送结果'
    }
}
