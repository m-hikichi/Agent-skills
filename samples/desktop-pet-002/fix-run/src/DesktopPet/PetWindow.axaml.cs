using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using DesktopPet.Animation;
using DesktopPet.Models;
using DesktopPet.Platform;
using DesktopPet.Services;

namespace DesktopPet;

/// <summary>
/// 透過・フレームレス・常時最前面のペットウィンドウ。
/// 透明領域のクリック透過（カーソルポーリング方式）とドラッグ移動を担う。
/// 普段は常に idle 行をループし、自発的には動かない（002 FR-001〜004）。
/// 座標系をまたぐ変換は CharacterLayout だけが行い、ここでは表示倍率を読んで渡すだけにする
/// （002 FR-024、contracts/coordinate-spaces.md）。
/// </summary>
public partial class PetWindow : Window
{
    private readonly IWindowEffects _effects;
    private readonly Action<PixelPoint> _onPositionSaved;

    // 互いに独立して管理する4つの値（002 FR-023）。ウィンドウの矩形は保持せず、ここから毎回導出する。
    // 各操作が書き換えるのは自分の担当の値だけにする。
    private CharacterScale _scale = CharacterScale.Medium;
    private CharacterPosition _position;
    private CharacterState _state;
    private readonly AnimationEngine _engine = new(); // CurrentAnimation

    private readonly DispatcherTimer _frameTimer = new();
    private readonly DispatcherTimer _hitTestTimer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly DispatcherTimer _topmostTimer = new() { Interval = TimeSpan.FromSeconds(5) };

    // ドラッグ中のアニメーション選択（002 FR-005〜011 / FR-025）。判断は純ロジックの DragMotionTracker が行う
    private static readonly TimeSpan StillnessRetryInterval = TimeSpan.FromMilliseconds(15);
    private readonly DragMotionTracker _dragTracker = new();
    private readonly DispatcherTimer _stillnessTimer = new();
    private readonly System.Diagnostics.Stopwatch _clock = System.Diagnostics.Stopwatch.StartNew();
    private ScreenPoint _lastCursor;

    private SpriteSheet _sheet;
    private Dictionary<PetState, WriteableBitmap[]> _bitmaps;
    private bool _clickThroughApplied;
    private bool _clickThroughKnown;
    private bool _positionInitialized;
    private DipVector _grabOffsetDip;
    private nint _handle;

    public PetWindow(
        SpriteSheet sheet,
        IWindowEffects effects,
        Action<PixelPoint> onPositionSaved,
        CharacterScale initialScale = CharacterScale.Medium)
    {
        InitializeComponent();

        _sheet = sheet;
        _effects = effects;
        _onPositionSaved = onPositionSaved;
        _scale = initialScale;
        _bitmaps = BuildBitmaps(sheet);
        ApplySize();

        _frameTimer.Tick += OnFrameTick;
        _hitTestTimer.Tick += OnHitTestTick;
        _topmostTimer.Tick += OnTopmostTick;
        _stillnessTimer.Tick += OnStillnessTick;

        SpriteImage.PointerPressed += OnSpritePointerPressed;
        SpriteImage.PointerMoved += OnSpritePointerMoved;
        SpriteImage.PointerReleased += OnSpritePointerReleased;
        SpriteImage.PointerCaptureLost += OnSpritePointerCaptureLost;

        Opened += OnOpenedHandler;
        ScalingChanged += OnScalingChanged;
    }

    /// <summary>表示中のペットを切り替える（位置・表示サイズは維持。001 FR-011 / 002 FR-018）。</summary>
    public void SetSpriteSheet(SpriteSheet sheet)
    {
        _sheet = sheet;
        _bitmaps = BuildBitmaps(sheet);
        // 再生中の行とコマはそのまま（全ペットが同じ固定テーブルを使う）。コマ画像だけ差し替える
        ApplyFrame();
    }

    public CharacterScale Scale => _scale;

