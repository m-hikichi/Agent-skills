using DesktopPet.Models;

namespace DesktopPet.Services;

/// <summary>拡大縮小時の補間方法（UI型に依存しない表現。PetWindow が Avalonia の型へ対応付ける）。</summary>
public enum SpriteInterpolation
{
    Nearest,
    HighQuality,
}

/// <summary>
/// 座標系をまたぐ変換を行う唯一の場所（spec FR-024、contracts/coordinate-spaces.md §4）。
/// 状態を持たない純関数の集まりで、表示倍率（scaling）は常に引数で受け取り、何もキャッシュしない。
/// これ以外のコードは、表示倍率・サイズ倍率を読んでここへ渡すだけとし、乗除を自分では書かない。
/// </summary>
public static class CharacterLayout
{
    private const double OverflowTolerance = 1e-6;
    private const double IntegerScaleTolerance = 0.01;

    /// <summary>表示寸法（DIP）= 原寸コマ 192×208 × サイズ倍率。</summary>
    public static DipSize SizeDip(CharacterScale scale)
    {
        var factor = scale.Factor();
        return new DipSize(AnimationTable.CellWidth * factor, AnimationTable.CellHeight * factor);
    }

    /// <summary>足元アンカーからウィンドウ左上を導出する（アンカー − (幅/2, 高さ) × 表示倍率）。</summary>
    public static ScreenPoint TopLeft(CharacterPosition position, CharacterScale scale, double scaling)
    {
        var size = SizeDip(scale);
        return new ScreenPoint(
            position.X - size.Width * scaling / 2,
            position.Y - size.Height * scaling);
    }

    /// <summary><see cref="TopLeft"/> の逆変換。起動時の位置復元に使う。</summary>
    public static CharacterPosition AnchorFromTopLeft(ScreenPoint topLeft, CharacterScale scale, double scaling)
    {
        var size = SizeDip(scale);
        return new CharacterPosition(
            topLeft.X + size.Width * scaling / 2,
            topLeft.Y + size.Height * scaling);
    }

    /// <summary>キャラクターの表示矩形（スクリーン座標）。</summary>
    public static ScreenRect BoundsPx(CharacterPosition position, CharacterScale scale, double scaling)
    {
        var topLeft = TopLeft(position, scale, scaling);
        var size = SizeDip(scale);
        return new ScreenRect(topLeft.X, topLeft.Y, size.Width * scaling, size.Height * scaling);
    }

    /// <summary>ウィンドウ左上から表示矩形を求める（起動時の位置復元で、保存された左上に使う）。</summary>
    public static ScreenRect BoundsFromTopLeft(ScreenPoint topLeft, CharacterScale scale, double scaling) =>
        BoundsPx(AnchorFromTopLeft(topLeft, scale, scaling), scale, scaling);

    /// <summary>つかんだ瞬間の「アンカー → カーソル」のベクトル（DIP）。</summary>
    public static DipVector GrabOffsetDip(ScreenPoint cursor, CharacterPosition position, double scaling) =>
        new((cursor.X - position.X) / scaling, (cursor.Y - position.Y) / scaling);

    /// <summary>ドラッグ中のアンカー = カーソル − つかみ位置 × 現在の表示倍率。</summary>
    public static CharacterPosition PositionFromCursor(ScreenPoint cursor, DipVector grabOffsetDip, double scaling) =>
        new(cursor.X - grabOffsetDip.X * scaling, cursor.Y - grabOffsetDip.Y * scaling);

    /// <summary>
    /// 移動量（DIP）= スクリーン座標の差 ÷ 表示倍率。絶対値を DIP にしてから差を取ってはならない
    /// （モニタをまたいだ瞬間に値が跳ぶ）。
    /// </summary>
    public static DipVector DeltaDip(ScreenPoint previous, ScreenPoint current, double scaling) =>
        new((current.X - previous.X) / scaling, (current.Y - previous.Y) / scaling);

    /// <summary>ウィンドウ内の位置（DIP）をスクリーン座標へ。カーソル位置を取得できないときの代替。</summary>
    public static ScreenPoint ClientDipToScreen(ScreenPoint windowTopLeft, DipVector clientDip, double scaling) =>
        new(windowTopLeft.X + clientDip.X * scaling, windowTopLeft.Y + clientDip.Y * scaling);

    /// <summary>
    /// 矩形のうち、どの作業領域にも含まれない面積。0 なら はみ出していない。
    /// 作業領域の和集合に対して判定するので、2台のモニタにまたがる矩形は はみ出しにならない
    /// （モニタ同士は重ならない前提）。
    /// </summary>
    public static double OverflowArea(ScreenRect rect, IReadOnlyList<ScreenRect> workAreas)
    {
        var covered = 0.0;
        foreach (var area in workAreas)
        {
            covered += IntersectionArea(rect, area);
        }
        return Math.Max(0, rect.Width * rect.Height - covered);
    }

