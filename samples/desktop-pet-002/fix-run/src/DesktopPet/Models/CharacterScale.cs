namespace DesktopPet.Models;

/// <summary>
/// キャラクターの表示サイズ（4段階）。常駐メニューでの選択によってのみ変わる
/// （specs/002-idle-run-pet-resize/spec.md FR-012）。
/// </summary>
public enum CharacterScale
{
    Small,
    Medium,
    Large,
    XLarge,
}

/// <summary><see cref="CharacterScale"/> の倍率・保存値・メニュー表記。</summary>
public static class CharacterScales
{
    /// <summary>メニュー構築用。小さい順。</summary>
    public static IReadOnlyList<CharacterScale> All { get; } =
        [CharacterScale.Small, CharacterScale.Medium, CharacterScale.Large, CharacterScale.XLarge];

    /// <summary>標準サイズ（100%）に対する倍率。</summary>
    public static double Factor(this CharacterScale scale) => scale switch
    {
        CharacterScale.Small => 0.75,
        CharacterScale.Large => 1.25,
        CharacterScale.XLarge => 1.5,
        _ => 1.0,
    };

    /// <summary>settings.json に保存する整数パーセント。倍率からは計算しない。</summary>
    public static int Percent(this CharacterScale scale) => scale switch
    {
        CharacterScale.Small => 75,
        CharacterScale.Large => 125,
        CharacterScale.XLarge => 150,
        _ => 100,
    };

    /// <summary>常駐メニューの表記（ラベルと倍率を併記）。</summary>
    public static string Label(this CharacterScale scale) => scale switch
    {
        CharacterScale.Small => "Small 75%",
        CharacterScale.Large => "Large 125%",
        CharacterScale.XLarge => "X-Large 150%",
        _ => "Medium 100%",
    };

    /// <summary>保存値から復元する。null・4段階以外の値は Medium（FR-016）。</summary>
    public static CharacterScale FromPercent(int? percent) => percent switch
    {
        75 => CharacterScale.Small,
        125 => CharacterScale.Large,
        150 => CharacterScale.XLarge,
        _ => CharacterScale.Medium,
    };
}
