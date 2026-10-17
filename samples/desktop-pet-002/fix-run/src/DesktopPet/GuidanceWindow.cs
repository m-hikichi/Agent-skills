using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using DesktopPet.Services;

namespace DesktopPet;

/// <summary>
/// ペットパッケージが1つも見つからない（または全件読み込めない）ときの案内画面
/// （FR-012: クラッシュ・通知なしで原因と配置先を提示する）。
/// </summary>
public sealed class GuidanceWindow : Window
{
    public GuidanceWindow(IReadOnlyList<string> searchRoots, IReadOnlyList<DiscoveryError> errors)
    {
        Title = "Desktop Pet";
        Width = 600;
        SizeToContent = SizeToContent.Height;
        CanResize = false;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var panel = new StackPanel { Margin = new Avalonia.Thickness(20), Spacing = 8 };

        panel.Children.Add(new TextBlock
        {
            Text = "表示できるペットパッケージが見つかりませんでした。",
            FontWeight = FontWeight.Bold,
            TextWrapping = TextWrapping.Wrap,
        });
        panel.Children.Add(new TextBlock
        {
            Text = "次のいずれかの場所に pet.json と spritesheet.webp を配置してから再起動してください:",
            TextWrapping = TextWrapping.Wrap,
        });

        foreach (var root in searchRoots)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "  • " + Path.Combine(root, "<pet-id>"),
                FontFamily = new FontFamily("Consolas,Menlo,monospace"),
                TextWrapping = TextWrapping.Wrap,
            });
        }

        if (errors.Count > 0)
        {
            panel.Children.Add(new TextBlock
            {
                Text = "除外されたパッケージ:",
                FontWeight = FontWeight.Bold,
                Margin = new Avalonia.Thickness(0, 8, 0, 0),
            });
            foreach (var error in errors.Take(5))
            {
                panel.Children.Add(new TextBlock
                {
                    Text = $"  • {error.Path}: {error.Reason}",
                    TextWrapping = TextWrapping.Wrap,
                });
            }
            if (errors.Count > 5)
            {
                panel.Children.Add(new TextBlock { Text = $"  …ほか {errors.Count - 5} 件（詳細はログ参照）" });
            }
            panel.Children.Add(new TextBlock
            {
                Text = "ログ: " + DiagnosticsLog.LogDirectory,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        var closeButton = new Button
        {
            Content = "閉じる",
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Avalonia.Thickness(0, 12, 0, 0),
        };
        closeButton.Click += (_, _) => Close();
        panel.Children.Add(closeButton);

        Content = panel;
    }
}
