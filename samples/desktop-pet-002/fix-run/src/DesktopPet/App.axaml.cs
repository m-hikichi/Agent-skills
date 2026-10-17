using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using DesktopPet.Models;
using DesktopPet.Platform;
using DesktopPet.Services;

namespace DesktopPet;

public partial class App : Application
{
    private SettingsService _settingsService = null!;
    private AppSettings _settings = new();
    private PetCatalog? _catalog;
    private PetPackage? _currentPackage;
    private PetWindow? _petWindow;
    private TrayIcon? _trayIcon;
    private IClassicDesktopStyleApplicationLifetime? _desktop;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is not IClassicDesktopStyleApplicationLifetime desktop)
        {
            base.OnFrameworkInitializationCompleted();
            return;
        }

        _desktop = desktop;
        desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;

        // 多重起動の防止（FR-013）は Program.Main で Avalonia 起動前に判定済み

        _settingsService = new SettingsService();
        _settings = _settingsService.Load();

        var roots = PetDiscoveryService.GetDefaultRoots();
        _catalog = PetDiscoveryService.Discover(roots);
        foreach (var error in _catalog.Errors)
        {
            DiagnosticsLog.Write($"discovery: {error.Path}: {error.Reason}");
        }

        // 前回選択したペットを優先しつつ、読み込めるパッケージを探す
        var loadErrors = new List<DiscoveryError>(_catalog.Errors);
        SpriteSheet? sheet = null;
        PetPackage? chosen = null;
        foreach (var package in OrderBySelection(_catalog.Packages, _settings.SelectedPetId))
        {
            if (SpriteSheetLoader.TryLoad(package.AtlasPath, out var loaded, out var loadError))
            {
                sheet = loaded;
                chosen = package;
                break;
            }
            loadErrors.Add(new DiscoveryError(package.DirectoryPath, loadError!));
            DiagnosticsLog.Write($"load: {package.DirectoryPath}: {loadError}");
        }

        if (sheet is null || chosen is null)
        {
            // FR-012: 配置先を案内して正常終了（クラッシュ・通知なし）
            DiagnosticsLog.Write("startup: no loadable pet package; showing guidance window");
            var guidance = new GuidanceWindow(roots, loadErrors);
            guidance.Closed += (_, _) => desktop.Shutdown();
            guidance.Show();
            base.OnFrameworkInitializationCompleted();
            return;
        }

        _currentPackage = chosen;
        DiagnosticsLog.Write($"startup: showing pet '{chosen.Id}' from {chosen.DirectoryPath}");
        var effects = IWindowEffects.Create();
        if (effects.IsPerMonitorV2DpiAware() == false)
        {
            // スクリーン座標＝物理ピクセル座標の前提が崩れている（exe の高DPI設定の上書きなど）
            DiagnosticsLog.Write(
                "startup: WARNING process is not Per-Monitor V2 DPI aware; " +
                "screen coordinates may be virtualized and the pet may be misplaced");
        }
        // 保存値がない・4段階以外の値なら Medium（002 FR-016）
        var scale = CharacterScales.FromPercent(_settings.ScalePercent);
        _petWindow = new PetWindow(sheet, effects, OnPetPositionChanged, scale);
        PositionWindow(_petWindow, scale);
        _petWindow.Show();

        SetupTrayIcon(sheet);

        desktop.ShutdownRequested += (_, _) => PersistState();
        base.OnFrameworkInitializationCompleted();
    }

    private static IEnumerable<PetPackage> OrderBySelection(
        IReadOnlyList<PetPackage> packages, string? selectedId)
    {
        if (selectedId is not null)
        {
            foreach (var package in packages.Where(p =>
                         string.Equals(p.Id, selectedId, StringComparison.OrdinalIgnoreCase)))
            {
                yield return package;
            }
        }
        foreach (var package in packages.Where(p =>
                     !string.Equals(p.Id, selectedId, StringComparison.OrdinalIgnoreCase)))
        {
            yield return package;
        }
    }

    /// <summary>初回はプライマリ作業領域の右下、以降は保存位置（クランプ付き）に配置する（FR-016）。</summary>
    private void PositionWindow(PetWindow window, CharacterScale scale)
    {
        var screens = window.Screens;
        var primary = screens.Primary ?? screens.All.FirstOrDefault();
        if (primary is null)
        {
            return;
        }

        // 既定位置はプライマリの表示倍率で求めた寸法を使う
        var primaryBounds = CharacterLayout.BoundsFromTopLeft(default, scale, primary.Scaling);
        var topLeft = CharacterLayout.DefaultTopLeft(ToScreenRect(primary.WorkingArea), primaryBounds);

        if (_settings.PositionX is { } savedX && _settings.PositionY is { } savedY)
        {
            // 保存位置の点を含むモニタの表示倍率で寸法を求める（プライマリの倍率を流用しない）
            var savedTopLeft = new ScreenPoint(savedX, savedY);
            var (savedPixelX, savedPixelY) = CharacterLayout.RoundToPixel(savedTopLeft);
            var target = screens.ScreenFromPoint(new PixelPoint(savedPixelX, savedPixelY)) ?? primary;
            var bounds = CharacterLayout.BoundsFromTopLeft(savedTopLeft, scale, target.Scaling);

            var workAreas = screens.All.Select(s => ToScreenRect(s.WorkingArea)).ToList();
            topLeft = CharacterLayout.ClampTopLeft(bounds, workAreas, fallback: topLeft);
        }

        var (pixelX, pixelY) = CharacterLayout.RoundToPixel(topLeft);
        window.Position = new PixelPoint(pixelX, pixelY);
    }

    private static ScreenRect ToScreenRect(PixelRect rect) =>
        new(rect.X, rect.Y, rect.Width, rect.Height);

    private void OnPetPositionChanged(PixelPoint position)
    {
        _settings = _settings with { PositionX = position.X, PositionY = position.Y };
        if (!_settingsService.TrySave(_settings, out var error))
        {
            DiagnosticsLog.Write($"settings: save failed: {error}");
        }
    }

    // ---- トレイ常駐（FR-009 / FR-011） ----

    private void SetupTrayIcon(SpriteSheet sheet)
    {
        _trayIcon = new TrayIcon
        {
            ToolTipText = "Desktop Pet",
            Icon = CreateTrayIconImage(sheet),
            Menu = BuildTrayMenu(),
        };
        TrayIcon.SetIcons(this, [_trayIcon]);
    }

    private NativeMenu BuildTrayMenu()
    {
        var menu = new NativeMenu();

        if (_catalog is not null && _catalog.Packages.Count > 1)
        {
            var petsItem = new NativeMenuItem("ペット") { Menu = new NativeMenu() };
            foreach (var package in _catalog.Packages)
            {
                var item = new NativeMenuItem(package.DisplayName)
                {
                    ToggleType = NativeMenuItemToggleType.Radio,
                    IsChecked = string.Equals(package.Id, _currentPackage?.Id, StringComparison.OrdinalIgnoreCase),
                };
                var captured = package;
                item.Click += (_, _) => SwitchPet(captured);
                petsItem.Menu.Items.Add(item);
            }
            menu.Items.Add(petsItem);
        }

        // サイズはペットが1体だけでも常に表示する（002 contracts/tray-menu.md）
        var currentScale = _petWindow?.Scale ?? CharacterScale.Medium;
        var sizeItem = new NativeMenuItem("サイズ") { Menu = new NativeMenu() };
        foreach (var scale in CharacterScales.All)
        {
            var item = new NativeMenuItem(scale.Label())
            {
                ToggleType = NativeMenuItemToggleType.Radio,
                IsChecked = scale == currentScale,
            };
            var captured = scale;
            item.Click += (_, _) => ChangeScale(captured);
            sizeItem.Menu.Items.Add(item);
        }
        menu.Items.Add(sizeItem);
        menu.Items.Add(new NativeMenuItemSeparator());

        var exitItem = new NativeMenuItem("終了");
        exitItem.Click += (_, _) =>
        {
            PersistState();
            _desktop?.Shutdown();
        };
        menu.Items.Add(exitItem);
        return menu;
    }

    /// <summary>表示中のペットを切り替える（位置は維持・FR-011）。</summary>
    private void SwitchPet(PetPackage package)
    {
        if (_petWindow is null || package.Id == _currentPackage?.Id)
        {
            return;
        }
        if (!SpriteSheetLoader.TryLoad(package.AtlasPath, out var sheet, out var error))
        {
            DiagnosticsLog.Write($"switch: {package.DirectoryPath}: {error}");
            return;
        }

        _currentPackage = package;
        _petWindow.SetSpriteSheet(sheet!);
        _settings = _settings with { SelectedPetId = package.Id };
        if (!_settingsService.TrySave(_settings, out var saveError))
        {
            DiagnosticsLog.Write($"settings: save failed: {saveError}");
        }

        if (_trayIcon is not null)
        {
            _trayIcon.Icon = CreateTrayIconImage(sheet!);
            _trayIcon.Menu = BuildTrayMenu();
        }
    }

    /// <summary>
    /// 表示サイズを変える（002 FR-012〜018）。再生中のアニメーション・状態・選択中のペットには影響しない。
    /// </summary>
    private void ChangeScale(CharacterScale scale)
    {
        if (_petWindow is null || scale == _petWindow.Scale)
        {
            return; // 現在と同じサイズ。再描画も保存もしない
        }

        _petWindow.SetScale(scale);

        // はみ出し補正で位置が変わっている場合があるので、位置も一緒に保存する
        _settings = _settings with
        {
            ScalePercent = scale.Percent(),
            PositionX = _petWindow.Position.X,
            PositionY = _petWindow.Position.Y,
        };
        if (!_settingsService.TrySave(_settings, out var saveError))
        {
            DiagnosticsLog.Write($"settings: save failed: {saveError}");
        }

        if (_trayIcon is not null)
        {
            _trayIcon.Menu = BuildTrayMenu(); // 選択中の印を新しいサイズへ移す
        }
    }

    /// <summary>トレイアイコンには選択中ペットのidle 1コマ目を使う。</summary>
    private static WindowIcon CreateTrayIconImage(SpriteSheet sheet)
    {
        var bitmap = PetWindow.CreateFrameBitmap(sheet.GetFrame(PetState.Idle, 0));
        using var stream = new MemoryStream();
        bitmap.Save(stream);
        stream.Position = 0;
        return new WindowIcon(stream);
    }

    private void PersistState()
    {
        if (_petWindow is not null)
        {
            _settings = _settings with
            {
                PositionX = _petWindow.Position.X,
                PositionY = _petWindow.Position.Y,
                SelectedPetId = _currentPackage?.Id ?? _settings.SelectedPetId,
                ScalePercent = _petWindow.Scale.Percent(),
            };
        }
        if (!_settingsService.TrySave(_settings, out var error))
        {
            DiagnosticsLog.Write($"settings: save failed: {error}");
        }
    }
}
