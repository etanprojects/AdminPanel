namespace AdminPanel.Api.Tests;

public class CsvTests
{
    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("ZAP-40401", "ZAP-40401")]
    [InlineData("a;b", "\"a;b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("line1\nline2", "\"line1\nline2\"")]
    public void Escape_quotes_only_when_needed(string? input, string expected) =>
        Assert.Equal(expected, Csv.Escape(input));

    [Theory]
    [InlineData("=SUM(A1)")]
    [InlineData("+48")]
    [InlineData("-1")]
    [InlineData("@cmd")]
    public void Escape_neutralizes_spreadsheet_formulas(string input) =>
        Assert.Equal($"\"'{input}\"", Csv.Escape(input));

    [Fact]
    public void Line_joins_with_semicolon_and_ends_with_crlf() =>
        Assert.Equal("a;;\"c;d\"\r\n", Csv.Line("a", null, "c;d"));

    [Fact]
    public void Bom_is_utf8_preamble() =>
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, Csv.Bom);
}
