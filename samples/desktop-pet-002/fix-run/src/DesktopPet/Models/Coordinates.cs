namespace DesktopPet.Models;

// 座標系を型で区別するための値型（specs/002-idle-run-pet-resize/contracts/coordinate-spaces.md）。
// 座標系をまたぐ変換は Services/CharacterLayout.cs だけが行う。

/// <summary>
/// スクリーン座標の点。Per-Monitor DPI Aware V2 のプロセスにおける Win32 スクリーン座標で、
/// 仮想スクリーン上の物理ピクセル座標と一致する。原点はプライマリモニタの左上、
/// プライマリより左・上のモニタでは負の値をとる。
/// </summary>
public readonly record struct ScreenPoint(double X, double Y);

/// <summary>スクリーン座標の矩形（モニタの作業領域、キャラクターの表示矩形）。</summary>
public readonly record struct ScreenRect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
}

/// <summary>
/// 論理座標（DIP、1/96インチ）のベクトル。ウィンドウ内の位置、または長さ・移動量として使う。
/// デスクトップ全体の位置としては使わない。
/// </summary>
public readonly record struct DipVector(double X, double Y);

/// <summary>論理座標（DIP）の寸法。</summary>
public readonly record struct DipSize(double Width, double Height);
