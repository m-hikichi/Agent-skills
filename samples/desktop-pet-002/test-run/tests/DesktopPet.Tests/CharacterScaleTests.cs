using DesktopPet.Models;
using Xunit;

namespace DesktopPet.Tests;

public class CharacterScaleTests
{
    [Theory]
    [InlineData(CharacterScale.Small, 0.75, 75, "Small 75%")]
    [InlineData(CharacterScale.Medium, 1.0, 100, "Medium 100%")]
    [InlineData(CharacterScale.Large, 1.25, 125, "Large 125%")]
    [InlineData(CharacterScale.XLarge, 1.5, 150, "X-Large 150%")]
    public void EachScale_HasFactorPercentAndLabel(
        CharacterScale scale, double factor, int percent, string label)
    {
        Assert.Equal(factor, scale.Factor());
        Assert.Equal(percent, scale.Percent());
        Assert.Equal(label, scale.Label());
    }

    [Fact]
    public void All_ListsFourScalesInAscendingOrder()
    {
        Assert.Equal(
            [CharacterScale.Small, CharacterScale.Medium, CharacterScale.Large, CharacterScale.XLarge],
            CharacterScales.All);

        var factors = CharacterScales.All.Select(s => s.Factor()).ToList();
        Assert.Equal(factors.OrderBy(f => f), factors);
    }

    [Theory]
    [InlineData(75, CharacterScale.Small)]
    [InlineData(100, CharacterScale.Medium)]
    [InlineData(125, CharacterScale.Large)]
    [InlineData(150, CharacterScale.XLarge)]
    public void FromPercent_RestoresTheFourSavedValues(int percent, CharacterScale expected)
    {
        Assert.Equal(expected, CharacterScales.FromPercent(percent));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-50)]
    [InlineData(110)]
    [InlineData(1000)]
    public void FromPercent_FallsBackToMediumForMissingOrOutOfRangeValues(int? percent)
    {
        Assert.Equal(CharacterScale.Medium, CharacterScales.FromPercent(percent));
    }

    [Fact]
    public void PercentAndFromPercent_RoundTripForEveryScale()
    {
        foreach (var scale in CharacterScales.All)
        {
            Assert.Equal(scale, CharacterScales.FromPercent(scale.Percent()));
        }
    }
}
