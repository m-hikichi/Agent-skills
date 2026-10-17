namespace DesktopPet.Platform;

/// <summary>未対応OS向けのno-op実装（アプリは機能制限付きで動作する）。</summary>
public sealed class NullWindowEffects : IWindowEffects
{
    public void ApplyNoActivate(nint windowHandle)
    {
    }

    public void SetClickThrough(nint windowHandle, bool enabled)
    {
    }

    public bool TryGetCursorPosition(out double x, out double y)
    {
        x = y = 0;
        return false;
    }

    public void AssertTopmost(nint windowHandle)
    {
    }

    public bool? IsPerMonitorV2DpiAware() => null;
}