    /// <summary>
    /// 表示サイズを変える（002 FR-014 / FR-015）。書き換えるのは _scale だけで、足元アンカー・状態・
    /// 再生中のアニメーション・コマタイマーには触れない（FR-023）。足元の位置はそのままに、
    /// 変更後に画面外へはみ出す場合に限り、作業領域内へ位置を補正する。
    /// </summary>
    public void SetScale(CharacterScale scale)
    {
        if (scale == _scale)
        {
            return;
        }

        var growing = scale > _scale;
        _scale = scale;
        if (!_positionInitialized)
        {
            ApplySize();
            return;
        }

        // 途中の状態が画面外へはみ出さない順で適用する（拡大: 位置→寸法、縮小: 寸法→位置）
        if (growing)
        {
            ApplyPosition();
            ApplySize();
        }
        else
        {
            ApplySize();
            ApplyPosition();
        }

        var workAreas = Screens.All.Select(s => ToScreenRect(s.WorkingArea)).ToList();
        var corrected = CharacterLayout.CorrectIfOverflowing(_position, _scale, RenderScaling, workAreas);
        if (corrected != _position)
        {
            _position = corrected;
            ApplyPosition();
            _onPositionSaved(Position);
        }
    }

    private void OnOpenedHandler(object? sender, EventArgs e)
    {
        _handle = TryGetPlatformHandle()?.Handle ?? 0;
        if (_handle != 0)
        {
            _effects.ApplyNoActivate(_handle); // FR-008: クリック・ドラッグでもフォーカスを奪わない
            _effects.AssertTopmost(_handle);
        }

        // App が復元して設定した左上から、足元アンカーを求める。これ以降、丸めたウィンドウ位置を
        // _position へ書き戻すことはない
        _position = CharacterLayout.AnchorFromTopLeft(WindowTopLeft, _scale, RenderScaling);
        _positionInitialized = true;
        ApplyInterpolation(); // 表示先のモニタの表示倍率が確定したので選び直す

        Screens.Changed += OnScreensChanged;

        ApplyFrame();
        _hitTestTimer.Start();
        _topmostTimer.Start();
    }

    // ---- レイアウト（4つの値からウィンドウの矩形を導出する） ----

    private ScreenPoint WindowTopLeft => new(Position.X, Position.Y);

    private void ApplySize()
    {
        var size = CharacterLayout.SizeDip(_scale);
        Width = size.Width;
        Height = size.Height;
        SpriteImage.Width = size.Width;
        SpriteImage.Height = size.Height;
        ApplyInterpolation();
    }

    // 補間方法の規則は CharacterLayout.InterpolationFor（research.md §7）。Medium は 001 と同じ最近傍
    private void ApplyInterpolation()
    {
        var mode = CharacterLayout.InterpolationFor(_scale, RenderScaling) == SpriteInterpolation.HighQuality
            ? BitmapInterpolationMode.HighQuality
            : BitmapInterpolationMode.None;
        RenderOptions.SetBitmapInterpolationMode(SpriteImage, mode);
    }

    private void ApplyPosition()
    {
        var (x, y) = CharacterLayout.RoundToPixel(CharacterLayout.TopLeft(_position, _scale, RenderScaling));
        Position = new PixelPoint(x, y);
    }

    /// <summary>
    /// モニタをまたいだ、または OS の表示倍率が変わった。変わっていない足元アンカーから左上を求め直す。
    /// ドラッグ中は次のポインタ移動で同じ計算が走る。
    /// </summary>
    private void OnScalingChanged(object? sender, EventArgs e)
    {
        ApplyInterpolation(); // 実効倍率が変わるので、補間方法も選び直す
        if (_positionInitialized && _state.Activity != CharacterActivity.Dragging)
        {
            ApplyPosition();
        }
    }

    // ---- アニメーション（001 FR-003 / 002 FR-001〜004） ----

    private void ApplyFrame()
    {
        SpriteImage.Source = _bitmaps[_engine.State][_engine.FrameIndex];
        _frameTimer.Stop();
        _frameTimer.Interval = _engine.CurrentFrameDuration;
        _frameTimer.Start();
    }

    // 時間経過や乱数で idle 以外の行へ移る経路は存在しない。コマを進めるだけ
    private void OnFrameTick(object? sender, EventArgs e)
    {
        _engine.Advance();
        ApplyFrame();
    }

