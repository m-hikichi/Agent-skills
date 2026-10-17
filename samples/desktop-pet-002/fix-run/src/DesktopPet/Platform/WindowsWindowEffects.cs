using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace DesktopPet.Platform;

/// <summary>
/// Win32実装。WS_EX_TRANSPARENT でクリック透過、WS_EX_NOACTIVATE でフォーカス非奪取、
/// SetWindowPos(HWND_TOPMOST) で最前面再アサートを行う。
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsWindowEffects : IWindowEffects
{
    private const int GWL_EXSTYLE = -20;
    private const nint WS_EX_TRANSPARENT = 0x00000020;
    private const nint WS_EX_TOOLWINDOW = 0x00000080;
    private const nint WS_EX_LAYERED = 0x00080000;
    private const nint WS_EX_NOACTIVATE = 0x08000000;

    private static readonly nint HWND_TOPMOST = -1;
    private static readonly nint DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;

    public void ApplyNoActivate(nint windowHandle)
    {
        var style = GetWindowLongPtrW(windowHandle, GWL_EXSTYLE);
        SetWindowLongPtrW(windowHandle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
    }

    public void SetClickThrough(nint windowHandle, bool enabled)
    {
        var style = GetWindowLongPtrW(windowHandle, GWL_EXSTYLE);
        var newStyle = enabled
            ? style | WS_EX_TRANSPARENT | WS_EX_LAYERED
            : style & ~WS_EX_TRANSPARENT;
        if (newStyle != style)
        {
            SetWindowLongPtrW(windowHandle, GWL_EXSTYLE, newStyle);
        }
    }

    public bool TryGetCursorPosition(out double x, out double y)
    {
        if (GetCursorPos(out var point))
        {
            x = point.X;
            y = point.Y;
            return true;
        }
        x = y = 0;
        return false;
    }

    public void AssertTopmost(nint windowHandle)
    {
        SetWindowPos(windowHandle, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    public bool? IsPerMonitorV2DpiAware()
    {
        try
        {
            return AreDpiAwarenessContextsEqual(
                GetThreadDpiAwarenessContext(), DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        catch (EntryPointNotFoundException)
        {
            // Windows 10 1607 より前にはこの API がない（判定不能）
            return null;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern nint GetWindowLongPtrW(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern nint SetWindowLongPtrW(nint hWnd, int nIndex, nint dwNewLong);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern nint GetThreadDpiAwarenessContext();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AreDpiAwarenessContextsEqual(nint dpiContextA, nint dpiContextB);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        nint hWnd, nint hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
}