    /// <summary>
    /// はみ出しているときだけ、作業領域内へ収めた新しいアンカーを返す。
    /// はみ出していなければ入力と同じ値を返す（FR-015）。
    /// </summary>
    public static CharacterPosition CorrectIfOverflowing(
        CharacterPosition position, CharacterScale scale, double scaling, IReadOnlyList<ScreenRect> workAreas)
    {
        if (workAreas.Count == 0)
        {
            return position;
        }

        var bounds = BoundsPx(position, scale, scaling);
        if (OverflowArea(bounds, workAreas) <= OverflowTolerance)
        {
            return position;
        }

        // どの作業領域とも交差しない場合は、中心が最も近い作業領域へ収める
        var nearest = NearestWorkArea(bounds, workAreas);
        var fallback = new ScreenPoint(
            Math.Clamp(bounds.X, nearest.X, Math.Max(nearest.X, nearest.Right - bounds.Width)),
            Math.Clamp(bounds.Y, nearest.Y, Math.Max(nearest.Y, nearest.Bottom - bounds.Height)));

        return AnchorFromTopLeft(ClampTopLeft(bounds, workAreas, fallback), scale, scaling);
    }

    /// <summary>
    /// 矩形を、交差面積が最大の作業領域へ収めたときの左上。どの作業領域とも交差しなければ fallback。
    /// （001 の <see cref="SettingsService.ClampToScreens"/> を、座標系の型つきで呼ぶための窓口）
    /// </summary>
    public static ScreenPoint ClampTopLeft(
        ScreenRect bounds, IReadOnlyList<ScreenRect> workAreas, ScreenPoint fallback)
    {
        var (x, y) = SettingsService.ClampToScreens(
            bounds.X, bounds.Y, bounds.Width, bounds.Height, workAreas, (fallback.X, fallback.Y));
        return new ScreenPoint(x, y);
    }

    /// <summary>初回起動時の既定位置（プライマリ作業領域の右下）に置いたときの左上。</summary>
    public static ScreenPoint DefaultTopLeft(ScreenRect primaryWorkArea, ScreenRect bounds)
    {
        var (x, y) = SettingsService.DefaultPosition(primaryWorkArea, bounds.Width, bounds.Height);
        return new ScreenPoint(x, y);
    }

    /// <summary>
    /// カーソル（スクリーン座標）→ 原寸コマの画素座標（0..191, 0..207）。
    /// キャラクターの表示矩形の外なら null。
    /// </summary>
    public static (int X, int Y)? ToSourcePixel(
        ScreenPoint cursor, ScreenPoint windowTopLeft, CharacterScale scale, double scaling)
    {
        var factor = scale.Factor();
        var sourceX = (cursor.X - windowTopLeft.X) / scaling / factor;
        var sourceY = (cursor.Y - windowTopLeft.Y) / scaling / factor;
        if (sourceX < 0 || sourceY < 0 ||
            sourceX >= AnimationTable.CellWidth || sourceY >= AnimationTable.CellHeight)
        {
            return null;
        }
        return (Math.Min(AnimationTable.CellWidth - 1, (int)sourceX),
                Math.Min(AnimationTable.CellHeight - 1, (int)sourceY));
    }

    /// <summary>スクリーン座標を整数へ丸める唯一の場所。ウィンドウへ位置を設定する直前にだけ使う。</summary>
    public static (int X, int Y) RoundToPixel(ScreenPoint point) =>
        ((int)Math.Round(point.X, MidpointRounding.AwayFromZero),
         (int)Math.Round(point.Y, MidpointRounding.AwayFromZero));

    /// <summary>
    /// 補間方法の規則（research.md §7）。Medium は 001 と同じ最近傍。それ以外は、
    /// 実効倍率（サイズ倍率 × 表示倍率）が整数なら最近傍、非整数なら高品質補間。
    /// </summary>
    public static SpriteInterpolation InterpolationFor(CharacterScale scale, double scaling)
    {
        if (scale == CharacterScale.Medium)
        {
            return SpriteInterpolation.Nearest;
        }
        var effective = scale.Factor() * scaling;
        return Math.Abs(effective - Math.Round(effective)) < IntegerScaleTolerance
            ? SpriteInterpolation.Nearest
            : SpriteInterpolation.HighQuality;
    }

    private static double IntersectionArea(ScreenRect a, ScreenRect b)
    {
        var width = Math.Max(0, Math.Min(a.Right, b.Right) - Math.Max(a.X, b.X));
        var height = Math.Max(0, Math.Min(a.Bottom, b.Bottom) - Math.Max(a.Y, b.Y));
        return width * height;
    }

    private static ScreenRect NearestWorkArea(ScreenRect rect, IReadOnlyList<ScreenRect> workAreas)
    {
        var centerX = rect.X + rect.Width / 2;
        var centerY = rect.Y + rect.Height / 2;
        var best = workAreas[0];
        var bestDistance = double.MaxValue;
        foreach (var area in workAreas)
        {
            var dx = centerX - (area.X + area.Width / 2);
            var dy = centerY - (area.Y + area.Height / 2);
            var distance = dx * dx + dy * dy;
            if (distance < bestDistance)
            {
                bestDistance = distance;
                best = area;
            }
        }
        return best;
    }
}
