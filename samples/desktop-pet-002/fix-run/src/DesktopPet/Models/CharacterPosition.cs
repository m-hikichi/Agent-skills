namespace DesktopPet.Models;

/// <summary>
/// キャラクターの位置。表示矩形の下辺中央（足元アンカー）をスクリーン座標の実数で表す。
/// 表示サイズが変わってもこの値は変わらず、ウィンドウの左上はここから毎回導出する
/// （Services/CharacterLayout.cs）。丸めた値をここへ書き戻さない。
/// </summary>
public readonly record struct CharacterPosition(double X, double Y);