    /// <summary>
    /// 再生する行を切り替える。いまの行と同じなら何もしない（同じ行を再指定してコマ0へ戻すと、
    /// 走りが足踏みに見える）。
    /// </summary>
    private void PlayRow(PetState row)
    {
        if (_engine.State == row)
        {
            return;
        }
        _engine.SwitchTo(row);
        ApplyFrame();
    }

    // ---- クリック透過（FR-007、research.md §3） ----

    private void OnHitTestTick(object? sender, EventArgs e)
    {
        if (_state.Activity == CharacterActivity.Dragging || _handle == 0)
        {
            return;
        }
        if (!_effects.TryGetCursorPosition(out var cursorX, out var cursorY))
        {
            return;
        }

        var wantClickThrough = !IsCursorOverCharacter(new ScreenPoint(cursorX, cursorY));
        if (!_clickThroughKnown || wantClickThrough != _clickThroughApplied)
        {
            _effects.SetClickThrough(_handle, wantClickThrough);
            _clickThroughApplied = wantClickThrough;
            _clickThroughKnown = true;
        }
    }

    private bool IsCursorOverCharacter(ScreenPoint cursor)
    {
        if (CharacterLayout.ToSourcePixel(cursor, WindowTopLeft, _scale, RenderScaling) is not { } pixel)
        {
            return false;
        }

        var frame = _sheet.GetFrame(_engine.State, _engine.FrameIndex);
        return frame.Opaque[pixel.Y * AnimationTable.CellWidth + pixel.X];
    }

    // ---- 最前面の維持（FR-002） ----

    private void OnTopmostTick(object? sender, EventArgs e)
    {
        if (_handle != 0)
        {
            _effects.AssertTopmost(_handle);
        }
    }

    // ---- ドラッグ移動（FR-010 / FR-016） ----

    private ScreenPoint GetCursor(PointerEventArgs e)
    {
        if (_effects.TryGetCursorPosition(out var cursorX, out var cursorY))
        {
            return new ScreenPoint(cursorX, cursorY);
        }

        // グローバル座標が取れない環境では、ウィンドウ内の位置（DIP）から求める
        var client = e.GetPosition(this);
        return CharacterLayout.ClientDipToScreen(WindowTopLeft, new DipVector(client.X, client.Y), RenderScaling);
    }

    private void OnSpritePointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
        {
            return;
        }

        var cursor = GetCursor(e);
        _state = _state with { Activity = CharacterActivity.Dragging };

        // つかみ位置は DIP で持つ。表示倍率の違うモニタへ入っても、同じ部位をつかんだままになる
        _grabOffsetDip = CharacterLayout.GrabOffsetDip(cursor, _position, RenderScaling);
        _lastCursor = cursor;
        PlayRow(_dragTracker.Begin(_state.Facing, _clock.Elapsed)); // 動き出すまでは idle のまま

