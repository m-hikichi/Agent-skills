using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace DesktopPet.Platform;

/// <summary>
/// macOS実装（ベストエフォート・本リポジトリのWindows環境では未検証）。
/// NSWindow.ignoresMouseEvents でクリック透過を切り替える。
/// フォーカス非奪取は MacOSPlatformOptions のアクセサリ化（Program.cs）に委ねる。
/// </summary>
[SupportedOSPlatform("macos")]
public sealed class MacWindowEffects : IWindowEffects
{
    private const string LibObjC = "/usr/lib/libobjc.A.dylib";
    private const string CoreGraphics =
        "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";
    private const string CoreFoundation =
        "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

    private static readonly nint SelWindow = sel_registerName("window");
    private static readonly nint SelSetIgnoresMouseEvents = sel_registerName("setIgnoresMouseEvents:");
    private static readonly nint SelIsKindOfClass = sel_registerName("isKindOfClass:");
    private static readonly nint ClassNSView = objc_getClass("NSView");

    public void ApplyNoActivate(nint windowHandle)
    {
        // macOSでは Program.cs の MacOSPlatformOptions（Dock非表示・アクセサリ化）で対応
    }

    public void SetClickThrough(nint windowHandle, bool enabled)
    {
        try
        {
            var nsWindow = ResolveNSWindow(windowHandle);
            if (nsWindow != 0)
            {
                objc_msgSend_void_bool(nsWindow, SelSetIgnoresMouseEvents, enabled);
            }
        }
        catch
        {
            // ベストエフォート: 失敗してもアプリは継続する
        }
    }

    public bool TryGetCursorPosition(out double x, out double y)
    {
        x = y = 0;
        try
        {
            var ev = CGEventCreate(0);
            if (ev == 0)
            {
                return false;
            }
            var location = CGEventGetLocation(ev);
            CFRelease(ev);
            x = location.X;
            y = location.Y;
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void AssertTopmost(nint windowHandle)
    {
        // Avalonia の Topmost=true に委ねる（macOSでは奪い合いが起きにくい）
    }

    public bool? IsPerMonitorV2DpiAware() => null;

    /// <summary>AvaloniaのハンドルはNSViewまたはNSWindowの場合がある。NSWindowへ解決する。</summary>
    private static nint ResolveNSWindow(nint handle)
    {
        if (handle == 0)
        {
            return 0;
        }
        if (ClassNSView != 0 && objc_msgSend_bool_ptr(handle, SelIsKindOfClass, ClassNSView))
        {
            return objc_msgSend_ptr(handle, SelWindow);
        }
        return handle;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CGPoint
    {
        public double X;
        public double Y;
    }

    [DllImport(LibObjC)]
    private static extern nint sel_registerName(string name);

    [DllImport(LibObjC)]
    private static extern nint objc_getClass(string name);

    [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
    private static extern nint objc_msgSend_ptr(nint receiver, nint selector);

    [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static extern bool objc_msgSend_bool_ptr(nint receiver, nint selector, nint arg);

    [DllImport(LibObjC, EntryPoint = "objc_msgSend")]
    private static extern void objc_msgSend_void_bool(
        nint receiver, nint selector, [MarshalAs(UnmanagedType.I1)] bool arg);

    [DllImport(CoreGraphics)]
    private static extern nint CGEventCreate(nint source);

    [DllImport(CoreGraphics)]
    private static extern CGPoint CGEventGetLocation(nint @event);

    [DllImport(CoreFoundation)]
    private static extern void CFRelease(nint cf);
}
