using Avalonia;

namespace DesktopPet;

public static class Program
{
    private static Mutex? _singleInstanceMutex;

    [STAThread]
    public static void Main(string[] args)
    {
        // FR-013: 多重起動の防止。Avalonia起動前に判定し、2つ目は静かに即終了する
        _singleInstanceMutex = new Mutex(
            initiallyOwned: true, "DesktopPet.SingleInstance", out var isFirstInstance);
        if (!isFirstInstance)
        {
            return;
        }

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        GC.KeepAlive(_singleInstanceMutex);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            // スクリーン座標（Win32 screen coordinates）が物理ピクセル座標と一致するのは、プロセスが
            // Per-Monitor DPI Aware V2 のときだけ。Avalonia の既定値に頼らず明示する
            // （specs/002-idle-run-pet-resize/contracts/coordinate-spaces.md §5）
            .With(new Win32PlatformOptions { DpiAwareness = Win32DpiAwareness.PerMonitorDpiAware })
            // macOS: Dockに表示せずアクセサリとして動作（タスクバー/Dock非表示・FR-009）
            .With(new MacOSPlatformOptions { ShowInDock = false })
            .LogToTrace();
}