        e.Pointer.Capture(SpriteImage);
        e.Handled = true;
    }

    private void OnSpritePointerMoved(object? sender, PointerEventArgs e)
    {
        if (_state.Activity != CharacterActivity.Dragging)
        {
            return;
        }

        // 位置の更新が先。アニメーションの切替がカーソルへの追従を遅らせない（FR-011）
        var cursor = GetCursor(e);
        _position = CharacterLayout.PositionFromCursor(cursor, _grabOffsetDip, RenderScaling);
        ApplyPosition();

        // 移動量は「スクリーン座標の差 ÷ 表示倍率」で渡す（絶対値を DIP にすると、モニタをまたいだ瞬間に跳ぶ）
        var row = _dragTracker.Move(CharacterLayout.DeltaDip(_lastCursor, cursor, RenderScaling), _clock.Elapsed);
        _lastCursor = cursor;
        _state = _state with { Facing = _dragTracker.Facing };
        PlayRow(row);

        // 最後の移動から 0.3 秒で idle に戻す（FR-009）。移動のたびに張り直すワンショット
        _stillnessTimer.Stop();
        _stillnessTimer.Interval = DragMotionTracker.StillnessTimeout;
        _stillnessTimer.Start();
        e.Handled = true;
    }

    private void OnStillnessTick(object? sender, EventArgs e)
    {
        _stillnessTimer.Stop();
        if (_state.Activity != CharacterActivity.Dragging)
        {
            return;
        }

        var now = _clock.Elapsed;
        if (!_dragTracker.IsStill(now))
        {
            // タイマーがわずかに早く発火した。0.3 秒に達するまで短い間隔で確かめ直す
            _stillnessTimer.Interval = StillnessRetryInterval;
            _stillnessTimer.Start();
            return;
        }
        PlayRow(_dragTracker.Poll(now));
    }

    private void OnSpritePointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (_state.Activity != CharacterActivity.Dragging)
        {
            return;
        }
        EndDrag();
        e.Pointer.Capture(null);
        e.Handled = true;
    }

    // 画面ロック・スリープ・他の操作の割り込みなど、「離す」以外でドラッグが終わった場合（FR-010）
    private void OnSpritePointerCaptureLost(object? sender, PointerCaptureLostEventArgs e) => EndDrag();

    /// <summary>
    /// ドラッグの終了。どの経路から何度呼ばれても同じ結果になる。必ず idle 行へ戻し、
    /// 走りのまま固まらないようにする。向きは保持する（FR-008）。
    /// </summary>
    private void EndDrag()
    {
        if (_state.Activity != CharacterActivity.Dragging)
        {
            return;
        }

        _stillnessTimer.Stop();
        PlayRow(_dragTracker.End());
        _state = new CharacterState(CharacterActivity.Idle, _dragTracker.Facing);
        _onPositionSaved(Position); // FR-016: ドロップ位置を保存
    }

    // ---- 画面構成変更への追従（FR-015） ----

    private void OnScreensChanged(object? sender, EventArgs e)
    {
        var screens = Screens.All;
        if (screens.Count == 0 || !_positionInitialized)
        {
            return;
        }

        var primary = Screens.Primary ?? screens[0];
        var bounds = CharacterLayout.BoundsPx(_position, _scale, RenderScaling);
        var fallback = CharacterLayout.DefaultTopLeft(ToScreenRect(primary.WorkingArea), bounds);
        var workAreas = screens.Select(s => ToScreenRect(s.WorkingArea)).ToList();

        var topLeft = CharacterLayout.ClampTopLeft(bounds, workAreas, fallback);
        if (topLeft == new ScreenPoint(bounds.X, bounds.Y))
        {
            return; // 画面内に収まっている。位置には触れない
        }

        _position = CharacterLayout.AnchorFromTopLeft(topLeft, _scale, RenderScaling);
        ApplyPosition();
    }

    private static ScreenRect ToScreenRect(PixelRect rect) =>
        new(rect.X, rect.Y, rect.Width, rect.Height);

    // ---- フレーム画像の構築（原寸のまま保持し、拡大縮小は描画時に行う） ----

    internal static WriteableBitmap CreateFrameBitmap(SpriteFrame frame)
    {
        // 乗算済みアルファで持つ。非乗算のまま補間すると、透明画素の色が輪郭に混ざって
        // キャラクターの縁にフチが出る（research.md §7）
        var bitmap = new WriteableBitmap(
            new PixelSize(AnimationTable.CellWidth, AnimationTable.CellHeight),
            new Vector(96, 96),
            PixelFormat.Bgra8888,
            AlphaFormat.Premul);

        var premultiplied = SpriteSheetLoader.Premultiply(frame.Bgra);
        using var buffer = bitmap.Lock();
        var sourceStride = AnimationTable.CellWidth * 4;
        for (var y = 0; y < AnimationTable.CellHeight; y++)
        {
            Marshal.Copy(premultiplied, y * sourceStride, buffer.Address + y * buffer.RowBytes, sourceStride);
        }
        return bitmap;
    }

    private static Dictionary<PetState, WriteableBitmap[]> BuildBitmaps(SpriteSheet sheet) =>
        sheet.Frames.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.Select(CreateFrameBitmap).ToArray());
}
