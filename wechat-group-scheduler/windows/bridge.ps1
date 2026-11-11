param([ValidateSet('capture','bind','send','checkDraft')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Collections.Generic;
public static class NativeWechat {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint processId);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h,int n,StringBuilder b,int l,out int needed);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
  public static bool DesktopReady() {
    IntPtr h=OpenInputDesktop(0,false,1); if(h==IntPtr.Zero)return false;
    try {var b=new StringBuilder(256);int n;return GetUserObjectInformation(h,2,b,512,out n)&&b.ToString()=="Default";}
    finally{CloseDesktop(h);}
  }
  public static bool TryActivateWindow(IntPtr h) {
    if(GetForegroundWindow()==h)return true;
    SetForegroundWindow(h);
    if(GetForegroundWindow()==h)return true;
    // Background-launched PowerShell may be denied foreground activation.
    // Share the current foreground input queue briefly; never inject Alt or click another app.
    uint processId;
    uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out processId);
    uint currentThread=GetCurrentThreadId();
    bool attached=foregroundThread!=0&&foregroundThread!=currentThread&&AttachThreadInput(currentThread,foregroundThread,true);
    try {BringWindowToTop(h);SetForegroundWindow(h);}
    finally {if(attached)AttachThreadInput(currentThread,foregroundThread,false);}
    return GetForegroundWindow()==h;
  }
  public static Bitmap Capture(IntPtr h) {
    RECT r;if(!GetWindowRect(h,out r))throw new Exception("Cannot read window rectangle");
    var b=new Bitmap(r.Right-r.Left,r.Bottom-r.Top,PixelFormat.Format32bppArgb);
    using(var g=Graphics.FromImage(b)){g.CopyFromScreen(r.Left,r.Top,0,0,b.Size);}
    return b;
  }
  public static string Hash(Bitmap source, int x,int y,int width,int height) {
    using(var b=source.Clone(new Rectangle(x,y,width,height),PixelFormat.Format32bppArgb)) {
      var d=b.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      try {byte[] bytes=new byte[Math.Abs(d.Stride)*height];Marshal.Copy(d.Scan0,bytes,0,bytes.Length);
        using(var sha=SHA256.Create()){return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");}}
      finally{b.UnlockBits(d);}
    }
  }
  // Permit one narrow caret at the beginning of an otherwise blank editor.
  public static int[] BlankBackground(Bitmap source,int x,int y,int width,int height) {
    using(var b=source.Clone(new Rectangle(x,y,width,height),PixelFormat.Format32bppArgb)) {
      var d=b.LockBits(new Rectangle(0,0,width,height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      byte[] bytes=new byte[Math.Abs(d.Stride)*height];
      try {Marshal.Copy(d.Scan0,bytes,0,bytes.Length);} finally {b.UnlockBits(d);}
      int stride=bytes.Length/height;
      int margin=width>8&&height>8?2:0;
      var colors=new Dictionary<int,int>();int dominant=0,maxCount=0;
      for(int py=margin;py<height-margin;py++)for(int px=margin;px<width-margin;px++) {
        int p=py*stride+px*4;int rgb=(bytes[p+2]<<16)|(bytes[p+1]<<8)|bytes[p];
        int count;colors.TryGetValue(rgb,out count);colors[rgb]=++count;
        if(count>maxCount){maxCount=count;dominant=rgb;}
      }
      int red=(dominant>>16)&255,green=(dominant>>8)&255,blue=dominant&255;
      var foreground=new bool[width*height];
      for(int py=margin;py<height-margin;py++)for(int px=margin;px<width-margin;px++) {
        int p=py*stride+px*4;
        foreground[py*width+px]=Math.Abs(bytes[p+2]-red)>12||Math.Abs(bytes[p+1]-green)>12||Math.Abs(bytes[p]-blue)>12;
      }
      int components=0;
      var queue=new Queue<int>();
      for(int n=0;n<foreground.Length;n++) {
        if(!foreground[n])continue;
        if(++components>1)return null;
        int minX=width,maxX=0,minY=height,maxY=0,size=0;
        queue.Enqueue(n);foreground[n]=false;
        while(queue.Count>0) {
          int current=queue.Dequeue(),cx=current%width,cy=current/width;
          minX=Math.Min(minX,cx);maxX=Math.Max(maxX,cx);minY=Math.Min(minY,cy);maxY=Math.Max(maxY,cy);size++;
          for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++) {
            int nx=cx+dx,ny=cy+dy;
            if(nx<0||nx>=width||ny<0||ny>=height)continue;
            int next=ny*width+nx;
            if(foreground[next]){foreground[next]=false;queue.Enqueue(next);}
          }
        }
        int w=maxX-minX+1,h=maxY-minY+1;
        if(w>3||h<8||h>64||h<w*4||minX>32||minY>24||size*4<w*h*3)return null;
      }
      return new int[]{red,green,blue};
    }
  }
  public static bool IsBlank(Bitmap source,int x,int y,int width,int height,int[] reference) {
    int[] actual=BlankBackground(source,x,y,width,height);
    if(actual==null||reference==null||reference.Length!=3)return false;
    for(int i=0;i<3;i++)if(Math.Abs(actual[i]-reference[i])>6)return false;
    return true;
  }
}
'@ -ReferencedAssemblies System.Drawing
    [void][NativeWechat]::SetProcessDPIAware()
    . (Join-Path $PSScriptRoot 'foreground.ps1')

    function Get-WechatWindow {
        if (-not [NativeWechat]::DesktopReady()) { throw 'Windows 桌面已锁定或不可操作，请先解锁' }
        $candidates = @(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Where-Object {
            if ($_.MainWindowHandle -eq 0) { return $false }
            $r = New-Object NativeWechat+RECT
            [void][NativeWechat]::GetWindowRect($_.MainWindowHandle,[ref]$r)
            return ($r.Right-$r.Left -ge 500 -and $r.Bottom-$r.Top -ge 350)
        })
        if ($candidates.Count -ne 1) { throw "需要唯一的微信主窗口，当前找到 $($candidates.Count) 个；请登录微信并关闭多余微信窗口" }
        $h = $candidates[0].MainWindowHandle
        if ([NativeWechat]::IsIconic($h)) { [void][NativeWechat]::ShowWindow($h,9) }
        Activate-WechatWindow $h
        return $h
    }
    function Click-Point($h,$point) {
        Assert-Foreground $h
        $r=New-Object NativeWechat+RECT
        [void][NativeWechat]::GetWindowRect($h,[ref]$r)
        if (-not [NativeWechat]::SetCursorPos($r.Left+[int]$point.x,$r.Top+[int]$point.y)) { throw '无法定位鼠标，已停止' }
        Assert-Foreground $h
        [NativeWechat]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        [NativeWechat]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    }
    function Move-PointerAway($h) {
        Assert-Foreground $h
        $r=New-Object NativeWechat+RECT
        if(-not [NativeWechat]::GetWindowRect($h,[ref]$r)){throw '无法读取微信窗口位置'}
        # Move to the upper-left window border without clicking or changing focus.
        # This clears the editor's hover-only voice-input hint and pointer effects.
        if(-not [NativeWechat]::SetCursorPos($r.Left+8,$r.Top+8)){throw '无法将鼠标移出输入框，请重新尝试截图'}
        Start-Sleep -Milliseconds 900
        Assert-Foreground $h
    }
    function Get-RegionHash($bitmap,$rect) {
        return [NativeWechat]::Hash($bitmap,[int]$rect.x,[int]$rect.y,[int]$rect.width,[int]$rect.height)
    }
    function Assert-Identity($h,$layout,$binding,[bool]$CheckDraft) {
        Move-PointerAway $h
        $screen=[NativeWechat]::Capture($h)
        try {
            if ($screen.Width -ne $layout.width -or $screen.Height -ne $layout.height) { throw '微信窗口尺寸与校准不一致，请恢复尺寸或重新校准' }
            if ((Get-RegionHash $screen $layout.title) -cne $binding.titleHash) { throw '群标题图像与绑定记录不一致，已停止。请检查群名、搜索结果、遮挡或重新校准' }
            if ($CheckDraft) {
                if ($binding.draftProfile -and $binding.draftProfile.version -eq 1) {
                    $r=$layout.draft
                    $blank=[NativeWechat]::IsBlank($screen,[int]$r.x,[int]$r.y,[int]$r.width,[int]$r.height,[int[]]$binding.draftProfile.background)
                    if(-not $blank){throw '鼠标移开后输入区仍有文字、提示或界面变化，已停止。请确认没有草稿，并让“长按鼠标 语音输入”提示消失后重新截图绑定；蓝框只框文字编辑区'}
                } elseif ((Get-RegionHash $screen $layout.draft) -cne $binding.draftHash) {
                    throw '当前群使用旧版空白校验，可能受光标闪烁影响。请清空输入框，重新获取截图并保存这个群的绑定，再测试单群发送'
                }
            }
        } finally { $screen.Dispose() }
    }

    switch ($Action) {
        'capture' {
            $h=Get-WechatWindow
            Move-PointerAway $h
            $image=[NativeWechat]::Capture($h)
            $stream=New-Object System.IO.MemoryStream
            try {
                $image.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
                $result=@{ok=$true;width=$image.Width;height=$image.Height;png=[Convert]::ToBase64String($stream.ToArray())}
            } finally {$stream.Dispose();$image.Dispose()}
        }
        'bind' {
            # Operates only on the screenshot explicitly reviewed in the local page.
            $bytes=[Convert]::FromBase64String($request.png)
            $stream=New-Object System.IO.MemoryStream(,$bytes)
            $image=[System.Drawing.Bitmap]::FromStream($stream)
            try {
                if($image.Width -ne $request.layout.width -or $image.Height -ne $request.layout.height){throw '截图尺寸不一致'}
                $r=$request.layout.draft
                $background=[NativeWechat]::BlankBackground($image,[int]$r.x,[int]$r.y,[int]$r.width,[int]$r.height)
                if($null -eq $background){throw '无法确认输入框为空：截图中可能有草稿或“长按鼠标 语音输入”悬停提示。保存不会更新旧截图，请点击“获取微信截图”，等程序移开鼠标并获取新图后再保存；蓝框只框文字编辑区'}
                $result=@{ok=$true;titleHash=(Get-RegionHash $image $request.layout.title);draftHash=(Get-RegionHash $image $request.layout.draft);draftProfile=@{version=1;background=@($background)}}
            }finally{$image.Dispose();$stream.Dispose()}
        }
        'checkDraft' {
            # Offline diagnostic: no screenshots, mouse actions or keyboard input.
            $checks=@(foreach($png in $request.images){
                $bytes=[Convert]::FromBase64String($png)
                $stream=New-Object System.IO.MemoryStream(,$bytes)
                $image=[System.Drawing.Bitmap]::FromStream($stream)
                try{
                    $r=$request.draft
                    [NativeWechat]::IsBlank($image,[int]$r.x,[int]$r.y,[int]$r.width,[int]$r.height,[int[]]$request.background)
                }finally{$image.Dispose();$stream.Dispose()}
            })
            $result=@{ok=$true;checks=$checks}
        }
        'send' {
            $h=Get-WechatWindow
            $layout=$request.layout
            $binding=$request.binding
            $before=[NativeWechat]::Capture($h)
            try { if($before.Width -ne $layout.width -or $before.Height -ne $layout.height){throw '窗口尺寸变化，请重新校准'} }
            finally{$before.Dispose()}
            # All user text travels through Unicode clipboard, never through SendKeys syntax.
            Assert-Foreground $h
            [System.Windows.Forms.SendKeys]::SendWait('^f')
            Start-Sleep -Milliseconds 350
            Assert-Foreground $h
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            [System.Windows.Forms.Clipboard]::SetText([string]$request.group)
            [System.Windows.Forms.SendKeys]::SendWait('^v')
            Start-Sleep -Milliseconds 1500
            Assert-Foreground $h
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            Start-Sleep -Milliseconds 1500
            Click-Point $h $layout.neutral
            Start-Sleep -Milliseconds 250
            Assert-Identity $h $layout $binding $true
            Start-Sleep -Milliseconds 150
            Assert-Identity $h $layout $binding $true
            Click-Point $h $layout.editor
            Move-PointerAway $h
            Assert-Foreground $h
            [System.Windows.Forms.Clipboard]::SetText([string]$request.message)
            [System.Windows.Forms.SendKeys]::SendWait('^v')
            Start-Sleep -Milliseconds 200
            Assert-Foreground $h
            # Verify the editor contains precisely the requested message before clicking Send.
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            [System.Windows.Forms.Clipboard]::SetText('__WECHAT_COPY_CHECK__')
            [System.Windows.Forms.SendKeys]::SendWait('^c')
            Start-Sleep -Milliseconds 200
            $actual=[System.Windows.Forms.Clipboard]::GetText().Replace("`r`n","`n")
            $expected=([string]$request.message).Replace("`r`n","`n")
            if($actual -cne $expected){throw '输入内容校验失败，已停止；请检查微信中的草稿'}
            Assert-Identity $h $layout $binding $false
            Click-Point $h $layout.send
            Start-Sleep -Milliseconds 650
            Click-Point $h $layout.neutral
            Start-Sleep -Milliseconds 150
            Assert-Identity $h $layout $binding $true
            $result=@{ok=$true;status='submitted_unverified'}
        }
    }
    $result | ConvertTo-Json -Compress -Depth 8
} catch {
    @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
