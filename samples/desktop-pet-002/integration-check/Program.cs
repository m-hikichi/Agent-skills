using System.Reflection;
using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;
using DesktopPet;
using DesktopPet.Models;
using DesktopPet.Platform;
using DesktopPet.Services;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args) => AppBuilder.Configure<IntegrationApp>().UsePlatformDetect()
        .StartWithClassicDesktopLifetime(args);
}

public sealed class IntegrationApp : App
{
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    void Set(string name, object value) => typeof(App).GetField(name, Private)!.SetValue(this, value);
    object? Call(string name, params object[] args) => typeof(App).GetMethod(name, Private)!.Invoke(this, args);
    public override void OnFrameworkInitializationCompleted()
    {
        // Deliberately bypass normal startup: never use the real user's settings or diagnostics.
        var lifetime = (IClassicDesktopStyleApplicationLifetime)ApplicationLifetime!;
        lifetime.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        Dispatcher.UIThread.Post(async () => await Run(lifetime));
    }
    async Task Run(IClassicDesktopStyleApplicationLifetime lifetime)
    {
        var output = Path.Combine(Directory.GetCurrentDirectory(), "results");
        Directory.CreateDirectory(output);
        var checks = new List<object>();
        PetWindow? window = null;
        bool passed = false;
        void Check(string name, bool ok) { checks.Add(new { name, passed = ok }); if (!ok) throw new Exception(name); }
        try
        {
            var service = new SettingsService(Path.Combine(output, "isolated-settings.json"));
            var catalog = PetDiscoveryService.Discover(["C:/Users/m_hikichi/.codex/pets"]);
            Check("two installed pets discovered", catalog.Packages.Count == 2);
            var first = catalog.Packages[0];
            Check("initial sheet loads", SpriteSheetLoader.TryLoad(first.AtlasPath, out var sheet, out _));
            Set("_settingsService", service);
            Set("_settings", new AppSettings { SelectedPetId = first.Id });
            Set("_catalog", catalog); Set("_currentPackage", first);
            window = new PetWindow(sheet!, IWindowEffects.Create(), p => Call("OnPetPositionChanged", p));
            Set("_petWindow", window);
            window.Position = new PixelPoint(600, 400); window.ShowActivated = false; window.Show();
            await Task.Delay(200);
            foreach (var pet in catalog.Packages)
            {
                var before = window.Position;
                Call("SwitchPet", pet);
                Check($"{pet.Id}: switch retains position", before == window.Position);
                foreach (var scale in CharacterScales.All)
                {
                    Call("ChangeScale", scale);
                    await Task.Delay(50);
                    Call("PersistState");
                    var saved = new SettingsService(service.FilePath).Load();
                    Check($"{pet.Id}/{scale}: saved pet size position", saved.SelectedPetId == pet.Id && saved.ScalePercent == scale.Percent()
                        && saved.PositionX == window.Position.X && saved.PositionY == window.Position.Y);
                    var menu = (NativeMenu)Call("BuildTrayMenu")!;
                    var sizeMenu = menu.Items.OfType<NativeMenuItem>().Single(x => x.Header == "サイズ").Menu!;
                    var items = sizeMenu.Items.OfType<NativeMenuItem>().ToArray();
                    Check($"{pet.Id}/{scale}: menu labels and single selection", items.Select(x => x.Header).SequenceEqual(CharacterScales.All.Select(x => x.Label()))
                        && items.Count(x => x.IsChecked) == 1 && items.Single(x => x.IsChecked).Header == scale.Label());
                    var petMenu = menu.Items.OfType<NativeMenuItem>().Single(x => x.Header == "ペット").Menu!;
                    Check($"{pet.Id}/{scale}: pet selection", petMenu.Items.OfType<NativeMenuItem>().Count(x => x.IsChecked) == 1
                        && petMenu.Items.OfType<NativeMenuItem>().Single(x => x.IsChecked).Header == pet.DisplayName);
                    Set("_settings", saved);
                    var restored = new PetWindow(sheet!, IWindowEffects.Create(), _ => {}, CharacterScales.FromPercent(saved.ScalePercent));
                    Call("PositionWindow", restored, scale);
                    Check($"{pet.Id}/{scale}: position restored into new window", restored.Position == window.Position && restored.Scale == scale);
                    restored.Close();
                }
            }
            passed = true;
        }
        catch (Exception ex) { checks.Add(new { error = ex.ToString() }); }
        finally
        {
            window?.Close();
            File.WriteAllText(Path.Combine(output, "integration.json"), JsonSerializer.Serialize(new { executedAt = DateTimeOffset.Now, passed, checks,
                scope = "Production App methods invoked by reflection, native PetWindow, isolated settings; no physical tray clicks, no process restart, no DPI changes, no 8-hour test" }, new JsonSerializerOptions { WriteIndented = true }));
            lifetime.Shutdown(passed ? 0 : 1);
        }
    }
}
