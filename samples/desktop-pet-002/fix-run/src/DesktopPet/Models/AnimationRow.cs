namespace DesktopPet.Models;

/// <summary>
/// アトラスの行に対応するペットの状態。値は行インデックスと一致する
/// （contracts/pet-package.md の固定テーブル）。
/// </summary>
public enum PetState
{
    Idle = 0,
    RunningRight = 1,
    RunningLeft = 2,
    Waving = 3,
    Jumping = 4,
    Failed = 5,
    Waiting = 6,
    Running = 7,
    Review = 8,
}

/// <summary>1行分のアニメーション定義（使用コマ数とコマごとの表示時間）。</summary>
public sealed record AnimationRow(PetState State, int RowIndex, IReadOnlyList<int> DurationsMs)
{
    public int FrameCount => DurationsMs.Count;
}

/// <summary>
/// hatch-pet / Codex 共通の固定アニメーションテーブル。
/// コマ時間は pet.json には含まれず、本テーブルが唯一の真実となる。
/// </summary>
public static class AnimationTable
{
    public const int Columns = 8;
    public const int Rows = 9;
    public const int CellWidth = 192;
    public const int CellHeight = 208;
    public const int AtlasWidth = 1536;
    public const int AtlasHeight = 1872;

    public static readonly IReadOnlyList<AnimationRow> All =
    [
        new(PetState.Idle, 0, [280, 110, 110, 140, 140, 320]),
        new(PetState.RunningRight, 1, [120, 120, 120, 120, 120, 120, 120, 220]),
        new(PetState.RunningLeft, 2, [120, 120, 120, 120, 120, 120, 120, 220]),
        new(PetState.Waving, 3, [140, 140, 140, 280]),
        new(PetState.Jumping, 4, [140, 140, 140, 140, 280]),
        new(PetState.Failed, 5, [140, 140, 140, 140, 140, 140, 140, 240]),
        new(PetState.Waiting, 6, [150, 150, 150, 150, 150, 260]),
        new(PetState.Running, 7, [120, 120, 120, 120, 120, 220]),
        new(PetState.Review, 8, [150, 150, 150, 150, 150, 280]),
    ];

    public static AnimationRow Get(PetState state) => All[(int)state];

    /// <summary>セル(row, col)のアトラス上の矩形（ピクセル）。</summary>
    public static (int X, int Y, int Width, int Height) CellRect(int rowIndex, int columnIndex) =>
        (columnIndex * CellWidth, rowIndex * CellHeight, CellWidth, CellHeight);
}
