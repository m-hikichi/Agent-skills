using System.Reflection;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using DesktopPet;
using DesktopPet.Animation;
using DesktopPet.Models;
using DesktopPet.Platform;
using DesktopPet.Services;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args) => AppBuilder.Configure<ProbeApp>()
        .UsePlatformDetect()
        .With(new Win32PlatformOptions { DpiAwareness = Win32DpiAwareness.PerMonitorDpiAware })
        .StartWithClassicDesktopLifetime(args);
}

public sealed class ProbeApp : Application
{
    public override void OnFrameworkInitializationCompleted()
    {
        var lifetime = (IClassicDesktopStyleApplicationLifetime)ApplicationLifetime!;
        lifetime.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        Dispatcher.UIThread.Post(async () => await Run(lifetime));
        base.OnFrameworkInitializationCompleted();
    }

    private static async Task Run(IClassicDesktopStyleApplicationLifetime lifetime)
    {
        PetWindow? window = null;
        var records = new List<object>();
        var output = Path.Combine(Directory.GetCurrentDirectory(), "results");
        Directory.CreateDirectory(output);
        var passed = false;
        try
        {
            // Use the production window and native effects; do not start App,
            // create its tray, or read/write the user's settings/log files.
            foreach (var pet in new[] { "genba-neko", "yoshi-cat" })
            {
                var atlas = $"C:/Users/m_hikichi/.codex/pets/{pet}/spritesheet.webp";
                if (!SpriteSheetLoader.TryLoad(atlas, out var sheet, out var error))
                    throw new InvalidOperationException(error);
                if (window is null)
                {
                    window = new PetWindow(sheet!, IWindowEffects.Create(), _ => { });
                    window.Position = new PixelPoint(600, 400);
                    window.ShowActivated = false;
                    window.Show();
                    await Task.Delay(400);
                }
                else window.SetSpriteSheet(sheet!);
                foreach (var scale in new[] { CharacterScale.Small, CharacterScale.Medium, CharacterScale.Large, CharacterScale.XLarge })
                {
                    window.SetScale(scale);
                    await Task.Delay(150);
                    var engine = (AnimationEngine)typeof(PetWindow).GetField("_engine", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(window)!;
                    var frames = new HashSet<int>();
                    var startPosition = window.Position;
                    for (var n = 0; n < 12; n++)
                    {
                        frames.Add(engine.FrameIndex);
                        await Task.Delay(100);
                    }
                    var expected = CharacterLayout.SizeDip(scale);
                    var sizeMatches = Math.Abs(window.Bounds.Width - expected.Width) < 0.01
                        && Math.Abs(window.Bounds.Height - expected.Height) < 0.01;
                    var native = window.TryGetPlatformHandle() is { Handle: var handle } && handle != IntPtr.Zero;
                    var stable = window.Position == startPosition;
                    var animated = frames.Count > 1;
                    var png = $"{pet}-{scale}.png";
                    using (var bitmap = new RenderTargetBitmap(new PixelSize((int)expected.Width, (int)expected.Height), new Vector(96, 96)))
                    {
                        bitmap.Render(window);
                        bitmap.Save(Path.Combine(output, png));
                    }
                    records.Add(new { pet, scale = scale.ToString(), nativeWindow = native, width = window.Bounds.Width,
                        height = window.Bounds.Height, renderScaling = window.RenderScaling, sizeMatches,
                        framesObserved = frames.Order().ToArray(), animated, stable, png,
                        passed = native && sizeMatches && animated && stable });
                    if (!(native && sizeMatches && animated && stable))
                        throw new InvalidOperationException($"Runtime check failed: {pet}/{scale}");
                }
            }
            passed = true;
        }
        catch (Exception ex)
        {
            records.Add(new { error = ex.ToString() });
        }
        finally
        {
            window?.Close();
            File.WriteAllText(Path.Combine(output, "runtime.json"), JsonSerializer.Serialize(new {
                executedAt = DateTimeOffset.Now, passed, records,
                scope = "Production PetWindow in native Avalonia loop; no App/tray/settings startup, no mouse injection, no OS DPI change, no 8-hour test",
                images = "Control renders, not full-desktop screenshots"
            }, new JsonSerializerOptions { WriteIndented = true }));
            lifetime.Shutdown(passed ? 0 : 1);
        }
    }
}
