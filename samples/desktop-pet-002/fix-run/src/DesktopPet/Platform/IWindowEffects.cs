namespace DesktopPet.Platform;

/// <summary>
/// OS依存のウィンドウ効果（クリック透過・フォーカス非奪取・最前面再アサート・
/// グローバルカーソル位置）の抽象。research.md §3・§4。
/// </summary>
public interface IWindowEffects
{
    /// <summary>クリック・ドラッグでもフォーカスを奪わないウィンドウにする（FR-008）。</summary>
    void ApplyNoActivate(nint windowHandle);

    /// <summary>クリック透過（マウスイベントを背後のアプリへ素通し）を切り替える（FR-007）。</summary>
    void SetClickThrough(nint windowHandle, bool enabled);

    /// <summary>グローバルカーソル位置（物理スクリーン座標）。取得不能なら false。</summary>
    bool TryGetCursorPosition(out double x, out double y);

    /// <summary>最前面を再アサートする（フォーカスは奪わない）（FR-002）。</summary>
    void AssertTopmost(nint windowHandle);

    /// <summary>
    /// 現在のスレッドが Per-Monitor DPI Aware V2 で動いているか。スクリーン座標が物理ピクセル座標と
    /// 一致する前提の確認に使う。判定できない環境（Windows 以外など）では null。
    /// </summary>
    bool? IsPerMonitorV2DpiAware();

    static IWindowEffects Create()
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsWindowEffects();
        }
        if (OperatingSystem.IsMacOS())
        {
            return new MacWindowEffects();
        }
        return new NullWindowEffects();
    }
}
