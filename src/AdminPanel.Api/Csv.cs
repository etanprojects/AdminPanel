using System.Text;

namespace AdminPanel.Api;

/// <summary>CSV w formacie przyjaznym dla polskiego Excela: separator ';', UTF-8 z BOM.</summary>
public static class Csv
{
    public const char Separator = ';';

    public static string Line(params string?[] values) =>
        string.Join(Separator, values.Select(Escape)) + "\r\n";

    public static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var needsQuotes = value.IndexOfAny([Separator, '"', '\r', '\n']) >= 0;
        // ochrona przed CSV injection w Excelu
        if (value[0] is '=' or '+' or '-' or '@') value = "'" + value;
        return needsQuotes || value.StartsWith('\'') ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    public static readonly byte[] Bom = Encoding.UTF8.GetPreamble();
}
